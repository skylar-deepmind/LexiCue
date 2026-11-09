import CoreImage
import CryptoKit
import Foundation
import Network
import Security

#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

@available(macOS 12, *)
final class DeviceRuntime {
  #if os(macOS)
    static let platformIsMac = true
  #else
    static let platformIsMac = false
  #endif
  let isMac: Bool
  let replica: UUID
  let journal: JournalBridge
  let storage: LinkKeychain
  let queue = DispatchQueue(label: "lexicue.device-sync.network")
  let worker = DispatchQueue(label: "lexicue.device-sync.library", qos: .utility)
  var identity: SecIdentity?
  var pin: Data?
  var mayVerifyLegacy = false
  var loaded = false
  var checkingPending = false
  var trust: PeerTrust?
  var pairing: PairingWindow?
  var scanned: PairingOffer?
  var candidate: PeerTrust?
  var confirmationID: UUID?
  var confirmed = false
  var code: String?
  var qr: String?
  var state = "unpaired"
  var syncPhase: SyncPhase?
  var issue: String?
  var foreground = true
  var suspension = UUID()
  var restoring = false
  var restoreReady = false
  var revoking = false
  var revocation: PeerTrust?
  var listener: NWListener?
  var advertisedPin: Data?
  var browser: NWBrowser?
  var authenticating: NWConnection?
  var active: NWConnection?
  var monitor: NWPathMonitor?
  var preparedRoute: ReplicaRoute?
  var reconnectDelay = 1
  var attempt = UUID()
  #if os(iOS)
    weak var scanner: PairingScanner?
  #endif

  init(replica: UUID, journal: JournalBridge, isMac: Bool = DeviceRuntime.platformIsMac) {
    self.isMac = isMac
    self.replica = replica
    self.journal = journal
    self.storage = LinkKeychain(installation: replica)
  }

