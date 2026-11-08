import CoreImage
import Foundation
import Security

/// The QR carries a temporary bearer ticket and a server public-key pin. It is
/// intended for the scanner, never diagnostics or Bonjour TXT records.
struct PairingOffer: Codable, Equatable {
  static let version = 1
  let version: Int
  let service: UUID
  let serverPin: Data
  let ticket: Data

  enum Failure: Error { case invalid, randomness, unavailable }

  static func scan(_ text: String) throws -> Self {
    guard text.utf8.count <= 512 else { throw Failure.invalid }
    let value = try JSONDecoder().decode(Self.self, from: Data(text.utf8))
    guard value.version == Self.version, value.serverPin.count == 32, value.ticket.count == 32
    else {
      throw Failure.invalid
    }
    return value
  }

  func qrImage() throws -> CIImage {
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { throw Failure.unavailable }
    filter.setValue(try JSONEncoder().encode(self), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let image = filter.outputImage else { throw Failure.unavailable }
    return image
  }
}

/// Owned by the Mac pairing screen. Invalidate on cancel, sleep, connection
/// loss or replacement. No ticket survives a process restart.
final class PairingWindow {
  let offer: PairingOffer
  private let uptime: () -> TimeInterval
  private let expires: TimeInterval
  private let lock = NSLock()
  private var available = true

  init(
    serverPin: Data, uptime: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
  ) throws {
    guard serverPin.count == 32 else { throw PairingOffer.Failure.invalid }
    var ticket = [UInt8](repeating: 0, count: 32)
    let count = ticket.count
    guard SecRandomCopyBytes(kSecRandomDefault, count, &ticket) == errSecSuccess else {
      throw PairingOffer.Failure.randomness
    }
    self.uptime = uptime
    self.expires = uptime() + 120
    self.offer = PairingOffer(
      version: PairingOffer.version, service: UUID(), serverPin: serverPin, ticket: Data(ticket))
  }

  /// Claim only after the TLS pairing channel has verified the candidate's
  /// proof of private-key possession. Claiming does not grant data access.
  func claim(_ candidate: PairingOffer) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard available, uptime() < expires, candidate == offer else { return false }
    available = false
    return true
  }

  var canBeClaimed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return available && uptime() < expires
  }

  func invalidate() {
    lock.lock()
    defer { lock.unlock() }
    available = false
  }
}

extension PairingOffer {
  func pngURI() throws -> String {
    let qr = try qrImage()
    // A white four-module quiet zone keeps camera recognition reliable against
    // either app theme, including displays scaled by accessibility settings.
    let white = CIImage(color: CIColor(red: 1, green: 1, blue: 1))
      .cropped(to: qr.extent.insetBy(dx: -4, dy: -4))
    let image = qr.composited(over: white).transformed(by: CGAffineTransform(scaleX: 6, y: 6))
    guard
      let bytes = CIContext().pngRepresentation(
        of: image, format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
    else { throw Failure.unavailable }
    return "data:image/png;base64," + bytes.base64EncodedString()
  }
}
