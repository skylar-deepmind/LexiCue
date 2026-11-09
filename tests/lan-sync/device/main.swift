// QA-only signed hosts. The iPhone discovers the Mac, and the Mac drives a
// bidirectional saved-record round. TLS uses fresh, pre-pinned fixture keys.
import Foundation
import Network

#if os(iOS)
  import UIKit
  let isMac = false
#else
  let isMac = true
#endif

enum Failure: Error {
  case missingConfig, disconnected, timeout, malformed
  case unexpected(String)
}
func finish(_ message: String, _ code: Int32) -> Never {
  print("JOURNAL_PROBE \(message)")
  fflush(stdout)
  exit(code)
}

final class Channel {
  let connection: NWConnection
  init(_ connection: NWConnection) { self.connection = connection }

  func send(_ text: String) throws {
    let body = Data(text.utf8)
    guard body.count <= 65536 else { throw Failure.malformed }
    var count = UInt32(body.count).bigEndian
    var data = withUnsafeBytes(of: &count) { Data($0) }
    data.append(body)
    let done = DispatchSemaphore(value: 0)
    var issue: NWError?
    connection.send(
      content: data,
      completion: .contentProcessed {
        issue = $0
        done.signal()
      })
    guard done.wait(timeout: .now() + 10) == .success else { throw Failure.timeout }
    if let issue { throw issue }
  }

  func read(_ size: Int) throws -> Data {
    let done = DispatchSemaphore(value: 0)
    var value: Data?
    connection.receive(minimumIncompleteLength: size, maximumLength: size) { data, _, _, _ in
      value = data
      done.signal()
    }
    guard done.wait(timeout: .now() + 12) == .success else { throw Failure.timeout }
    guard let value, value.count == size else { throw Failure.disconnected }
    return value
  }

  func receive() throws -> String {
    let size = try read(4).reduce(0) { $0 * 256 + Int($1) }
    guard (1...65536).contains(size), let text = String(data: try read(size), encoding: .utf8)
    else { throw Failure.malformed }
    return text
  }
}

var channel: Channel?
func exchange(_ raw: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
  guard let channel, let raw else { return nil }
  do {
    try channel.send(String(cString: raw))
    return strdup(try channel.receive())
  } catch { return nil }
}

final class Host {
  let pair: String
  let phase: String
  let db: String
  let assets: URL
  let queue = DispatchQueue(label: "lexicue.qa.network")
  var browser: NWBrowser?
  var listener: NWListener?
  var active: NWConnection?

  init() throws {
    let args = CommandLine.arguments
    guard args.count >= 3, UUID(uuidString: args[1]) != nil,
      ["drop", "resume", "material-drop", "material-resume", "material-edit"].contains(args[2])
    else { throw Failure.missingConfig }
    pair = args[1]
    phase = args[2]
    #if os(macOS)
      guard args.count == 4 else { throw Failure.missingConfig }
      assets = URL(fileURLWithPath: args[3])
      db =
        assets.appendingPathComponent(pair + (phase.hasPrefix("material") ? "-material.db" : ".db"))
        .path
    #else
      assets = Bundle.main.resourceURL!
      db =
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent(pair + (phase.hasPrefix("material") ? "-material.db" : ".db")).path
    #endif
  }

  func engine(_ command: String, _ input: String = "") throws -> String {
    guard let ptr = journal_probe(db, isMac, pair, command, input, exchange) else {
      throw Failure.malformed
    }
    defer { journal_probe_free(ptr) }
    let value = String(cString: ptr)
    if value.hasPrefix("ERROR ") { throw Failure.unexpected(value) }
    return value
  }

  func start() throws {
    if phase == "material-drop" {
      _ = try engine("material-seed")
    } else if phase == "material-resume" {
      print(try engine("material-dropped"))
    } else if phase == "material-edit" {
      if !isMac { _ = try engine("material-edit") }
    } else if phase == "drop" {
      _ = try engine("seed")
    } else {
      print("reopened: " + (try engine("dropped")))
    }
    let params = try TrustedTransport.parameters(
      identity: identity(in: assets, named: isMac ? "mac" : "phone"),
      peerPin: pin(in: assets, named: isMac ? "phone" : "mac"), queue: queue)
    let service = TrustedTransport.serviceType
    if isMac {
      let listener = try NWListener(using: params)
      self.listener = listener
      listener.service = NWListener.Service(name: pair, type: service)
      listener.newConnectionHandler = { self.connect($0) }
      listener.start(queue: queue)
    } else {
      let browser = NWBrowser(for: .bonjour(type: service, domain: "local."), using: .tcp)
      self.browser = browser
      browser.browseResultsChangedHandler = { results, _ in
        guard self.active == nil else { return }
        for result in results {
          if case .service(let name, _, _, _) = result.endpoint, name == self.pair {
            self.connect(NWConnection(to: result.endpoint, using: params))
            break
          }
        }
      }
      browser.start(queue: queue)
    }
    queue.asyncAfter(deadline: .now() + 90) { finish("FAIL discovery/session timeout", 1) }
  }

  func connect(_ connection: NWConnection) {
    guard active == nil else {
      connection.cancel()
      return
    }
    active = connection
    connection.stateUpdateHandler = { state in
      if case .ready = state {
        DispatchQueue.global().async {
          do { try self.session(connection) } catch { finish("FAIL \(error)", 1) }
        }
      }
      if case .failed(let error) = state { finish("FAIL TLS \(error)", 1) }
    }
    connection.start(queue: queue)
  }

  func session(_ connection: NWConnection) throws {
    let link = Channel(connection)
    channel = link
    let material = phase.hasPrefix("material")
    let verify =
      material
      ? (phase == "material-edit" ? "material-verify-edited" : "material-verify") : "verify"
    let drop = phase == "drop" || phase == "material-drop"
    let dropped = material ? "material-dropped" : "dropped"
    if isMac {
      if drop {
        do {
          _ = try engine("run")
          throw Failure.unexpected("lost receipt was acknowledged")
        } catch Failure.unexpected("ERROR disconnected") {
          finish("PASS dropped " + (try engine(dropped)), 0)
        }
      }
      print(
        try engine(
          phase == "material-edit"
            ? "material-patch" : (phase == "material-resume" ? "material-resume" : "run")))
      try link.send("VERIFY")
      let remote = try link.receive()
      guard remote == (try engine(verify)) else { throw Failure.unexpected(remote) }
      try link.send("DONE")
      finish("PASS both devices: " + remote, 0)
    }
    while true {
      let request = try link.receive()
      if request == "VERIFY" {
        try link.send(try engine(verify))
        continue
      }
      if request == "DONE" { finish("PASS iPhone " + (try engine(verify)), 0) }
      let reply = try engine("respond", request)
      if drop,
        let object = try JSONSerialization.jsonObject(with: Data(reply.utf8)) as? [String: Any],
        object[material ? "Staged" : "Applied"] != nil
      {
        let status = try engine(dropped)
        connection.cancel()
        finish("PASS disconnected: " + status, 0)
      }
      try link.send(reply)
    }
  }
}
var host: Host?
func start() {
  do {
    host = try Host()
    try host!.start()
  } catch { finish("FAIL \(error)", 1) }
}
#if os(iOS)
  class Delegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func applicationDidBecomeActive(_ application: UIApplication) { if host == nil { start() } }
    func application(
      _ app: UIApplication,
      didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
      window = UIWindow(frame: UIScreen.main.bounds)
      window?.rootViewController = UIViewController()
      window?.makeKeyAndVisible()
      return true
    }
  }
  UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(Delegate.self))
#else
  start()
  dispatchMain()
#endif