  func start() {
    queue.async {
      self.loadTrust()
      self.reconnect()
    }
    #if os(iOS)
      NotificationCenter.default.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil, queue: .main
      ) { _ in self.finishCurrentBatch() }
      NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil, queue: nil
      ) { _ in self.queue.async { self.wake() } }
    #else
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.willSleepNotification,
        object: nil, queue: nil
      ) { _ in self.queue.async { self.suspend() } }
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.didWakeNotification,
        object: nil, queue: nil
      ) { _ in self.queue.async { self.wake() } }
    #endif
  }

  private func loadTrust() {
    do {
      let stored = try storage.load(PeerTrust.self, "peer")
      loaded = true
      if let stored, stored.revoked == true {
        revocation = stored
        drainRevocation()
      } else {
        trust = stored
        state = trust == nil ? "unpaired" : "waiting"
        issue = nil
        if let stored, stored.quarantined == true {
          let mode = try? journal.run("upgradeMode", stored.route) as? String
          mayVerifyLegacy = stored.fenced != true && (mode == "legacy" || mode == "migrated")
          if !mayVerifyLegacy {
            state = "error"
            issue = "reconcile"
          }
        }
      }
    } catch {
      loaded = false
      state = "error"
      issue = "storage"
    }
  }

  func command(_ action: String, confirmation: String? = nil) -> [String: Any] {
    queue.sync {
      if action == "beginRestore" {
        beginRestore()
      } else if action == "endRestore" {
        restoring = false
        restoreReady = false
        if trust == nil && revocation == nil && loaded {
          state = "unpaired"
          issue = nil
        }
      } else if !restoring && !revoking && revocation == nil {
        do {
          switch action {
          case "status": checkPending()
          case "wake": wake()
          case "offer" where isMac && trust == nil:
            if !loaded { loadTrust() }
            if loaded && trust == nil && revocation == nil { try beginOffer() }
          case "scan" where !isMac && trust == nil:
            if !loaded { loadTrust() }
            if loaded && trust == nil && revocation == nil { beginScan() }
          case "confirm" where confirmationID != nil && confirmationID?.uuidString == confirmation:
            confirmed = true
          case "cancel" where trust?.provisional == true:
            try revoke()
          case "cancel" where trust == nil:
            resetPairing()
          case "revoke": try revoke()
          default: break
          }
        } catch {
          setFailure(error)
        }
      }
      let provisional = trust?.provisional == true
      let visibleState = provisional ? "confirming" : state
      var value: [String: Any] = [
        "state": visibleState, "role": isMac ? "mac" : "iphone",
        "paired": trust != nil && !provisional, "confirmed": confirmed || provisional,
        "restoring": restoring, "restoreReady": restoreReady,
      ]
      if visibleState == "syncing" { value["phase"] = syncPhase?.rawValue }
      value["code"] = code ?? trust?.provisionalCode
      value["confirmationId"] = confirmationID?.uuidString
      value["qr"] = qr
      value["peerName"] = candidate?.name ?? trust?.name
      value["issue"] = issue
      return value
    }
  }

  func localIdentity() throws -> SecIdentity {
    if let identity { return identity }
    let archive: IdentityArchive
    if let stored = try storage.load(IdentityArchive.self, "identity") {
      archive = stored
    } else {
      let value = try journal.run("identity")
      archive = try JSONDecoder().decode(
        IdentityArchive.self, from: JSONSerialization.data(withJSONObject: value))
      try storage.save(archive, "identity")
    }
    let identity = try archive.importIdentity()
    var certificate: SecCertificate?
    guard SecIdentityCopyCertificate(identity, &certificate) == errSecSuccess, let certificate
    else { throw DeviceLinkError.identity }
    pin = try TrustedTransport.fingerprint(of: certificate)
    self.identity = identity
    return identity
  }

  private func beginOffer() throws {
    resetPairing()
    _ = try localIdentity()
    guard let pin else { throw DeviceLinkError.identity }
    let window = try PairingWindow(serverPin: pin)
    qr = try window.offer.pngURI()
    pairing = window
    state = "offering"
    expire(attempt)
    reconnect()
  }

  private func beginScan() {
    #if os(iOS)
      resetPairing()
      let token = attempt
      state = "scanning"
      DispatchQueue.main.async {
        let scanner = PairingScanner.present { result in
          self.queue.async {
            guard self.attempt == token else { return }
            switch result {
            case .success(let offer): self.useOffer(offer)
            case .failure(.denied):
              self.state = "permission"
              self.issue = "cameraDenied"
            case .failure(.canceled): self.resetPairing()
            case .failure(.invalid):
              self.state = "error"
              self.issue = "invalidQR"
            case .failure(.unavailable):
              self.state = "error"
              self.issue = "cameraUnavailable"
            }
          }
        }
        self.queue.async {
          if self.attempt == token {
            self.scanner = scanner
          } else {
            DispatchQueue.main.async { scanner?.cancel() }
          }
        }
      }
    #endif
  }

  /// Called only by the device camera delegate (and the native test host).
  func useOffer(_ offer: PairingOffer) {
    guard trust == nil, !restoring, !revoking, !isMac else { return }
    scanned = offer
    state = "scanning"
    expire(attempt)
    reconnect()
  }

  private func expire(_ token: UUID) {
    queue.asyncAfter(deadline: .now() + 120) {
      guard self.attempt == token, self.trust == nil else { return }
      self.resetPairing()
      self.state = "error"
      self.issue = "expired"
    }
  }

  private func clearCandidate() {
    attempt = UUID()
    pairing?.invalidate()
    pairing = nil
    scanned = nil
    qr = nil
    code = nil
    candidate = nil
    confirmationID = nil
    confirmed = false
  }

  func resetPairing() {
    clearCandidate()
    stopNetwork()
    #if os(iOS)
      if let scanner {
        DispatchQueue.main.async { scanner.cancel() }
        self.scanner = nil
      }
    #endif
    state = trust == nil ? "unpaired" : "waiting"
    issue = nil
  }

  func committed(_ peer: PeerTrust) throws {
    var stored = peer
    stored.provisionalCode = stored.provisional ? code : nil
    try storage.save(stored, "peer")
    trust = stored
    clearCandidate()
    state = "waiting"
    issue = nil
  }

  private func beginRestore() {
    guard !restoring else { return }
    restoring = true
    restoreReady = false
    if !loaded { loadTrust() }
    guard loaded else { return }
    // Clear even a still-displayed QR. A delayed camera callback or a waiting
    // confirmation belongs to the old attempt and cannot reopen the gate.
    if trust != nil {
      do { try revoke() } catch {
        stopNetwork()
        state = "error"
        issue = "storage"
        return
      }
    } else {
      resetPairing()
    }
    if revocation == nil { waitForRestoreDrain() }
  }

  private func waitForRestoreDrain() {
    guard restoring else { return }
    worker.async {
      self.queue.async {
        if self.restoring && self.loaded && self.trust == nil && self.revocation == nil {
          self.restoreReady = true
        }
      }
    }
  }

  private func revoke() throws {
    guard let peer = trust else {
      resetPairing()
      return
    }
    // Close the native trust gate first. The library worker drains any already
    // executing transaction before completing journal revocation.
    var tombstone = peer
    tombstone.revoked = true
    try storage.save(tombstone, "peer")
    revocation = tombstone
    trust = nil
    preparedRoute = nil
    resetPairing()
    drainRevocation()
  }

  private func drainRevocation() {
    guard let peer = revocation, !revoking else { return }
    revoking = true
    state = "pending"
    issue = "revoking"
    worker.async {
      let result = Result {
        _ = try self.journal.run("revoke", peer.route)
        try self.storage.delete("peer")
      }
      self.queue.async {
        self.revoking = false
        switch result {
        case .success:
          self.revocation = nil
          self.state = "unpaired"
          self.issue = nil
          self.waitForRestoreDrain()
        case .failure:
          self.state = "error"
          self.issue = "storage"
          self.queue.asyncAfter(deadline: .now() + 5) { self.drainRevocation() }
        }
      }
    }
  }

  func setFailure(_ error: Error) {
    if case DeviceLinkError.incompatible = error {
      state = "update"
      issue = nil
      return
    }
    state = "error"
    if case DeviceLinkError.reconcile = error, var peer = trust {
      stopNetwork()
      mayVerifyLegacy = false
      peer.quarantined = true
      trust = peer
      do {
        try storage.save(peer, "peer")
        issue = "reconcile"
      } catch { issue = "storage" }
      return
    }
    switch error {
    case DeviceLinkError.expired: issue = "expired"
    case DeviceLinkError.keychain: issue = "storage"
    case DeviceLinkError.identity: issue = "identity"
    case DeviceLinkError.engine(let text):
      issue = text.localizedCaseInsensitiveContains("backup") ? "backup" : "merge"
    default: issue = "connection"
    }
  }

  private func checkPending() {
    guard !checkingPending, active == nil, state == "waiting" || state == "pending",
      let peer = trust, !peer.provisional
    else { return }
    checkingPending = true
    worker.async {
      let value = try? self.journal.run("progress", peer.route) as? [String: Any]
      self.queue.async {
        self.checkingPending = false
        guard self.active == nil, self.trust?.route == peer.route,
          self.state == "waiting" || self.state == "pending",
          let head = value?["head"] as? NSNumber, let ack = value?["acked"] as? NSNumber
        else { return }
        self.state = head.int64Value > ack.int64Value ? "pending" : "waiting"
      }
    }
  }

  #if os(iOS)
    private func finishCurrentBatch() {
      // The OS owns the budget. Do not start another round in background. Allow
      // in-flight writes and their receipts a short grace period, then suspend.
      let token = UUID()
      queue.sync {
        foreground = false
        suspension = token
      }
      var task = UIBackgroundTaskIdentifier.invalid
      let stop = {
        self.queue.async { if self.suspension == token && !self.foreground { self.suspend() } }
        if task != .invalid {
          UIApplication.shared.endBackgroundTask(task)
          task = .invalid
        }
      }
      task = UIApplication.shared.beginBackgroundTask(
        withName: "Finish device sync batch", expirationHandler: stop)
      if task == .invalid {
        stop()
      } else {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: stop)
      }
    }
  #endif

  func suspend() {
    foreground = false
    if trust == nil {
      resetPairing()
    } else {
      // Already executing SQLite transactions still finish or roll back. An
      // interrupted receipt is retried from the persisted ACK on foreground.
      stopNetwork()
      if trust?.quarantined != true { state = "waiting" }
    }
  }

  func wake() {
    suspension = UUID()
    foreground = true
    if restoring || (trust?.quarantined == true && !mayVerifyLegacy) { return }
    if revocation != nil {
      drainRevocation()
      return
    }
    if trust == nil, pairing == nil, scanned == nil, state == "error", issue == "storage" {
      loadTrust()
    }
    reconnectDelay = 1
    reconnect()
  }

  func stopNetwork() {
    authenticating?.forceCancel()
    authenticating = nil
    active?.cancel()
    active = nil
    listener?.cancel()
    listener = nil
    browser?.cancel()
    browser = nil
    monitor?.cancel()
    monitor = nil
  }
}
