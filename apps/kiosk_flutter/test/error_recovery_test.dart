import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/app.dart';
import 'package:medikiosk_kiosk/platform/audio_guidance.dart';
import 'package:medikiosk_kiosk/platform/kiosk_lock.dart';
import 'package:medikiosk_kiosk/platform/qr_scanner.dart';
import 'package:medikiosk_kiosk/platform/token_printer.dart';
import 'package:medikiosk_kiosk/session/secure_wipe.dart';

import 'support/fake_api.dart';

/// The error screen must do what it says.
///
/// It tells the patient "This session has been cleared. Please start again." For a long
/// time it did neither: Start again only changed the view, so the failed session stayed
/// live on the device with the previous patient's consent and identity context intact, and
/// the next thing anybody touched failed against the server with an illegal transition —
/// back to the same screen, with no way out but the inactivity timeout.
///
/// Two things are wrong with that and only one of them is a dead end. The other is that a
/// kiosk standing in a public corridor told a patient their data had been cleared when it
/// had not.
void main() {
  late FakeApi api;
  const String sessionId = '11111111-1111-4111-8111-111111111111';

  setUp(() {
    api = FakeApi();
    api.onJson('/v1/kiosk/config', kioskConfigJson());
    api.onJson('/v1/kiosk/sessions', sessionJson(), status: 201);
    api.onJson('/v1/kiosk/sessions/$sessionId/activity', sessionJson(), status: 201);
    api.onJson(
      '/v1/kiosk/sessions/$sessionId/end',
      <String, dynamic>{'state': 'EXITED'},
      status: 201,
    );
  });

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      KioskApp(
        api: api.build(),
        kioskLock: const UnlockedKioskLock(),
        audio: SilentAudioGuidance(),
        scanner: const UnavailableQrScanner(),
        printer: const UnavailableTokenPrinter(),
        wipeBuilder: (List<VoidCallback> clearers) => _RecordingWipe(clearers),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    final Finder target = find.text(text);
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  /// Starts a session, then fails the language call, landing on the error screen.
  Future<void> reachErrorScreen(WidgetTester tester) async {
    await pumpApp(tester);
    await tapText(tester, 'Select Language');
    await tapText(tester, 'English');

    api.onJson(
      '/v1/kiosk/sessions/$sessionId/language',
      <String, dynamic>{'code': 'INVALID_STATE_TRANSITION'},
      status: 409,
    );
    await tapText(tester, 'Continue');

    expect(find.text('Something went wrong'), findsOneWidget);
  }

  testWidgets('clears the session it says it has cleared', (WidgetTester tester) async {
    await reachErrorScreen(tester);

    await tapText(tester, 'Start again');

    final bool ended = api.requests.any((RecordedRequest r) => r.path.endsWith('/end'));
    expect(ended, isTrue, reason: 'Start again left the failed session live on the device');
  });

  testWidgets('returns the patient to a home screen that works', (WidgetTester tester) async {
    await reachErrorScreen(tester);
    await tapText(tester, 'Start again');

    expect(find.text('Prepare your hospital visit'), findsOneWidget);

    // The real symptom: with the old session still live, this second attempt reused it and
    // the server refused CONSENT_GRANTED -> LANGUAGE_SELECTED, putting the patient straight
    // back on the error screen. A fresh session must be started instead.
    api.onJson(
      '/v1/kiosk/sessions/$sessionId/language',
      sessionJson(state: 'LANGUAGE_SELECTED'),
      status: 201,
    );
    await tapText(tester, 'Select Language');

    expect(find.text('Choose your language'), findsOneWidget);
    expect(find.text('Something went wrong'), findsNothing);

    // Two session creations: the one that failed, and the clean one after Start again.
    final int created =
        api.requests.where((RecordedRequest r) => r.path.endsWith('/v1/kiosk/sessions')).length;
    expect(created, 2, reason: 'the second attempt reused the failed session');
  });
}

class _RecordingWipe implements SecureWipe {
  _RecordingWipe(this._clearers);
  final List<VoidCallback> _clearers;

  @override
  Future<WipeReport> wipe() async {
    for (final VoidCallback clear in _clearers) {
      clear();
    }
    return const WipeReport(cleared: <String>['ui-state'], failed: <String>[]);
  }
}
