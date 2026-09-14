import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/app.dart';
import 'package:medikiosk_kiosk/platform/audio_guidance.dart';
import 'package:medikiosk_kiosk/platform/kiosk_lock.dart';
import 'package:medikiosk_kiosk/platform/qr_scanner.dart';
import 'package:medikiosk_kiosk/platform/token_printer.dart';
import 'package:medikiosk_kiosk/session/secure_wipe.dart';

import 'support/fake_api.dart';

/// Audio Guidance has to produce audio.
///
/// It did not. The toggle set a flag that only the consent screen's own "Listen" control
/// consulted, so a patient who cannot read switched on a feature called Audio Guidance
/// and heard nothing for the entire journey. These tests exist so that cannot come back
/// silently — every one of them would have passed vacuously against the old build, which
/// is why they assert on what was spoken rather than on the flag.
void main() {
  late FakeApi api;
  late SilentAudioGuidance audio;

  const String sessionId = '11111111-1111-4111-8111-111111111111';

  setUp(() {
    api = FakeApi();
    audio = SilentAudioGuidance();
    api.onJson('/v1/kiosk/config', kioskConfigJson());
    api.onJson('/v1/kiosk/sessions', sessionJson(), status: 201);
    api.onJson('/v1/kiosk/sessions/$sessionId/activity', sessionJson(), status: 201);
  });

  Future<KioskAppState> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      KioskApp(
        api: api.build(),
        kioskLock: const UnlockedKioskLock(),
        audio: audio,
        scanner: const UnavailableQrScanner(),
        printer: const UnavailableTokenPrinter(),
        wipeBuilder: (List<VoidCallback> clearers) => _NoopWipe(),
      ),
    );
    await tester.pumpAndSettle();
    return tester.state<KioskAppState>(find.byType(KioskApp));
  }

  /// The toggle sits below the fold on a test-sized surface, so scroll it in first.
  Future<void> enableAudioGuidance(WidgetTester tester) async {
    final Finder toggle = find.textContaining('Audio Guidance').first;
    await tester.ensureVisible(toggle);
    await tester.pumpAndSettle();
    await tester.tap(toggle);
    await tester.pumpAndSettle();
  }

  testWidgets('says nothing while Audio Guidance is off', (WidgetTester tester) async {
    await pumpApp(tester);
    expect(audio.spokenText, isEmpty);
  });

  testWidgets('reads the screen aloud once Audio Guidance is on',
      (WidgetTester tester) async {
    await pumpApp(tester);

    await enableAudioGuidance(tester);

    expect(audio.spokenText, isNotEmpty);
    expect(audio.spokenText.last, contains('Prepare your hospital visit'));
  });

  testWidgets('does not repeat itself on every rebuild', (WidgetTester tester) async {
    await pumpApp(tester);

    await enableAudioGuidance(tester);
    final int afterFirst = audio.spokenText.length;

    // A rebuild that changes nothing about the screen must not start the prompt again;
    // a patient hearing the home screen read out on a loop cannot use the kiosk at all.
    await tester.pump();
    await tester.pumpAndSettle();
    expect(audio.spokenText.length, afterFirst);
  });

  testWidgets('speaks again when the screen changes', (WidgetTester tester) async {
    await pumpApp(tester);

    await enableAudioGuidance(tester);
    final int afterHome = audio.spokenText.length;

    final Finder selectLanguage = find.text('Select Language');
    await tester.ensureVisible(selectLanguage);
    await tester.pumpAndSettle();
    await tester.tap(selectLanguage);
    await tester.pumpAndSettle();

    expect(audio.spokenText.length, greaterThan(afterHome));
    expect(audio.spokenText.last, contains('Choose your language'));
  });

  testWidgets('reports unavailable rather than pretending to have spoken',
      (WidgetTester tester) async {
    // SilentAudioGuidance records the text and returns `spoke: false`. That distinction is
    // the whole contract: a screen that depends on audio must be able to tell the
    // difference between "read out" and "nothing came out of the speaker".
    final SpeechResult result = await audio.speak(text: 'x', languageTag: 'ta');
    expect(result.spoke, isFalse);
    expect(result.source, SpeechSource.unavailable);
    expect(await audio.supportedLanguages(<String>['ta', 'en']), isEmpty);
  });
}

class _NoopWipe implements SecureWipe {
  @override
  Future<WipeReport> wipe() async =>
      const WipeReport(cleared: <String>['ui-state'], failed: <String>[]);
}
