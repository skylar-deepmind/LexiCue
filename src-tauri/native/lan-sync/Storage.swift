import Foundation
import Security

struct ReplicaRoute: Codable, Equatable {
  let pair: UUID
  let from: UUID
  let to: UUID
}

struct PeerTrust: Codable {
  let route: ReplicaRoute
  let pin: Data
  let name: String
  // A phone that lost the final approval response may retry the pinned Mac.
  // It must see the Mac's durable approval before activating its own library.
  var provisional: Bool
  var revoked: Bool? = nil
  var provisionalCode: String? = nil
  var quarantined: Bool? = nil
}

enum DeviceLinkError: Error {
  case disconnected, timeout, malformed, expired, canceled, keychain, identity, incompatible
  case reconcile
  case engine(String)
}

struct LinkKeychain {
  private let service: String

  init(installation: UUID) {
    service =
      (Bundle.main.bundleIdentifier ?? "com.lexicue.app") + ".device-sync."
      + installation.uuidString
  }

  private func query(_ account: String) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword, kSecAttrAccount: account, kSecAttrService: service,
      kSecAttrSynchronizable: false,
    ]
  }

  func load<T: Decodable>(_ type: T.Type, _ account: String) throws -> T? {
    var q = query(account)
    q[kSecReturnData] = true
    q[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw DeviceLinkError.keychain
    }
    return try JSONDecoder().decode(type, from: data)
  }

  func save<T: Encodable>(_ value: T, _ account: String) throws {
    let data = try JSONEncoder().encode(value)
    let query = self.query(account)
    var add = query
    add[kSecValueData] = data
    add[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status != errSecSuccess else { return }
    guard status == errSecDuplicateItem,
      SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary) == errSecSuccess
    else { throw DeviceLinkError.keychain }
  }

  func delete(_ account: String) throws {
    let status = SecItemDelete(query(account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw DeviceLinkError.keychain
    }
  }
}

struct IdentityArchive: Codable {
  let p12: Data
  let password: String

  func importIdentity() throws -> SecIdentity {
    var options: [CFString: Any] = [kSecImportExportPassphrase: password]
    #if os(macOS)
      if #available(macOS 15, *) { options[kSecImportToMemoryOnly] = true }
    #endif
    var imported: CFArray?
    guard SecPKCS12Import(p12 as CFData, options as CFDictionary, &imported) == errSecSuccess,
      let rows = imported as? [[String: Any]],
      let value = rows.first?[kSecImportItemIdentity as String],
      CFGetTypeID(value as CFTypeRef) == SecIdentityGetTypeID()
    else { throw DeviceLinkError.identity }
    return value as! SecIdentity
  }
}
