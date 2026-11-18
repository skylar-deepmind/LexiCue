import AVFoundation
import CoreMedia
import Foundation

typealias AudioProbeCallback = @convention(c) (UInt64, Int64, Int64) -> Void

@_cdecl("lexicue_ios_probe_audio")
func iosProbeAudio(
  _ id: UInt64, _ path: UnsafePointer<CChar>, _ callback: AudioProbeCallback
) {
  let url = URL(fileURLWithPath: String(cString: path))
  Task.detached {
    do {
      let asset = AVURLAsset(url: url)
      let tracks = try await asset.load(.tracks)
      guard tracks.count == 1, let track = tracks.first, track.mediaType == .audio else {
        callback(id, -1, 0)
        return
      }
      let descriptions = try await track.load(.formatDescriptions)
      guard !descriptions.isEmpty, descriptions.allSatisfy({
        CMFormatDescriptionGetMediaSubType($0) == kAudioFormatMPEG4AAC
      }) else {
        callback(id, -1, 0)
        return
      }
      let duration = try await asset.load(.duration).seconds
      let origin = try await track.load(.timeRange).start.seconds
      guard duration.isFinite, (0...7201).contains(duration), origin.isFinite, abs(origin) < 1 else {
        callback(id, -1, 0)
        return
      }
      callback(id, Int64((duration * 1000).rounded()), Int64((origin * 1000).rounded()))
    } catch {
      callback(id, -1, 0)
    }
  }
}
