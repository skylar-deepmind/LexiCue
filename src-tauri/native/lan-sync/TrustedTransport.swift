import CryptoKit
import Foundation
import Network
import Security

/// Parameters for a previously paired peer. The caller supplies the pin from
/// local trust storage. A Bonjour instance name is never an identity.
enum TrustedTransport {
  static let serviceType = "_lexicue-sync._tcp"

  enum Failure: Error {
    case invalidIdentity, invalidPeerKey
  }

  // Version 1 identities use P-256, expressed as uncompressed X9.63 points.
  static func fingerprint(of certificate: SecCertificate) throws -> Data {
    guard let key = SecCertificateCopyKey(certificate),
      let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
      attributes[kSecAttrKeyType] as? String == kSecAttrKeyTypeECSECPrimeRandom as String,
      attributes[kSecAttrKeySizeInBits] as? Int == 256,
      let bytes = SecKeyCopyExternalRepresentation(key, nil) as Data?,
      bytes.count == 65, bytes.first == 4
    else { throw Failure.invalidPeerKey }
    return Data(SHA256.hash(data: bytes))
  }

  static func parameters(
    identity: SecIdentity, peerPin: Data, queue: DispatchQueue,
    onPinMismatch: @escaping () -> Void = {}
  ) throws -> NWParameters {
    guard peerPin.count == SHA256.byteCount else { throw Failure.invalidPeerKey }
    guard let local = sec_identity_create(identity) else { throw Failure.invalidIdentity }
    let tls = NWProtocolTLS.Options()
    let options = tls.securityProtocolOptions
    sec_protocol_options_set_min_tls_protocol_version(options, .TLSv13)
    sec_protocol_options_set_max_tls_protocol_version(options, .TLSv13)
    sec_protocol_options_set_local_identity(options, local)
    sec_protocol_options_set_peer_authentication_required(options, true)
    sec_protocol_options_set_tls_tickets_enabled(options, false)
    sec_protocol_options_set_tls_resumption_enabled(options, false)
    sec_protocol_options_set_verify_block(
      options,
      { _, trustRef, complete in
        let trust = sec_trust_copy_ref(trustRef).takeRetainedValue()
        guard let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first,
          (try? fingerprint(of: leaf)) == peerPin
        else {
          complete(false)
          onPinMismatch()
          return
        }
        // The pinned, self-signed leaf is the sole anchor. DNS names are
        // ephemeral. Keep system X.509 and TLS private-key checks.
        let valid =
          SecTrustSetPolicies(trust, SecPolicyCreateBasicX509()) == errSecSuccess
          && SecTrustSetAnchorCertificates(trust, [leaf] as CFArray) == errSecSuccess
          && SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess
          && SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess
          && SecTrustEvaluateWithError(trust, nil)
        complete(valid)
      }, queue)
    let params = NWParameters(tls: tls)
    params.includePeerToPeer = false
    params.acceptLocalOnly = true
    params.prohibitedInterfaceTypes = [.cellular, .other]
    return params
  }
}
