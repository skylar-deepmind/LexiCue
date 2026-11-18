import Foundation
import SwiftUI
import Translation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

typealias TranslationCallback = @convention(c) (UInt64, UnsafePointer<CChar>?) -> Void

@available(macOS 15, iOS 18, *)
@MainActor
private final class AppleTranslationJob {
  private static var jobs: [UInt64: AppleTranslationJob] = [:]
  private let id: UInt64
  private let texts: [String]
  private let callback: TranslationCallback
  private var detach: (() -> Void)?

  init(id: UInt64, texts: [String], callback: TranslationCallback) {
    self.id = id
    self.texts = texts
    self.callback = callback
  }

  static func start(id: UInt64, texts: [String], callback: TranslationCallback) {
    let job = AppleTranslationJob(id: id, texts: texts, callback: callback)
    jobs[id] = job
    job.mount()
  }

  static func cancel(id: UInt64) {
    jobs[id]?.finish(nil)
  }

  private func mount() {
    let configuration = TranslationSession.Configuration(
      source: Locale.Language(identifier: "en"),
      target: Locale.Language(identifier: "zh-Hans")
    )
    let view = Color.clear
      .allowsHitTesting(false)
      .accessibilityHidden(true)
      .translationTask(configuration) { [weak self] session in
        await self?.run(session)
      }
    #if os(macOS)
    guard let parent = (NSApp.keyWindow ?? NSApp.mainWindow)?.contentView else {
      finish(nil)
      return
    }
    let hosting = NSHostingView(rootView: view)
    hosting.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    parent.addSubview(hosting)
    detach = { hosting.removeFromSuperview() }
    #else
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.filter { $0.activationState == .foregroundActive }.flatMap(\.windows)
    guard var parent = windows.first(where: \.isKeyWindow)?.rootViewController else {
      finish(nil)
      return
    }
    while let presented = parent.presentedViewController { parent = presented }
    let hosting = UIHostingController(rootView: view)
    hosting.view.backgroundColor = .clear
    hosting.view.isUserInteractionEnabled = false
    hosting.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    parent.addChild(hosting)
    parent.view.addSubview(hosting.view)
    hosting.didMove(toParent: parent)
    detach = {
      hosting.willMove(toParent: nil)
      hosting.view.removeFromSuperview()
      hosting.removeFromParent()
    }
    #endif
  }

  private func run(_ session: TranslationSession) async {
    do {
      let requests = texts.enumerated().map {
        TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
      }
      let responses = try await session.translations(from: requests)
      var translations = Array(repeating: "", count: texts.count)
      for response in responses {
        guard let index = response.clientIdentifier.flatMap(Int.init),
          texts.indices.contains(index), texts[index] == response.sourceText
        else { continue }
        translations[index] = response.targetText
      }
      guard translations.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
      else { finish(nil); return }
      finish(try JSONEncoder().encode(translations))
    } catch {
      finish(nil)
    }
  }

  private func finish(_ response: Data?) {
    guard Self.jobs.removeValue(forKey: id) != nil else { return }
    detach?()
    detach = nil
    if let response {
      String(decoding: response, as: UTF8.self).withCString { callback(id, $0) }
    } else {
      callback(id, nil)
    }
  }
}

@_cdecl("lexicue_apple_translate")
func appleTranslate(
  _ id: UInt64, _ input: UnsafePointer<CChar>, _ callback: TranslationCallback
) -> Bool {
  guard #available(macOS 15, iOS 18, *),
    let texts = try? JSONDecoder().decode([String].self, from: Data(String(cString: input).utf8))
  else { return false }
  DispatchQueue.main.async { AppleTranslationJob.start(id: id, texts: texts, callback: callback) }
  return true
}

@_cdecl("lexicue_apple_cancel_translation")
func appleCancelTranslation(_ id: UInt64) {
  if #available(macOS 15, iOS 18, *) {
    DispatchQueue.main.async { AppleTranslationJob.cancel(id: id) }
  }
}
