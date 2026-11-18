import AVFoundation
import CoreMedia
import Foundation

typealias AudioProbeCallback = @convention(c) (UInt64, Int64, Int64) -> Void

@_cdecl("lexicue_ios_probe_audio")
func iosProbeAudio(
  _ id: UInt64, _ path: UnsafePointer<CChar>, _ output: UnsafePointer<CChar>,
  _ callback: AudioProbeCallback
) {
  let url = URL(fileURLWithPath: String(cString: path))
  let target = URL(fileURLWithPath: String(cString: output))
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
      let timing = try await remux(asset: asset, track: track, format: descriptions[0], to: target)
      callback(id, timing.duration, timing.origin)
    } catch {
      callback(id, -1, 0)
    }
  }
}

private enum AudioRemuxError: Error { case invalidMedia }

// The adaptive MP4 header can advertise a tail with no AAC packets.
// Copy the original samples into a standalone M4A and use their verified time range.
private func remux(
  asset: AVAsset, track: AVAssetTrack, format: CMFormatDescription, to target: URL
) async throws -> (duration: Int64, origin: Int64) {
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
  output.alwaysCopiesSampleData = false
  let writer = try AVAssetWriter(outputURL: target, fileType: .m4a)
  let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: format)
  writer.shouldOptimizeForNetworkUse = true
  guard reader.canAdd(output), writer.canAdd(input) else { throw AudioRemuxError.invalidMedia }
  reader.add(output)
  writer.add(input)
  guard reader.startReading(), writer.startWriting() else { throw AudioRemuxError.invalidMedia }
  defer {
    if reader.status == .reading { reader.cancelReading() }
    if writer.status == .writing { writer.cancelWriting() }
  }
  writer.startSession(atSourceTime: .zero)
  var first: CMTime?
  var end: CMTime = .zero
  let deadline = ProcessInfo.processInfo.systemUptime + 20
  while let sample = output.copyNextSampleBuffer() {
    // The reader can send a timing marker with no compressed samples at the end.
    guard sample.numSamples > 0 else { continue }
    let start = sample.presentationTimeStamp
    let next = start + sample.duration
    guard start.seconds.isFinite, next.seconds.isFinite, next > start,
      (0...7201).contains(next.seconds), abs((start - end).seconds) <= 0.025
    else { throw AudioRemuxError.invalidMedia }
    if first == nil {
      guard abs(start.seconds) <= 0.025 else { throw AudioRemuxError.invalidMedia }
      first = start
    }
    while !input.isReadyForMoreMediaData {
      guard writer.status == .writing, ProcessInfo.processInfo.systemUptime < deadline
      else { throw AudioRemuxError.invalidMedia }
      try await Task.sleep(nanoseconds: 2_000_000)
    }
    guard input.append(sample) else { throw AudioRemuxError.invalidMedia }
    end = next
  }
  guard reader.status == .completed, let first, end > .zero else { throw AudioRemuxError.invalidMedia }
  input.markAsFinished()
  await writer.finishWriting()
  guard writer.status == .completed else { throw AudioRemuxError.invalidMedia }
  let completed = AVURLAsset(url: target)
  let decodedDuration = try await completed.load(.duration).seconds
  guard decodedDuration.isFinite, abs(decodedDuration - end.seconds) < 0.2
  else { throw AudioRemuxError.invalidMedia }
  return (Int64((end.seconds * 1000).rounded()), Int64((first.seconds * 1000).rounded()))
}
