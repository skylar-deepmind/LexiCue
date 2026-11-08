// macOS transport probe. The runner generates fresh fixture identities for
// every invocation. Only fixed probe bytes can cross this connection.
import Foundation
import Network
import Security

enum ProbeError: Error { case invalidFixture, noIdentity, invalidMode }

func identity(in directory: URL, named name: String) throws -> SecIdentity {
  let data = try Data(contentsOf: directory.appendingPathComponent(name + ".p12"))
  var imported: CFArray?
  let options: [CFString: Any] = [
    kSecImportExportPassphrase: "probe", kSecImportToMemoryOnly: true,
  ]
  guard SecPKCS12Import(data as CFData, options as CFDictionary, &imported) == errSecSuccess,
    let items = imported as? [[String: Any]],
    let value = items.first?[kSecImportItemIdentity as String],
    CFGetTypeID(value as CFTypeRef) == SecIdentityGetTypeID()
  else { throw ProbeError.noIdentity }
  return (value as! SecIdentity)
}

func pin(in directory: URL, named name: String) throws -> Data {
  let data = try Data(contentsOf: directory.appendingPathComponent(name + ".der"))
  guard let cert = SecCertificateCreateWithData(nil, data as CFData) else {
    throw ProbeError.invalidFixture
  }
  return try TrustedTransport.fingerprint(of: cert)
}

final class Verification {
  var pinRejected = false
}

final class Probe {
  let serverCheck = Verification()
  let clientCheck = Verification()
  let queue = DispatchQueue(label: "lexicue.lan.probe")
  let name = UUID().uuidString
  let clientOptions: NWParameters
  let serverOptions: NWParameters
  let mode: String
  var browser: NWBrowser?
  var listener: NWListener?
  var client: NWConnection?
  var server: NWConnection?
  let ping = Data("probe-request".utf8)
  let pong = Data("probe-reply".utf8)

  init(directory: URL, mode: String) throws {
    self.mode = mode
    guard ["trusted", "wrong-server", "wrong-client"].contains(mode) else {
      throw ProbeError.invalidMode
    }
    serverOptions = try TrustedTransport.parameters(
      identity: identity(in: directory, named: "mac"),
      peerPin: pin(in: directory, named: mode == "wrong-client" ? "stranger" : "phone"),
      queue: queue
    ) { [serverCheck] in serverCheck.pinRejected = true }
    clientOptions = try TrustedTransport.parameters(
      identity: identity(in: directory, named: "phone"),
      peerPin: pin(in: directory, named: mode == "wrong-server" ? "stranger" : "mac"), queue: queue
    ) { [clientCheck] in clientCheck.pinRejected = true }
  }

  func start() throws {
    let listener = try NWListener(using: serverOptions)
    self.listener = listener
    listener.service = NWListener.Service(name: name, type: TrustedTransport.serviceType)
    listener.stateUpdateHandler = { state in
      if case .failed(let error) = state { self.fail("listener: \(error)") }
    }
    listener.newConnectionHandler = { connection in
      guard self.server == nil else {
        connection.cancel()
        return
      }
      self.server = connection
      self.watch(connection, serverSide: true)
    }
    listener.start(queue: queue)
    let browser = NWBrowser(
      for: .bonjour(type: TrustedTransport.serviceType, domain: "local."), using: .tcp)
    self.browser = browser
    browser.stateUpdateHandler = { state in
      if case .failed(let error) = state { self.fail("browser: \(error)") }
    }
    browser.browseResultsChangedHandler = { results, _ in
      guard self.client == nil else { return }
      for result in results {
        guard case .service(let name, _, _, _) = result.endpoint, name == self.name else {
          continue
        }
        let connection = NWConnection(to: result.endpoint, using: self.clientOptions)
        self.client = connection
        self.watch(connection, serverSide: false)
        break
      }
    }
    browser.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 12) { self.fail("discovery or handshake timeout") }
  }

  func watch(_ connection: NWConnection, serverSide: Bool) {
    connection.stateUpdateHandler = { state in
      switch state {
      case .ready:
        if serverSide {
          self.expect(self.ping, on: connection) {
            guard self.mode == "trusted" else { self.fail("unauthorized application data") }
            self.send(self.pong, on: connection)
          }
        } else {
          self.send(self.ping, on: connection)
          self.expect(self.pong, on: connection) {
            guard self.mode == "trusted" else { self.fail("unauthorized reply") }
            print("trusted: Bonjour discovery and bidirectional TLS exchange passed")
            exit(0)
          }
        }
      case .failed(let error):
        // TLS 1.3 alerts may reach the opposite endpoint first. Require
        // evidence of both the actual pin check and a TLS failure.
        if case .tls = error,
          (self.serverCheck.pinRejected && self.mode == "wrong-client")
            || (self.clientCheck.pinRejected && self.mode == "wrong-server")
        {
          print("\(self.mode): rejected during TLS authentication")
          exit(0)
        }
        if self.mode == "trusted" { self.fail("handshake: \(error)") }
      default: break
      }
    }
    connection.start(queue: queue)
  }

  func send(_ bytes: Data, on connection: NWConnection) {
    connection.send(
      content: bytes,
      completion: .contentProcessed { error in
        if let error, self.mode == "trusted" { self.fail("send: \(error)") }
      })
  }

  func expect(_ bytes: Data, on connection: NWConnection, then: @escaping () -> Void) {
    connection.receive(minimumIncompleteLength: bytes.count, maximumLength: bytes.count) {
      data, _, _, error in
      guard error == nil, data == bytes else {
        if self.mode == "trusted" { self.fail("missing or invalid payload") }
        return
      }
      then()
    }
  }

  func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((mode + ": " + message + "\n").utf8))
    exit(1)
  }
}

guard CommandLine.arguments.count == 3 else { exit(2) }
if CommandLine.arguments[2] == "pairing" {
  try checkPairingOffers()
  exit(0)
}
let probe = try Probe(
  directory: URL(fileURLWithPath: CommandLine.arguments[1]), mode: CommandLine.arguments[2])
try probe.start()
dispatchMain()
