import Foundation
import CoreGraphics
import ImageIO

// iOS applies its own rounded mask. Use square, fully opaque brand assets
// so the system mask never exposes a pre-rendered border.
let source = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let catalog = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let spec = try JSONSerialization.jsonObject(with: Data(contentsOf: catalog.appendingPathComponent("Contents.json"))) as! [String: Any]
let images = spec["images"] as! [[String: Any]]
let files = Set(images.compactMap { $0["filename"] as? String })
guard images.contains(where: { $0["idiom"] as? String == "ios-marketing" && $0["size"] as? String == "1024x1024" }) else {
  fatalError("App Store icon entry is missing")
}
// Validate every icon before replacing any generated template file.
for name in files.sorted() {
  let input = source.appendingPathComponent(name)
  guard name == URL(fileURLWithPath: name).lastPathComponent,
    let data = CGImageSourceCreateWithURL(input as CFURL, nil),
    let icon = CGImageSourceCreateImageAtIndex(data, 0, nil),
    icon.width == icon.height,
    icon.colorSpace?.model == .rgb,
    [.none, .noneSkipFirst, .noneSkipLast].contains(icon.alphaInfo) else {
    throw NSError(domain: "LexiCueIcons", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected a square opaque RGB brand icon: \(name)"])
  }
}
for name in files.sorted() {
  let png = try Data(contentsOf: source.appendingPathComponent(name))
  try png.write(to: catalog.appendingPathComponent(name), options: .atomic)
}
print("Prepared \(files.count) opaque LexiCue iOS icons.")
