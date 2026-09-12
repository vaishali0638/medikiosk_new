import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// How a prompt is being spoken. Surfaced to the UI because it changes what the kiosk
/// may honestly claim.
enum SpeechSource {
  /// A recorded reading approved alongside the text by a translation reviewer.
  approvedRecording,

  /// Device text-to-speech. The words are the approved words, but the delivery is
  /// synthetic and no reviewer has heard it.
  deviceTts,

  /// Nothing is available in this language.
  unavailable,
}

@immutable
class SpeechResult {
  const SpeechResult({required this.source, required this.spoke});

  final SpeechSource source;
  final bool spoke;
}

/// Spoken guidance for patients who cannot or prefer not to read.
///
/// The interface distinguishes an approved recording from device TTS deliberately.
/// Reading governed clinical wording aloud in a synthetic voice is a different artefact
/// from the one a reviewer approved — pronunciation of a drug name or a negation can
/// change the meaning — so the kiosk labels TTS rather than presenting it as the notice.
abstract interface class AudioGuidance {
  /// Speaks [text] in [languageTag]. Returns what was actually used.
  Future<SpeechResult> speak({
    required String text,
    required String languageTag,
    bool approvedRecordingAvailable = false,
  });

  /// Stops any current speech. Called on every screen change and on session wipe, so no
  /// audio from one patient continues into the next patient's session.
  Future<void> stop();

  /// Whether this language can be spoken at all.
  Future<bool> isLanguageSupported(String languageTag);
}

/// Platform-channel implementation backed by the Android TTS engine.
class PlatformAudioGuidance implements AudioGuidance {
  const PlatformAudioGuidance([this._channel = _defaultChannel]);

  static const MethodChannel _defaultChannel = MethodChannel('org.medikiosk/audio_guidance');
  final MethodChannel _channel;

  @override
  Future<SpeechResult> speak({
    required String text,
    required String languageTag,
    bool approvedRecordingAvailable = false,
  }) async {
    try {
      final bool spoke = await _channel.invokeMethod<bool>('speak', <String, Object?>{
            'text': text,
            'language': languageTag,
          }) ??
          false;

      return SpeechResult(
        source: spoke
            ? (approvedRecordingAvailable
                ? SpeechSource.approvedRecording
                : SpeechSource.deviceTts)
            : SpeechSource.unavailable,
        spoke: spoke,
      );
    } on PlatformException {
      return const SpeechResult(source: SpeechSource.unavailable, spoke: false);
    } on MissingPluginException {
      return const SpeechResult(source: SpeechSource.unavailable, spoke: false);
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _channel.invokeMethod<void>('stop');
    } on PlatformException {
      // Nothing to stop, or the engine is gone. Silence is the safe outcome.
    } on MissingPluginException {
      // Not running on a device with the channel registered.
    }
  }

  @override
  Future<bool> isLanguageSupported(String languageTag) async {
    try {
      return await _channel.invokeMethod<bool>('isLanguageSupported', <String, Object?>{
            'language': languageTag,
          }) ??
          false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// Silent implementation for tests and for builds with no TTS engine.
///
/// Reports `unavailable` rather than pretending to speak, so a screen that depends on
/// audio guidance shows its unavailable state instead of appearing to work.
class SilentAudioGuidance implements AudioGuidance {
  SilentAudioGuidance();

  final List<String> spokenText = <String>[];
  int stopCount = 0;

  @override
  Future<SpeechResult> speak({
    required String text,
    required String languageTag,
    bool approvedRecordingAvailable = false,
  }) async {
    spokenText.add(text);
    return const SpeechResult(source: SpeechSource.unavailable, spoke: false);
  }

  @override
  Future<void> stop() async => stopCount += 1;

  @override
  Future<bool> isLanguageSupported(String languageTag) async => false;
}
