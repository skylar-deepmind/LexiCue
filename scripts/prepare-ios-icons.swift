import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// iOS init supplies template icons. Replace every catalog entry with our brand
// asset and encode opaque RGB PNGs, as required for App Store icons.
let source = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let catalog = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let spec = try JSONSerialization.jsonObject(with: Data(contentsOf: catalog.appendingPathComponent("Contents.json"))) as! [String: Any]
let images = spec["images"] as! [[String: Any]]
let files = Set(images.compactMap { $0["filename"] as? String })
guard images.contains(where: { $0["idiom"] as? String == "ios-marketing" && $0["size"] as? String == "1024x1024" }) else {
  fatalError("App Store icon entry is missing")
}
// Validate all inputs before replacing any template icon.
let decoded = try files.sorted().map { name -> (String, CGImage) in
  guard name == URL(fileURLWithPath: name).lastPathComponent,
    let input = CGImageSourceCreateWithURL(source.appendingPathComponent(name) as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(input, 0, nil) else {
    throw NSError(domain: "LexiCueIcons", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing brand icon: \(name)"])
  }
  return (name, image)
}
for (name, image) in decoded {
  guard let context = CGContext(data: nil, width: image.width, height: image.height,
    bitsPerComponent: 8, bytesPerRow: image.width * 4,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Cannot create opaque icon context")
  }
  let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(bounds)
  context.draw(image, in: bounds)
  let output = catalog.appendingPathComponent(name)
  guard let opaque = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Cannot encode brand icon: \(name)")
  }
  CGImageDestinationAddImage(destination, opaque, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save brand icon: \(name)") }
}
print("Prepared \(files.count) opaque LexiCue iOS icons.")
