// Integration driver for the production discovery, pairing, Keychain, trust
// and reconnect code. A stub journal records when TLS permits its first call;
// data convergence is separately exercised with the real two-library engine.
import Foundation
import Network

#if os(iOS)
  import UIKit
#endif

var assets: URL!
var work: URL!
var prepared = false
var sawRequest = false
var verifiedUpgrade = false
var observedRuntime: DeviceRuntime!
var isMacRole = false
var replica: UUID!
var phase = ""
func has(_ name: String) -> Bool {
  FileManager.default.fileExists(atPath: work.appendingPathComponent(name).path)
}
func flag(_ name: String) {
  FileManager.default.createFile(atPath: work.appendingPathComponent(name).path, contents: Data())
}

func done(_ message: String, _ status: Int32 = 0) -> Never {
  print("DEVICE_RUNTIME \(message)")
  fflush(stdout)
  exit(status)
}
func engine(
  _ action: UnsafePointer<CChar>?, _ route: UnsafePointer<CChar>?, _ input: UnsafePointer<CChar>?,
  _ ctx: UnsafeMutableRawPointer?, _ call: LinkExchange?
) -> UnsafeMutablePointer<CChar>? {
  guard let action else { return nil }
  let command = String(cString: action)
  if ["prepare", "hello", "respond", "run"].contains(command) {
    // Called inside real session operations; polling delays must not invent a phase.
    let status = observedRuntime.command("status")
    let expected = command == "prepare" ? "preparing" : "exchanging"
    guard status["state"] as? String == "syncing", status["phase"] as? String == expected else {
      done("FAIL phase during " + command, 1)
    }
  }
  var output: Any = NSNull()
  switch command {
  case "upgradeMode":
    output = phase == "resume" && !verifiedUpgrade ? "legacy" : (prepared ? "known" : "new")
  case "upgradeProof":
    guard phase == "resume", !sawRequest else { done("FAIL late history proof", 1) }
    output = ["qaWitness": isMacRole ? "Mac" : "iPhone"]
  case "verifyUpgrade":
    guard phase == "resume", !sawRequest, let input,
      let value = try? JSONSerialization.jsonObject(with: Data(String(cString: input).utf8)) as? [String: String],
      value["qaWitness"] == (isMacRole ? "iPhone" : "Mac")
    else { done("FAIL missing peer proof", 1) }
    verifiedUpgrade = true
  case "identity":
    guard let p12 = try? Data(contentsOf: assets.appendingPathComponent("identity.p12")) else {
      return nil
    }
    output = ["password": "probe", "p12": p12.base64EncodedString()]
  case "prepare":
    if phase == "resume", !verifiedUpgrade { done("FAIL prepared unchecked legacy history", 1) }
    if phase != "pair", !prepared { done("FAIL lost preparation", 1) }
    prepared = true
    FileManager.default.createFile(
      atPath: work.appendingPathComponent("prepared").path, contents: Data())
  case "progress":
    if observedRuntime.queue.sync(execute: { observedRuntime.syncPhase == .awaitingAck && observedRuntime.state == "syncing" }) {
      flag("awaiting-ack-observed")
    }
    guard prepared else { return strdup("{\"error\":\"new install\"}") }
    let head = isMacRole && phase == "pair" && has("edited-while-offline") ? 1 : 0
    output = [
      "head": head, "acked": head == 1 && has("ack-after-restart") ? 1 : 0,
      "received": !isMacRole && phase == "rejoin" && has("ack-after-restart") ? 1 : 0,
    ]
  case "hello":
    guard prepared, let input, String(cString: input) == "{\"test\":true}" else { return nil }
    sawRequest = true
    output = isMacRole && phase == "pair" && has("edited-while-offline") ? "New" : "Confirmed"
  case "respond":
    guard prepared, let input, String(cString: input) == "{\"receipt\":1}",
      has("edited-while-offline")
    else { return nil }
    flag("ack-after-restart")
    output = "Confirmed"
  case "run":
    guard prepared, let call, let result = call(ctx, "{\"test\":true}") else { return nil }
    defer { free(result) }
    if String(cString: result) == "\"New\"" {
      flag("ack-after-restart")
      guard let ack = call(ctx, "{\"receipt\":1}") else { return nil }
      defer { free(ack) }
      guard String(cString: ack) == "\"Confirmed\"" else { return nil }
    } else if String(cString: result) != "\"Confirmed\"" {
      return nil
    }
    sawRequest = true
  case "revoke":
    // Simulate a process death between the durable rejection and DB shutdown.
    if phase == "revoke", isMacRole { done("PASS interrupted revocation") }
    prepared = false
    try? FileManager.default.removeItem(at: work.appendingPathComponent("prepared"))
  default: return nil
  }
  guard let bytes = try? JSONSerialization.data(withJSONObject: ["ok": output]) else { return nil }
  return strdup(String(decoding: bytes, as: UTF8.self))
}

