import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Why speech input is not available, when it is not.
///
/// Distinguished because the remedies are completely different and a patient who is told
/// the wrong one gives up. A missing language pack is fixed by the hospital's IT; a denied
/// microphone is fixed by the patient's own device settings; "this kiosk cannot do it at
/// all" means stop offering the button.
enum SpeechUnavailableReason {
  /// The platform has no recogniser, or the channel is not registered.
  notSupported,

  /// The patient, or the device policy, refused the microphone.
  permissionDenied,

  /// No recogniser for the language the patient chose.
  languageUnavailable,

  /// A recogniser exists but would have to send the audio away to use it.
  wouldLeaveDevice,
}

@immutable
class TranscriptResult {
  const TranscriptResult.heard(this.transcript)
      : unavailable = null,
        confidence = null;

  const TranscriptResult.heardWith(this.transcript, this.confidence) : unavailable = null;

  const TranscriptResult.unavailable(this.unavailable)
      : transcript = null,
        confidence = null;

  /// What the recogniser thinks it heard. A GUESS, never a clinical record.
  final String? transcript;

  /// 0..1 where the platform reports one. Deliberately not shown to the patient: a number
  /// beside their own words invites them to trust the high ones without reading.
  final double? confidence;

  final SpeechUnavailableReason? unavailable;

  bool get heard => transcript != null && transcript!.trim().isNotEmpty;
}

/// Speech input for patients who cannot type, or cannot read the options.
///
/// Three rules this interface exists to enforce, all of them safety rather than product:
///
/// 1. **ON DEVICE ONLY.** A patient describing their symptoms is producing health data.
///    Apple and Google both default to sending the audio to their own servers, which is a
///    transfer of the most sensitive thing the patient says to a party the hospital has no
///    agreement with. Implementations must require on-device recognition and report
///    `wouldLeaveDevice` rather than fall back — the absence of a feature is recoverable,
///    an unnoticed disclosure is not.
///
/// 2. **A TRANSCRIPT IS NOT AN ANSWER.** It is a machine's guess at what was said, and in
///    this setting the errors are dangerous: "no pain" and "know pain", a dose, a drug
///    name. Nothing here writes to a record. The caller must show the patient the words
///    and have them confirm, and the stored answer carries `modality: VOICE` so the
///    clinician knows it was transcribed rather than typed.
///
/// 3. **NEVER FOR CONSENT OR IDENTIFIERS.** Agreeing to a privacy notice is a deliberate
///    act, and a mobile number or a UHID misheard by one digit resolves to somebody else's
///    record. Those screens do not offer this and must not.
abstract interface class SpeechRecognition {
  /// Whether this language can be recognised entirely on the device.
  Future<bool> isLanguageAvailable(String languageTag);

  /// Listens until the patient stops speaking, or [maxDuration] elapses.
  Future<TranscriptResult> listen({
    required String languageTag,
    Duration maxDuration = const Duration(seconds: 30),
  });

  /// Stops listening now. Called on Exit, on timeout and on session wipe, so no audio from
  /// one patient is still being processed when the next walks up.
  Future<void> stop();
}

/// Platform-channel implementation. The channel is answered by
/// `SpeechRecognitionHandler` on macOS and Android.
class PlatformSpeechRecognition implements SpeechRecognition {
  const PlatformSpeechRecognition([this._channel = _defaultChannel]);

  static const MethodChannel _defaultChannel = MethodChannel('org.medikiosk/speech_recognition');
  final MethodChannel _channel;

  @override
  Future<bool> isLanguageAvailable(String languageTag) async {
    try {
      return await _channel.invokeMethod<bool>('isLanguageAvailable', <String, Object?>{
            'language': languageTag,
          }) ??
          false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<TranscriptResult> listen({
    required String languageTag,
    Duration maxDuration = const Duration(seconds: 30),
  }) async {
    try {
      final Map<Object?, Object?>? reply =
          await _channel.invokeMethod<Map<Object?, Object?>>('listen', <String, Object?>{
        'language': languageTag,
        'maxSeconds': maxDuration.inSeconds,
      });

      if (reply == null) return const TranscriptResult.unavailable(SpeechUnavailableReason.notSupported);

      final String? reason = reply['unavailable'] as String?;
      if (reason != null) return TranscriptResult.unavailable(_reasonFrom(reason));

      final String transcript = (reply['transcript'] as String?) ?? '';
      final double? confidence = (reply['confidence'] as num?)?.toDouble();
      return TranscriptResult.heardWith(transcript, confidence);
    } on PlatformException catch (error) {
      return TranscriptResult.unavailable(_reasonFrom(error.code));
    } on MissingPluginException {
      return const TranscriptResult.unavailable(SpeechUnavailableReason.notSupported);
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _channel.invokeMethod<void>('stop');
    } on PlatformException {
      // Nothing to stop, or the recogniser is gone. Silence is the safe outcome.
    } on MissingPluginException {
      // Not running on a device with the channel registered.
    }
  }

  static SpeechUnavailableReason _reasonFrom(String code) {
    switch (code) {
      case 'permissionDenied':
        return SpeechUnavailableReason.permissionDenied;
      case 'languageUnavailable':
        return SpeechUnavailableReason.languageUnavailable;
      case 'wouldLeaveDevice':
        return SpeechUnavailableReason.wouldLeaveDevice;
      default:
        return SpeechUnavailableReason.notSupported;
    }
  }
}

/// For tests, and for builds with no recogniser.
///
/// Reports `notSupported` rather than pretending to hear, so a screen that depends on
/// speech shows its unavailable state instead of appearing to work.
class UnavailableSpeechRecognition implements SpeechRecognition {
  UnavailableSpeechRecognition();

  int listenCount = 0;
  int stopCount = 0;

  /// What the next `listen` returns. Left null, it reports unavailable.
  TranscriptResult? next;

  @override
  Future<bool> isLanguageAvailable(String languageTag) async => next != null;

  @override
  Future<TranscriptResult> listen({
    required String languageTag,
    Duration maxDuration = const Duration(seconds: 30),
  }) async {
    listenCount += 1;
    return next ?? const TranscriptResult.unavailable(SpeechUnavailableReason.notSupported);
  }

  @override
  Future<void> stop() async => stopCount += 1;
}
