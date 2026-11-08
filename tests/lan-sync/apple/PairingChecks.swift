import CoreImage
import Foundation

enum PairingCheckError: Error { case failed(String) }

func checkPairingOffers() throws {
  var now: TimeInterval = 200
  let pin = Data(repeating: 1, count: 32)
  let window = try PairingWindow(serverPin: pin, uptime: { now })
  // Render with a quiet zone and decode using Apple's QR detector. The raw
  // secret never appears in stdout or in a persisted screenshot.
  let pixels = try window.offer.qrImage()
  let background = CIImage(color: .white).cropped(to: pixels.extent.insetBy(dx: -4, dy: -4))
  let image = pixels.composited(over: background).transformed(
    by: CGAffineTransform(scaleX: 8, y: 8))
  let context = CIContext(options: [.useSoftwareRenderer: true])
  let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: context, options: nil)
  guard let qr = detector?.features(in: image).first as? CIQRCodeFeature,
    let payload = qr.messageString
  else { throw PairingCheckError.failed("QR decode") }
  let scanned = try PairingOffer.scan(payload)
  let other = try PairingWindow(serverPin: pin)
  guard !window.claim(other.offer), window.claim(scanned), !window.claim(scanned) else {
    throw PairingCheckError.failed("single use and session binding")
  }
  let expired = try PairingWindow(serverPin: pin, uptime: { now })
  now += 120
  guard !expired.claim(expired.offer) else { throw PairingCheckError.failed("expiry") }
  other.invalidate()
  guard !other.claim(other.offer) else { throw PairingCheckError.failed("cancellation") }
  let futureVersion = PairingOffer(
    version: 2, service: scanned.service, serverPin: pin, ticket: scanned.ticket)
  let futurePayload = String(decoding: try JSONEncoder().encode(futureVersion), as: UTF8.self)
  guard (try? PairingOffer.scan(futurePayload)) == nil else {
    throw PairingCheckError.failed("version")
  }
  print("pairing: QR round trip, single use, expiration, cancellation and version checks passed")
}