#if os(macOS)
  // The original phone process is suspended with its TCP connection open.
  // Present the host's own certificate instead of the pinned phone key.
  func checkImpostor(_ runtime: DeviceRuntime) throws {
    let (original, port, identity, pin) = runtime.queue.sync {
      (runtime.active, runtime.listener?.port, runtime.identity, runtime.pin)
    }
    guard let original, let port, let identity, let pin else { done("FAIL missing active link", 1) }
    let network = DispatchQueue(label: "lexicue.qa.impostor")
    let params = try TrustedTransport.parameters(identity: identity, peerPin: pin, queue: network)
    let connection = NWConnection(host: "127.0.0.1", port: port, using: params)
    let rejected = DispatchSemaphore(value: 0)
    connection.stateUpdateHandler = { state in
      switch state {
      case .failed: rejected.signal()
      case .ready:
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4) { _, _, eof, error in
          if eof || error != nil { rejected.signal() }
        }
      default: break
      }
    }
    connection.start(queue: network)
    defer { connection.forceCancel() }
    guard rejected.wait(timeout: .now() + 5) == .success else {
      done("FAIL did not observe rejection of wrong certificate", 1)
    }
    guard runtime.queue.sync(execute: { runtime.active === original }),
      !has("ack-after-restart")
    else { done("FAIL wrong key displaced active connection", 1) }
    flag("impostor-rejected")
  }
#endif

