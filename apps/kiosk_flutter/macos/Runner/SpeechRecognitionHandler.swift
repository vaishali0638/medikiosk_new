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
  private func recognizer(for languageTag: String?) -> SFSpeechRecognizer? {
    guard let tag = languageTag, !tag.isEmpty else { return nil }

    // Indian locales are published per region, as with the voices. Nepali is ne-NP.
    let normalised = tag.replacingOccurrences(of: "_", with: "-")
    let identifier =
      normalised.contains("-") ? normalised : "\(normalised)-\(normalised == "ne" ? "NP" : "IN")"

    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: identifier)),
      recognizer.isAvailable
    else { return nil }

    // The whole point. A recogniser that cannot work on-device is not usable here at all.
    guard recognizer.supportsOnDeviceRecognition else { return nil }

    return recognizer
  }

  private func listen(languageTag: String?, maxSeconds: Int, result: @escaping FlutterResult) {
    guard let recognizer = recognizer(for: languageTag) else {
      // Deliberately distinguished from "not supported": the hospital's remedy is to
      // install the language, and being told the wrong reason wastes a day.
      result(["unavailable": SFSpeechRecognizer(locale: Locale(identifier: languageTag ?? ""))
        == nil ? "languageUnavailable" : "wouldLeaveDevice"])
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
