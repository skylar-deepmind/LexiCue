import Foundation
import Network

/// Called only from a background session worker. Network.framework completions
/// arrive on a separate serial network queue, even while waiting for a reply.
@available(macOS 12, *)
final class LinkChannel {
  let connection: NWConnection
  init(_ connection: NWConnection) { self.connection = connection }

  func send(_ text: String) throws {
    let body = Data(text.utf8)
    guard !body.isEmpty, body.count <= Self.maximum else { throw DeviceLinkError.malformed }
    var size = UInt32(body.count).bigEndian
    var bytes = withUnsafeBytes(of: &size) { Data($0) }
    bytes.append(body)
    let done = DispatchSemaphore(value: 0)
    var issue: NWError?
    connection.send(
      content: bytes,
      completion: .contentProcessed {
        issue = $0
        done.signal()
      })
    guard done.wait(timeout: .now() + 30) == .success else { throw DeviceLinkError.timeout }
    if let issue { throw issue }
  }

  private static let maximum = 10 * 1024 * 1024

  private func read(_ count: Int, timeout: TimeInterval) throws -> Data {
    let done = DispatchSemaphore(value: 0)
    var bytes: Data?
    connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, _ in
      bytes = data
      done.signal()
    }
    guard done.wait(timeout: .now() + timeout) == .success else { throw DeviceLinkError.timeout }
    guard let bytes, bytes.count == count else { throw DeviceLinkError.disconnected }
    return bytes
  }

  func receive(limit: Int? = nil, timeout: TimeInterval = 30) throws -> String {
    let count = try read(4, timeout: timeout).reduce(0) { ($0 << 8) | Int($1) }
    guard (1...(limit ?? Self.maximum)).contains(count),
      let value = String(data: try read(count, timeout: timeout), encoding: .utf8)
    else { throw DeviceLinkError.malformed }
    return value
  }

  func sendObject(_ fields: [String: Any]) throws {
    try send(String(decoding: JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
  }

  func object(limit: Int = 2048, timeout: TimeInterval = 30) throws -> [String: Any] {
    guard
      let object = try JSONSerialization.jsonObject(
        with: Data(receive(limit: limit, timeout: timeout).utf8)) as? [String: Any]
    else { throw DeviceLinkError.malformed }
    if object["kind"] as? String == "update" { throw DeviceLinkError.incompatible }
    if object["kind"] as? String == "fault" {
      if object["issue"] as? String == "reconcile" { throw DeviceLinkError.reconcile }
      throw DeviceLinkError.engine(
        object["issue"] as? String == "backup" ? "peer backup" : "peer merge")
    }
    return object
  }
}
