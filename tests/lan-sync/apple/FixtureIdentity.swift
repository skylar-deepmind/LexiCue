import Foundation
import Security

enum ProbeError: Error { case invalidFixture, noIdentity, invalidMode }

func identity(in directory: URL, named name: String) throws -> SecIdentity {
  let data = try Data(contentsOf: directory.appendingPathComponent(name + ".p12"))
  var imported: CFArray?
  var options: [CFString: Any] = [kSecImportExportPassphrase: "probe"]
  #if os(macOS)
    options[kSecImportToMemoryOnly] = true
  #endif
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
