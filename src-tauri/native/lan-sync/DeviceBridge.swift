import Foundation

public typealias LinkExchange = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) ->
  UnsafeMutablePointer<CChar>?
public typealias LinkEngine = @convention(c) (
  UnsafePointer<CChar>?, UnsafePointer<CChar>?, UnsafePointer<CChar>?,
  UnsafeMutableRawPointer?, LinkExchange?
) -> UnsafeMutablePointer<CChar>?
public typealias LinkRelease = @convention(c) (UnsafeMutablePointer<CChar>?) -> Void

@available(macOS 12, *)
struct JournalBridge {
  let call: LinkEngine
  let release: LinkRelease

  func run(
    _ action: String, _ route: ReplicaRoute? = nil, input: String = "",
    link: LinkChannel? = nil
  ) throws -> Any {
    let routeJSON =
      try route.map { String(decoding: try JSONEncoder().encode($0), as: UTF8.self) } ?? "{}"
    let context = link.map { Unmanaged.passUnretained($0).toOpaque() }
    let exchange: LinkExchange = { context, request in
      guard let context, let request else { return nil }
      let channel = Unmanaged<LinkChannel>.fromOpaque(context).takeUnretainedValue()
      do {
        try channel.send(String(cString: request))
        return strdup(try channel.receive())
      } catch { return nil }
    }
    guard let result = call(action, routeJSON, input, context, link == nil ? nil : exchange) else {
      throw DeviceLinkError.disconnected
    }
    defer { release(result) }
    guard let data = String(cString: result).data(using: .utf8),
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw DeviceLinkError.malformed
    }
    if let error = object["error"] as? String {
      if object["kind"] as? String == "reconcile" || error == "reconcile" {
        throw DeviceLinkError.reconcile
      }
      if error == "disconnected" { throw DeviceLinkError.disconnected }
      if error.localizedCaseInsensitiveContains("incompatible")
        || error.localizedCaseInsensitiveContains("protocol version")
      {
        throw DeviceLinkError.incompatible
      }
      throw DeviceLinkError.engine(error)
    }
    guard let value = object["ok"] else { throw DeviceLinkError.malformed }
    return value
  }
}

@available(macOS 12, *)
private var runtime: DeviceRuntime?
private let startLock = NSLock()

@_cdecl("lexicue_lan_start")
public func lexicueLanStart(
  _ replica: UnsafePointer<CChar>?, _ engine: LinkEngine?, _ release: LinkRelease?
) {
  if #available(macOS 12, *) {
    guard let replica, let id = UUID(uuidString: String(cString: replica)), let engine, let release
    else { return }
    startLock.lock()
    defer { startLock.unlock() }
    guard runtime == nil else { return }
    let service = DeviceRuntime(replica: id, journal: JournalBridge(call: engine, release: release))
    runtime = service
    service.start()
  }
}

@_cdecl("lexicue_lan_command")
public func lexicueLanCommand(_ raw: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
  #if os(macOS)
    let role = "mac"
  #else
    let role = "iphone"
  #endif
  var status: [String: Any] = [
    "role": role, "state": "error", "issue": "unavailable", "paired": false,
  ]
  if #unavailable(macOS 12) { status = ["role": role, "state": "unsupported", "paired": false] }
  if #available(macOS 12, *), let raw {
    startLock.lock()
    let service = runtime
    startLock.unlock()
    if let service,
      let object = try? JSONSerialization.jsonObject(with: Data(String(cString: raw).utf8))
        as? [String: Any],
      let action = object["action"] as? String
    {
      status = service.command(action, confirmation: object["confirmationId"] as? String)
    }
  }
  guard let data = try? JSONSerialization.data(withJSONObject: status) else { return nil }
  return strdup(String(decoding: data, as: UTF8.self))
}

@_cdecl("lexicue_lan_exclude_backup")
public func lexicueLanExcludeBackup(_ path: UnsafePointer<CChar>?) -> Bool {
  guard let path else { return false }
  var directory = URL(fileURLWithPath: String(cString: path), isDirectory: true)
  var values = URLResourceValues()
  values.isExcludedFromBackup = true
  do {
    try directory.setResourceValues(values)
    return true
  } catch { return false }
}
