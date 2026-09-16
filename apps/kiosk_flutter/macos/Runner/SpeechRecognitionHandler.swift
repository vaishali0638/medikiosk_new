import AVFoundation
import FlutterMacOS
import Foundation
import Speech

/// On-device speech recognition for patients who cannot type.
///
/// `requiresOnDeviceRecognition = true`, always, and the handler refuses rather than
/// falling back. Apple's default is to send the audio to its servers, and the audio here is
/// a patient describing their symptoms — the most sensitive thing they will say today, to a
/// party the hospital has no agreement with. A missing feature is recoverable; an
/// unnoticed disclosure of health data is not.
///
/// Nothing here decides anything. It returns a transcript, the caller shows it to the
/// patient, and only what the patient confirms is stored — with `modality: VOICE`, so the
/// clinician reading it knows a machine heard it rather than a person typed it.
class SpeechRecognitionHandler: NSObject {
  static let channelName = "org.medikiosk/speech_recognition"

  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var timeout: DispatchWorkItem?

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any]

    switch call.method {
    case "isLanguageAvailable":
      result(recognizer(for: args?["language"] as? String) != nil)
    case "listen":
      listen(
        languageTag: args?["language"] as? String,
        maxSeconds: args?["maxSeconds"] as? Int ?? 30,
        result: result
      )
    case "stop":
      stopListening()
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  /// A recogniser that can work without the network, or nil.
  ///
  /// Tries the Indian region first — voices and recognisers are both published per region,
  /// and `ta-IN` is the right model for a patient in an Indian OPD. Where that has no
  /// on-device model it falls back to ANOTHER REGION OF THE SAME LANGUAGE, which is a
  /// different accent model for the language the patient actually chose, not a different
  /// language. That distinction is the whole reason the fallback is safe: an en-IN speaker
  /// recognised by the en-US model may get a worse transcript, and the confirmation gate
  /// exists precisely so they read it before it becomes their answer.
  ///
  /// It does NOT fall back across languages, and it does not fall back to the network.
  /// This was found on a development Mac where the only on-device models installed were
  /// en-US, en-ID, en-PH and en-SA: asking for en-IN refused, and English voice input was
  /// unavailable on a machine that could plainly do English.
  private func recognizer(for languageTag: String?) -> SFSpeechRecognizer? {
    guard let tag = languageTag, !tag.isEmpty else { return nil }

    let normalised = tag.replacingOccurrences(of: "_", with: "-")
    let language = String(normalised.split(separator: "-")[0])
    let preferredRegion = normalised.contains("-")
      ? String(normalised.split(separator: "-")[1])
      : (language == "ne" ? "NP" : "IN")

    var candidates = ["\(language)-\(preferredRegion)"]

    // Then other regions of the same language, best acoustic match first. Alphabetical
    // order alone picked en-ID for an Indian patient when en-GB was installed, which is a
    // worse model for no reason. The list is a heuristic and says so; anything not named
    // falls through to alphabetical, which is at least deterministic.
    let betterFirst: [String: [String]] = [
      "en": ["IN", "GB", "AU", "US"],
      "bn": ["IN", "BD"],
      "ta": ["IN", "SG", "MY", "LK"],
      "ur": ["IN", "PK"],
      "ne": ["NP", "IN"],
    ]
    let ranked = betterFirst[language] ?? []
    let available = SFSpeechRecognizer.supportedLocales()
      .map { $0.identifier.replacingOccurrences(of: "_", with: "-") }
      .filter { $0.hasPrefix("\(language)-") && $0 != candidates[0] }

    candidates += ranked.map { "\(language)-\($0)" }.filter { available.contains($0) }
    candidates += available.filter { !candidates.contains($0) }.sorted()

    for identifier in candidates {
      guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: identifier)),
        recognizer.isAvailable,
        // The rule that does not bend: a recogniser needing the network is not usable here.
        recognizer.supportsOnDeviceRecognition
      else { continue }
      return recognizer
    }
    return nil
  }

  private func listen(languageTag: String?, maxSeconds: Int, result: @escaping FlutterResult) {
    guard let recognizer = recognizer(for: languageTag) else {
      // Deliberately distinguished from "not supported": the hospital's remedy is to
      // install the language, and being told the wrong reason wastes a day.
      // Distinguish "we have no model for this language at all" from "we have one but it
      // would send the audio away": the hospital's remedy differs, and being told the
      // wrong one wastes a day.
      let language = String((languageTag ?? "").split(separator: "-").first ?? "")
      let anyForLanguage = SFSpeechRecognizer.supportedLocales()
        .contains { $0.identifier.hasPrefix(language) }
      result(["unavailable": anyForLanguage ? "wouldLeaveDevice" : "languageUnavailable"])
      return
    }

    SFSpeechRecognizer.requestAuthorization { [weak self] status in
      DispatchQueue.main.async {
        guard status == .authorized else {
          result(["unavailable": "permissionDenied"])
          return
        }
        self?.start(recognizer: recognizer, maxSeconds: maxSeconds, result: result)
      }
    }
  }

  private func start(
    recognizer: SFSpeechRecognizer, maxSeconds: Int, result: @escaping FlutterResult
  ) {
    stopListening()

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = false
    request.requiresOnDeviceRecognition = true
    self.request = request

    let input = engine.inputNode
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) {
      buffer, _ in
      request.append(buffer)
    }

    engine.prepare()
    do {
      try engine.start()
    } catch {
      result(["unavailable": "notSupported"])
      return
    }

    // Answered exactly once, whichever of the three outcomes arrives first. A
    // FlutterResult invoked twice is a crash, and a recogniser that reports a final result
    // and then an error is entirely normal.
    var answered = false
    let answer: ([String: Any]) -> Void = { [weak self] payload in
      guard !answered else { return }
      answered = true
      self?.stopListening()
      result(payload)
    }

    task = recognizer.recognitionTask(with: request) { transcription, error in
      if let transcription, transcription.isFinal {
        let best = transcription.bestTranscription
        // Segment confidences, averaged. Reported for the record, not shown to the
        // patient: a number beside their own words invites trusting the high ones.
        let confidences = best.segments.map { Double($0.confidence) }
        let mean = confidences.isEmpty ? nil : confidences.reduce(0, +) / Double(confidences.count)

        var payload: [String: Any] = ["transcript": best.formattedString]
        if let mean { payload["confidence"] = mean }
        answer(payload)
        return
      }
      if error != nil {
        answer(["unavailable": "notSupported"])
      }
    }

    // A patient who says nothing, or walks away mid-sentence, must not leave the
    // microphone open. The cap is the caller's, so a long free-text answer is not cut off
    // at the same length as a yes-or-no.
    let deadline = DispatchWorkItem { answer(["transcript": ""]) }
    timeout = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(maxSeconds), execute: deadline)
  }

  /// Tears everything down. Safe to call when nothing is running.
  func stopListening() {
    timeout?.cancel()
    timeout = nil

    if engine.isRunning {
      engine.stop()
      engine.inputNode.removeTap(onBus: 0)
    }
    request?.endAudio()
    request = nil
    task?.cancel()
    task = nil
  }

  func dispose() {
    stopListening()
  }
}
