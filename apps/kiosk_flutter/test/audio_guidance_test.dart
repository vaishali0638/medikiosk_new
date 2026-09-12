import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/platform/audio_guidance.dart';

void main() {
  group('SilentAudioGuidance', () {
    test('never claims to have spoken', () async {
      final SilentAudioGuidance audio = SilentAudioGuidance();
      final SpeechResult result = await audio.speak(text: 'hello', languageTag: 'en');

      // A stub that reported success would let a screen depending on audio look as though
      // it worked on a device with no voice.
      expect(result.spoke, isFalse);
      expect(result.source, SpeechSource.unavailable);
    });

    test('records what it was asked to say, so tests can assert on it', () async {
      final SilentAudioGuidance audio = SilentAudioGuidance();
      await audio.speak(text: 'notice text', languageTag: 'hi');
      expect(audio.spokenText, <String>['notice text']);
    });

    test('counts stops, so a session wipe can be verified to have silenced it', () async {
      final SilentAudioGuidance audio = SilentAudioGuidance();
      await audio.stop();
      await audio.stop();
      expect(audio.stopCount, 2);
    });

    test('supports no language', () async {
      expect(await SilentAudioGuidance().isLanguageSupported('en'), isFalse);
    });
  });

  group('SpeechSource', () {
    test('distinguishes an approved recording from device text-to-speech', () {
      // Reading approved wording in a synthetic voice is a different artefact from the
      // one a reviewer signed off, so the two are never conflated.
      expect(SpeechSource.approvedRecording, isNot(SpeechSource.deviceTts));
      expect(SpeechSource.values, hasLength(3));
    });
  });
}
