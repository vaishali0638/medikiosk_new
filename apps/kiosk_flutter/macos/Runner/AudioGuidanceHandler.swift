import AVFoundation
import FlutterMacOS
import Foundation

/// Spoken guidance on macOS, backed by AVSpeechSynthesizer.
///
/// The Android handler is the one that ships on a kiosk. This exists so the feature can be
/// developed and heard on the machine it is being built on — a text-to-speech path nobody
/// can listen to is how the Android channel went unimplemented for fifteen phases without
/// anybody noticing.
///
/// It holds to the same three rules as the Android side, because they are correctness
/// rules and not platform details:
///
///  - A language is only supported if a voice for it actually exists. `AVSpeechSynthesisVoice`
///    returns nil for a language with no installed voice, and that is reported as
///    unsupported rather than substituted.
///  - There is no fallback to another language. A Malayalam prompt read in Hindi sounds
///    authoritative and is not understood.
///  - A new utterance stops the previous one, so a patient who moves on does not hear the
///    last screen finishing underneath the new one.
class AudioGuidanceHandler: NSObject {
  static let channelName = "org.medikiosk/audio_guidance"

  private let synthesizer = AVSpeechSynthesizer()

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "speak":
      let args = call.arguments as? [String: Any]
      result(speak(text: args?["text"] as? String, languageTag: args?["language"] as? String))
    case "stop":
      synthesizer.stopSpeaking(at: .immediate)
      result(nil)
    case "isLanguageSupported":
      let args = call.arguments as? [String: Any]
      result(voice(for: args?["language"] as? String) != nil)
    case "supportedLanguages":
      let args = call.arguments as? [String: Any]
      let tags = args?["languages"] as? [String] ?? []
      result(tags.filter { voice(for: $0) != nil })
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  /// Returns whether speech actually started, never whether it was merely requested.
  private func speak(text: String?, languageTag: String?) -> Bool {
    guard let text, !text.isEmpty, let voice = voice(for: languageTag) else { return false }

    synthesizer.stopSpeaking(at: .immediate)
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice
    // A patient reading along with the audio needs it slower than the default.
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.9
    synthesizer.speak(utterance)
    return true
  }

  /// Resolves a BCP-47 tag to an installed voice, or nil.
  ///
  /// Indian voices are published per region, so a bare tag is tried with `-IN` before being
  /// given up on. Nepali is the exception: its voice is published as `ne-NP`.
  private func voice(for languageTag: String?) -> AVSpeechSynthesisVoice? {
    guard let tag = languageTag, !tag.isEmpty else { return nil }
    let normalised = tag.replacingOccurrences(of: "_", with: "-")

    if normalised.contains("-") { return AVSpeechSynthesisVoice(language: normalised) }

    let region = normalised == "ne" ? "NP" : "IN"
    return AVSpeechSynthesisVoice(language: "\(normalised)-\(region)")
      ?? AVSpeechSynthesisVoice(language: normalised)
  }
}