func test() throws {
  let args = CommandLine.arguments
  #if os(iOS)
    guard args.count >= 3 else { done("FAIL missing arguments", 1) }
    isMacRole = false
    phase = args[1]
    replica = UUID(uuidString: args[2])
    assets = Bundle.main.resourceURL!
    work = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  #else
    guard args.count == 5 else { done("FAIL missing arguments", 1) }
    isMacRole = args[1] == "mac"
    phase = args[2]
    replica = UUID(uuidString: args[3])
    work = URL(fileURLWithPath: args[4])
    assets = work
  #endif
  let prepFile = work.appendingPathComponent("prepared")
  if phase == "pair" {
    try? FileManager.default.removeItem(at: prepFile)
    try? FileManager.default.removeItem(at: work.appendingPathComponent("ack-after-restart"))
  }
  prepared = FileManager.default.fileExists(atPath: prepFile.path)
  let rt = DeviceRuntime(
    replica: replica, journal: JournalBridge(call: engine, release: { free($0) }), isMac: isMacRole)
  observedRuntime = rt
  try? FileManager.default.removeItem(at: work.appendingPathComponent("awaiting-ack-observed"))
  if phase == "resume" {
    guard var old = try rt.storage.load(PeerTrust.self, "peer") else {
      done("FAIL missing legacy Keychain route", 1)
    }
    old.quarantined = true
    old.fenced = nil
    try rt.storage.save(old, "peer")
  }
  rt.start()
  if phase == "pair" {
    if isMacRole {
      let offered = rt.command("offer")
      guard offered["state"] as? String == "offering", offered["qr"] != nil,
        let offer = rt.queue.sync(execute: { rt.pairing?.offer })
      else { done("FAIL offer \(offered["issue"] ?? "?")", 1) }
      try JSONEncoder().encode(offer).write(
        to: work.appendingPathComponent("offer.json"), options: .atomic)
    } else {
      let url = work.appendingPathComponent("offer.json")
      let offer = try PairingOffer.scan(String(contentsOf: url, encoding: .utf8))
      try FileManager.default.removeItem(at: url)
      rt.queue.sync { rt.useOffer(offer) }
    }
  }
  var previous = ""
  var shown: TimeInterval?
  let start = ProcessInfo.processInfo.systemUptime
  while ProcessInfo.processInfo.systemUptime - start < 145 {
    let value = rt.command("status")
    let state = value["state"] as? String ?? "?"
    if state != previous {
      print("state \(state) \(value["issue"] ?? "")")
      fflush(stdout)
      previous = state
    }
    if phase == "revoked", isMacRole, state == "unpaired", !prepared {
      let drain = DispatchSemaphore(value: 0)
      rt.worker.async { drain.wait() }
      guard rt.command("beginRestore")["restoreReady"] as? Bool == false,
        rt.command("offer")["state"] as? String == "unpaired"
      else { done("FAIL restore gate", 1) }
      drain.signal()
      for _ in 0..<30 {
        if rt.command("status")["restoreReady"] as? Bool == true { break }
        Thread.sleep(forTimeInterval: 0.1)
      }
      guard rt.command("status")["restoreReady"] as? Bool == true,
        rt.command("endRestore")["restoring"] as? Bool == false
      else { done("FAIL drain", 1) }
      try rt.storage.delete("identity")
      done(
        "PASS revoked after restart, library closed; restore waits for worker and blocks pairing")
    }
    if phase == "revoked", !isMacRole, state == "waiting",
      ProcessInfo.processInfo.systemUptime - start > 6
    {
      guard !sawRequest else { done("FAIL revoked data request", 1) }
      _ = rt.command("revoke")
      for _ in 0..<20 {
        if rt.command("status")["state"] as? String == "unpaired" {
          try rt.storage.delete("identity")
          done("PASS revoked peer could not read or write")
        }
        Thread.sleep(forTimeInterval: 0.1)
      }
      done("FAIL revoke cleanup", 1)
    }
    if state == "confirming", shown == nil {
      guard !sawRequest, !prepared, let id = value["confirmationId"] as? String,
        let code = value["code"] as? String
      else { done("FAIL pre-confirmation access", 1) }
      guard rt.command("confirm", confirmation: UUID().uuidString)["confirmed"] as? Bool == false
      else {
        done("FAIL stale confirmation accepted", 1)
      }
      // The script compares the codes from independently authenticated peers.
      print("SAS \(code)")
      fflush(stdout)
      shown = ProcessInfo.processInfo.systemUptime
      Thread.sleep(forTimeInterval: isMacRole ? 1.4 : 0.4)
      guard !prepared, !sawRequest else { done("FAIL early sync", 1) }
      _ = rt.command("confirm", confirmation: id)
    }
    if state == "synced", sawRequest {
      guard value["phase"] == nil, has("awaiting-ack-observed") else {
        done("FAIL synced without a durable-progress check after exchange", 1)
      }
      #if os(macOS)
        if phase == "pair", !isMacRole, ProcessInfo.processInfo.environment["QA_HOLD_SOCKET"] == "1" {
          flag("parked")
          raise(SIGSTOP)
          done("FAIL stale process resumed", 1)
        }
        if phase == "pair", isMacRole, has("check-impostor"), !has("impostor-rejected") {
          try checkImpostor(rt)
        }
        if phase == "rejoin", has("parked") {
          let elapsed = ProcessInfo.processInfo.systemUptime - start
          guard elapsed < 8 else { done("FAIL stale socket blocked restart for \(elapsed)s", 1) }
          print(String(format: "DEVICE_RUNTIME PASS authenticated replacement and ACK in %.3fs", elapsed))
        }
      #endif
      if phase == "resume" {
        let trusted = try rt.storage.load(PeerTrust.self, "peer")
        guard verifiedUpgrade, trusted?.quarantined == false, trusted?.fenced == true else {
          done("FAIL legacy trust not durably recovered", 1)
        }
      }
      if isMacRole && phase == "pair" && !has("ack-after-restart") {
        Thread.sleep(forTimeInterval: 0.1)
        continue
      }
      if phase == "rejoin" && !has("ack-after-restart") { done("FAIL missing offline edit", 1) }
      if phase == "revoke", isMacRole {
        _ = rt.command("beginRestore")
      } else {
        // Give the partner time to observe the same completed round.
        Thread.sleep(forTimeInterval: 1)
        done("PASS " + phase + " using production runtime")
      }
    }
    Thread.sleep(forTimeInterval: 0.1)
  }
  done("FAIL timeout", 1)
}

#if os(iOS)
  class TestDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    var started = false
    func application(
      _ app: UIApplication,
      didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
      window = UIWindow(frame: UIScreen.main.bounds)
      window?.rootViewController = UIViewController()
      window?.makeKeyAndVisible()
      return true
    }
    func applicationDidBecomeActive(_ application: UIApplication) {
      if !started {
        started = true
        DispatchQueue.global().async { do { try test() } catch { done("FAIL \(error)", 1) } }
      }
    }
  }
  UIApplicationMain(
    CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(TestDelegate.self))
#else
  DispatchQueue.global().async { do { try test() } catch { done("FAIL \(error)", 1) } }
  dispatchMain()
#endif
