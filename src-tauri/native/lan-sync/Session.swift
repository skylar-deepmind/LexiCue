import CryptoKit
import Foundation

#if os(iOS)
  import UIKit
#endif

@available(macOS 12, *)
extension DeviceRuntime {
  private static let wireVersion = 2

  private var deviceName: String {
    #if os(iOS)
      return UIDevice.current.name
    #else
      return Host.current().localizedName ?? "Mac"
    #endif
  }

  private func greeting(_ kind: String, _ service: UUID) -> [String: Any] {
    [
      "kind": kind, "v": Self.wireVersion, "service": service.uuidString,
      "replica": replica.uuidString,
      "name": String(deviceName.prefix(80)),
    ]
  }

  private func verify(_ message: [String: Any], kind: String, service: UUID, link: LinkChannel)
    throws -> UUID
  {
    guard message["v"] as? Int == Self.wireVersion else {
      try? link.sendObject(["kind": "update"])
      throw DeviceLinkError.incompatible
    }
    guard message["kind"] as? String == kind,
      message["service"] as? String == service.uuidString,
      let raw = message["replica"] as? String, let remote = UUID(uuidString: raw), remote != replica
    else { throw DeviceLinkError.malformed }
    return remote
  }

  func pair(_ link: LinkChannel, offer: PairingOffer, pin remotePin: Data) throws {
    let hello: [String: Any]
    let remote: UUID
    if isMac {
      hello = try link.object(timeout: 6)
      remote = try verify(hello, kind: "claim", service: offer.service, link: link)
      guard let ticket = hello["ticket"] as? String, Data(base64Encoded: ticket) == offer.ticket,
        queue.sync(execute: {
          self.active === link.connection && self.pairing?.claim(offer) == true
        })
      else { throw DeviceLinkError.expired }
      try link.sendObject(greeting("challenge", offer.service))
    } else {
      guard remotePin == offer.serverPin else { throw DeviceLinkError.identity }
      var claim = greeting("claim", offer.service)
      claim["ticket"] = offer.ticket.base64EncodedString()
      try link.sendObject(claim)
      hello = try link.object()
      remote = try verify(hello, kind: "challenge", service: offer.service, link: link)
    }
    let name = (hello["name"] as? String ?? "").unicodeScalars.filter {
      !CharacterSet.controlCharacters.contains($0) && !CharacterSet.illegalCharacters.contains($0)
    }
    let peer = PeerTrust(
      route: ReplicaRoute(pair: offer.service, from: replica, to: remote), pin: remotePin,
      name: String(String(String.UnicodeScalarView(name)).prefix(80)), provisional: !isMac)
    let id = UUID()
    try queue.sync {
      guard active === link.connection, trust == nil, let ownPin = pin else {
        throw DeviceLinkError.canceled
      }
      let phonePin = isMac ? remotePin : ownPin
      let hash = SHA256.hash(
        data: Data("LexiCue pairing v1".utf8) + offer.ticket + offer.serverPin + phonePin)
      code = String(
        format: "%06u", hash.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } % 1_000_000)
      qr = nil
      candidate = peer
      confirmationID = id
      confirmed = false
      state = "confirming"
      issue = nil
    }
    if isMac {
      let message = try link.object(timeout: 120)
      guard message["kind"] as? String == "approve" else { throw DeviceLinkError.canceled }
    }
    // The native worker is independent of React polling, network callbacks
    // and the main thread. Cancel, suspend and expiry invalidate this ID.
    while true {
      if try queue.sync(execute: {
        guard active === link.connection, confirmationID == id else {
          throw DeviceLinkError.canceled
        }
        return confirmed
      }) {
        break
      }
      Thread.sleep(forTimeInterval: 0.1)
    }
    try queue.sync {
      guard active === link.connection, confirmationID == id else { throw DeviceLinkError.canceled }
      // Mac persists only after both approvals. The phone saves provisional
      // trust before sending approve, so a lost final response can be retried.
      try committed(peer)
    }
    if isMac {
      try link.sendObject(["kind": "approved"])
    } else {
      try link.sendObject(["kind": "approve"])
      guard try link.object(timeout: 120)["kind"] as? String == "approved" else {
        throw DeviceLinkError.canceled
      }
      try queue.sync {
        guard active === link.connection, trust?.route == peer.route else {
          throw DeviceLinkError.canceled
        }
        var approved = peer
        approved.provisional = false
        try committed(approved)
      }
    }
  }

  private func permitted(_ link: LinkChannel, _ peer: PeerTrust) -> Bool {
    queue.sync { active === link.connection && trust?.route == peer.route && !revoking }
  }

  private func prepare(_ link: LinkChannel, _ peer: PeerTrust) throws {
    guard permitted(link, peer) else { throw DeviceLinkError.canceled }
    if queue.sync(execute: { preparedRoute == peer.route }) { return }
    // Rust verifies the external publication fence on every new runtime;
    // only a new, explicitly approved route creates the pre-merge backup.
    _ = try journal.run("prepare", peer.route)
    try queue.sync {
      guard active === link.connection, trust?.route == peer.route else {
        throw DeviceLinkError.canceled
      }
      if peer.provisional {
        var approved = peer
        approved.provisional = false
        approved.provisionalCode = nil
        try storage.save(approved, "peer")
        trust = approved
      }
      preparedRoute = peer.route
    }
  }

  func sync(_ link: LinkChannel, peer: PeerTrust) throws {
    let kind = isMac ? "sync" : "ready"
    if !isMac { try link.sendObject(greeting("sync", peer.route.pair)) }
    mark(link, "syncing")
    let hello = try link.object(timeout: 600)
    guard try verify(hello, kind: kind, service: peer.route.pair, link: link) == peer.route.to
    else { throw DeviceLinkError.identity }
    do {
      try prepare(link, peer)
    } catch {
      let reason: String
      if case DeviceLinkError.engine(let text) = error,
        text.localizedCaseInsensitiveContains("backup")
      {
        reason = "backup"
      } else if case DeviceLinkError.reconcile = error {
        reason = "reconcile"
      } else {
        reason = "merge"
      }
      try? link.sendObject(["kind": "fault", "issue": reason])
      throw error
    }
    if isMac {
      try link.sendObject(greeting("ready", peer.route.pair))
      guard try link.object(timeout: 600)["kind"] as? String == "prepared" else {
        throw DeviceLinkError.malformed
      }
      try serve(link, peer)
    } else {
      try link.sendObject(["kind": "prepared"])
      try drive(link, peer)
    }
  }

  private func progress(_ peer: PeerTrust) throws -> [String: Int64] {
    guard let p = try journal.run("progress", peer.route) as? [String: Any],
      let head = p["head"] as? NSNumber, let ack = p["acked"] as? NSNumber,
      let rx = p["received"] as? NSNumber
    else { throw DeviceLinkError.malformed }
    return ["head": head.int64Value, "acked": ack.int64Value, "received": rx.int64Value]
  }

  private func settled(_ a: [String: Int64], _ b: [String: Int64]) -> Bool {
    guard let h = a["head"], let r = b["head"] else { return false }
    return h == a["acked"] && h == b["received"] && r == b["acked"] && r == a["received"]
  }

  private func mark(_ link: LinkChannel, _ value: String) {
    queue.sync {
      if active === link.connection {
        state = value
        if value == "synced" { reconnectDelay = 1 }
        issue = nil
      }
    }
  }

  private func drive(_ link: LinkChannel, _ peer: PeerTrust) throws {
    var completed = false
    while permitted(link, peer) && queue.sync(execute: { foreground }) {
      let local = try progress(peer)
      try link.sendObject(["kind": "pulse", "progress": local, "completed": completed])
      let reply = try link.object()
      guard reply["kind"] as? String == "pulse", let remote = reply["progress"] as? [String: Int64]
      else { throw DeviceLinkError.malformed }
      if completed && settled(local, remote) {
        mark(link, "synced")
        Thread.sleep(forTimeInterval: 1.5)
      } else {
        mark(link, "syncing")
        do {
          _ = try journal.run("run", peer.route, link: link)
          completed = true
        } catch DeviceLinkError.reconcile {
          try? link.sendObject(["kind": "fault", "issue": "reconcile"])
          throw DeviceLinkError.reconcile
        }
      }
    }
  }

  private func serve(_ link: LinkChannel, _ peer: PeerTrust) throws {
    var exchanged = false
    var needsHello = true
    while permitted(link, peer) {
      let raw = try link.receive(timeout: 30)
      guard permitted(link, peer) else { throw DeviceLinkError.canceled }
      guard let message = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any]
      else { throw DeviceLinkError.malformed }
      if message["kind"] as? String == "fault", message["issue"] as? String == "reconcile" {
        throw DeviceLinkError.reconcile
      }
      if message["kind"] as? String == "pulse" {
        needsHello = true
        guard let remote = message["progress"] as? [String: Int64] else {
          throw DeviceLinkError.malformed
        }
        let local = try progress(peer)
        let synced = exchanged && message["completed"] as? Bool == true && settled(local, remote)
        mark(link, synced ? "synced" : "syncing")
        try link.sendObject(["kind": "pulse", "progress": local])
      } else {
        mark(link, "syncing")
        do {
          // A peer must prove both history boundaries before any data frame
          // in this round may enter the database, even on a trusted TLS link.
          let reply = try journal.run(needsHello ? "hello" : "respond", peer.route, input: raw)
          needsHello = false
          try link.send(
            String(
              decoding: JSONSerialization.data(withJSONObject: reply, options: .fragmentsAllowed),
              as: UTF8.self))
          exchanged = true
        } catch DeviceLinkError.incompatible {
          try? link.sendObject(["error": "incompatible protocol version"])
          throw DeviceLinkError.incompatible
        } catch DeviceLinkError.reconcile {
          try? link.sendObject(["error": "reconcile"])
          throw DeviceLinkError.reconcile
        } catch DeviceLinkError.engine(let error) {
          // Do not send database paths, SQL, or learning content in diagnostics.
          try? link.sendObject(["error": "peer library needs recovery"])
          throw DeviceLinkError.engine(error)
        }
      }
    }
  }
}
