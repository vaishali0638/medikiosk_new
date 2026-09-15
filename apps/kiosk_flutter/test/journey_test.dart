import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/app.dart';
import 'package:medikiosk_kiosk/platform/audio_guidance.dart';
import 'package:medikiosk_kiosk/platform/kiosk_lock.dart';
import 'package:medikiosk_kiosk/platform/qr_scanner.dart';
import 'package:medikiosk_kiosk/platform/token_printer.dart';
import 'package:medikiosk_kiosk/session/secure_wipe.dart';

import 'support/fake_api.dart';

/// Walks the kiosk-hosted journey end to end against a fake API.
///
/// The value of this test is not any single assertion — the screens are covered
/// individually elsewhere. It is that the fifteen steps are wired to each other at all: a
/// screen that exists, passes its own tests and cannot be reached is what this file
/// exists to prevent recurring.
void main() {
  late FakeApi api;

  const String sessionId = '11111111-1111-4111-8111-111111111111';
  const String preCheckinId = '22222222-2222-4222-8222-222222222222';

  /// Answers every question with the same non-committal option, then completes.
  void wireInterview({required int questions}) {
    int served = 0;
    api.onRequest('/v1/intakes/$preCheckinId/next', (_) {
      if (served >= questions) {
        return <String, dynamic>{'complete': true, 'answeredCount': questions};
      }
      served += 1;
      return <String, dynamic>{
        'complete': false,
        'answeredCount': served - 1,
        'totalApplicable': questions,
        'question': <String, dynamic>{
          'id': 'q$served',
          'type': 'SINGLE_SELECT',
          'prompt': 'Question $served?',
          'options': <Map<String, dynamic>>[
            <String, dynamic>{'id': 'yes', 'label': 'Yes'},
            <String, dynamic>{'id': 'no', 'label': 'No'},
          ],
          'nonCommittal': <String>['NOT_SURE'],
        },
      };
    });
    api.onJson(
      '/v1/intakes/$preCheckinId/answers',
      <String, dynamic>{'revision': 1},
      status: 201,
    );
  }

  void wireJourney({int questions = 2}) {
    api.onJson('/v1/kiosk/config', kioskConfigJson());
    api.onJson('/v1/kiosk/sessions', sessionJson(), status: 201);
    api.onJson(
      '/v1/kiosk/sessions/$sessionId/language',
      sessionJson(state: 'LANGUAGE_SELECTED'),
      status: 201,
    );
    api.onJson('/v1/kiosk/sessions/$sessionId/activity', sessionJson(), status: 201);
    api.onJson('/v1/consents/notice', <String, dynamic>{
      'version': 'v1.0',
      'language': 'en',
      'title': 'How your information is used',
      'collectedItems': <String>['Your name and age', 'Why you are here today'],
      'purpose': 'To prepare your consultation.',
      'fullText': 'Full notice text.',
      'audioAvailable': false,
      'approvedBy': <String>['Hospital ethics committee'],
    });
    api.onJson(
      '/v1/consents',
      <String, dynamic>{'consentId': 'c1', 'state': 'GRANTED'},
      status: 201,
    );
    api.onJson(
      '/v1/identity/otp',
      <String, dynamic>{
        'verificationId': 'v1',
        'maskedMobile': '******3210',
        'expiresAt': '2026-09-13T10:05:00.000Z',
        'attemptsAllowed': 5,
      },
      status: 201,
    );
    api.onJson(
      '/v1/identity/otp/verify',
      <String, dynamic>{'verificationId': 'v1', 'verified': true},
      status: 201,
    );
    api.onJson(
      '/v1/identity/register',
      <String, dynamic>{'patientId': 'p1', 'possibleDuplicates': <dynamic>[]},
      status: 201,
    );
    api.onJson(
      '/v1/kiosk/sessions/$sessionId/visit',
      <String, dynamic>{'preCheckinId': preCheckinId, 'departmentId': 'AYU-OPD'},
      status: 201,
    );
    api.onJson('/v1/intakes/ayush-systems', <String, dynamic>{'systems': <String>[]});
    wireInterview(questions: questions);
    api.onJson('/v1/precheckins/$preCheckinId/documents', <String, dynamic>{
      'documents': <dynamic>[],
    });
    api.onJson('/v1/precheckins/$preCheckinId/review', <String, dynamic>{
      'heading': 'Your information for the doctor',
      'items': <Map<String, dynamic>>[
        <String, dynamic>{
          'questionId': 'q1',
          'prompt': 'Question 1?',
          'answered': true,
          'display': 'Yes',
          'provenance': 'PATIENT-SELECTED',
          'revision': 1,
        },
      ],
      'documents': <dynamic>[],
    });
    api.onJson(
      '/v1/precheckins/$preCheckinId/submit-intake',
      <String, dynamic>{
        'submissionId': 's1',
        'submittedAt': '2026-09-13T10:10:00.000Z',
        'alreadySubmitted': false,
        'summaryId': 'sum1',
        'tokenHandle': 'th1',
        'draftLabel': 'AI-assisted pre-consultation draft — not verified',
        'generator': 'DETERMINISTIC',
        'fellBackToRules': false,
      },
      status: 201,
    );
    api.onJson(
      '/v1/arrival/th1/token',
      <String, dynamic>{
        'token': 'AYU-0007',
        'state': 'ISSUED',
        'departmentName': 'Ayurveda OPD',
        'room': '2',
        'queueStatus': '3 ahead of you',
        'issuedAt': '2026-09-13T10:10:05.000Z',
      },
      status: 201,
    );
  }

  Future<KioskAppState> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      KioskApp(
        api: api.build(),
        kioskLock: const UnlockedKioskLock(),
        audio: SilentAudioGuidance(),
        scanner: const UnavailableQrScanner(),
        printer: const UnavailableTokenPrinter(),
        // The wipe itself is covered by secure_wipe_test. Here it only has to run the
        // shell's own clearers, which is what the last test in this file checks.
        wipeBuilder: (List<VoidCallback> clearers) => _ShellClearingWipe(clearers),
      ),
    );
    await tester.pumpAndSettle();
    return tester.state<KioskAppState>(find.byType(KioskApp));
  }

  Future<void> tapText(WidgetTester tester, String label) async {
    await tester.ensureVisible(find.text(label).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text(label).first);
    await tester.pumpAndSettle();
  }

  setUp(() => api = FakeApi());

  testWidgets('New Registration walks from home to a hospital token', (
    WidgetTester tester,
  ) async {
    wireJourney();
    final KioskAppState shell = await pumpApp(tester);
    expect(shell.view, ShellView.home);

    await tapText(tester, 'New Registration');
    expect(shell.view, ShellView.language);

    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    expect(shell.view, ShellView.consent);

    await tapText(tester, 'Agree and Continue');
    expect(shell.view, ShellView.identityMethod);

    await tapText(tester, 'Mobile OTP');
    expect(shell.view, ShellView.identityMobile);

    for (final String digit in '9876543210'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Send code');
    expect(shell.view, ShellView.identityOtp);

    for (final String digit in '123456'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Verify');
    // A new patient has no record to match against, so they give their details rather
    // than confirming a masked summary.
    expect(shell.view, ShellView.demographics);

    await tester.enterText(find.byType(TextField).first, 'Lakshmi Devi');
    await tester.enterText(find.byType(TextField).at(1), '47');
    await tester.pumpAndSettle();
    await tapText(tester, 'Female');
    await tapText(tester, 'Continue');

    // One department needs no choosing, so the visit opens and the interview starts.
    expect(shell.view, ShellView.question);

    await tapText(tester, 'Yes');
    await tapText(tester, 'Continue');
    await tapText(tester, 'No');
    await tapText(tester, 'Continue');

    expect(shell.view, ShellView.addDocuments);

    await tapText(tester, 'I have no documents');
    expect(shell.view, ShellView.review);

    await tapText(tester, 'I reviewed and want to submit');
    expect(shell.view, ShellView.token);
    expect(find.text('AYU-0007'), findsOneWidget);
    expect(find.textContaining('Ayurveda OPD'), findsWidgets);
  });

  testWidgets('a mobile number alone sends an existing patient to the counter', (
    WidgetTester tester,
  ) async {
    wireJourney();
    final KioskAppState shell = await pumpApp(tester);

    await tapText(tester, 'Existing Patient Check-in');
    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    await tapText(tester, 'Agree and Continue');
    await tapText(tester, 'Enter mobile number');

    // Said before ten digits and a code, not after: the refusal is the same either way,
    // and the server would never release a record on possession of a handset.
    expect(shell.view, ShellView.identityCounterOnly);
    expect(find.textContaining('speak to the counter'), findsOneWidget);
  });

  testWidgets('Existing Patient Check-in confirms a masked record first', (
    WidgetTester tester,
  ) async {
    wireJourney();
    api.onJson(
      '/v1/identity/resolve',
      <String, dynamic>{
        // The real contract's field names. An earlier version of this fake invented
        // `attemptId`, so the test passed against the shell's own assumption while the
        // server was answering something else entirely.
        'candidateId': 'a1',
        'method': 'UHID_AND_ENCOUNTER',
        'strength': 'STRONGEST',
        'expiresAt': '2026-09-13T10:05:00.000Z',
        'masked': <String, dynamic>{
          'maskedName': 'R**** K****',
          'maskedMobile': '******3210',
          'maskedUhid': '****4321',
        },
      },
      status: 201,
    );
    api.onJson(
      '/v1/identity/confirm',
      <String, dynamic>{'patientId': 'p1', 'strength': 'STRONGEST'},
      status: 201,
    );

    final KioskAppState shell = await pumpApp(tester);
    await tapText(tester, 'Existing Patient Check-in');
    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    await tapText(tester, 'Agree and Continue');
    expect(shell.view, ShellView.identityMethod);

    // UHID, not the mobile number: a one-time code proves possession of a handset, and
    // the server will not release a record on that alone.
    await tapText(tester, 'Enter UHID');
    await tester.enterText(find.byType(TextField).first, 'UH00012345');
    await tester.pumpAndSettle();
    await tapText(tester, 'Continue');

    // The system proposes; the person standing there decides.
    expect(shell.view, ShellView.identityConfirm);
    expect(find.textContaining('R**** K****'), findsOneWidget);

    await tapText(tester, 'Yes, this is me');
    expect(shell.view, ShellView.question);
  });

  testWidgets('a wrong code says nothing about why, and offers only Exit', (
    WidgetTester tester,
  ) async {
    wireJourney();
    api.onJson(
      '/v1/identity/otp/verify',
      <String, dynamic>{
        'code': 'VALIDATION_FAILED',
        'patientMessage': 'Some information could not be accepted.',
        'correlationId': 'abc',
      },
      status: 400,
    );

    final KioskAppState shell = await pumpApp(tester);
    await tapText(tester, 'New Registration');
    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    await tapText(tester, 'Agree and Continue');
    await tapText(tester, 'Mobile OTP');
    for (final String digit in '9876543210'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Send code');
    for (final String digit in '123456'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Verify');

    // Still on the keypad, with the attempts the server granted.
    //
    // This used to assert identityNotConfirmed — one mistyped digit in a six-digit code
    // ended the journey and sent the patient to the counter, which made the five attempts
    // the server allows unreachable and the screen's own attempts-remaining display dead
    // code. The reason the outcomes were collapsed still holds and is still asserted
    // below: the kiosk must not say WHICH failure occurred, because distinguishing wrong
    // from expired from locked is a way to probe a stolen number. Staying on the keypad
    // discloses none of that — a wrong code and an expired one look identical — and the
    // one case that does end the attempt, RATE_LIMITED, is the server saying the attempts
    // are gone.
    expect(shell.view, ShellView.identityOtp);
    expect(find.textContaining('expired'), findsNothing);
    expect(find.textContaining('locked'), findsNothing);
    expect(find.textContaining('wrong'), findsNothing);
    expect(find.text('Exit'), findsOneWidget);
  });

  testWidgets('sends the patient to the counter once the attempts are gone', (
    WidgetTester tester,
  ) async {
    wireJourney();
    api.onJson(
      '/v1/identity/otp/verify',
      <String, dynamic>{
        'code': 'RATE_LIMITED',
        'patientMessage': 'Some information could not be accepted.',
        'correlationId': 'abc',
      },
      status: 429,
    );

    final KioskAppState shell = await pumpApp(tester);
    await tapText(tester, 'New Registration');
    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    await tapText(tester, 'Agree and Continue');
    await tapText(tester, 'Mobile OTP');
    for (final String digit in '9876543210'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Send code');
    for (final String digit in '123456'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Verify');

    // Exhausted is the one outcome that ends the attempt, and it still says nothing about
    // why beyond the neutral message.
    expect(shell.view, ShellView.identityNotConfirmed);
    expect(find.textContaining('locked'), findsNothing);
    expect(find.text('Exit'), findsOneWidget);
  });

  testWidgets('Exit opens the confirmation dialog on an ordinary screen', (
    WidgetTester tester,
  ) async {
    // A regression test for a bug no other test could see: `showDialog` was being called
    // with the KioskApp State's context, which sits ABOVE the MaterialApp and so has no
    // Navigator and no MaterialLocalizations. The exception was swallowed by the
    // unawaited future behind the tap, so every Exit button on every screen — and the
    // inactivity warning, which uses the same path — silently did nothing.
    wireJourney();
    await pumpApp(tester);

    await tapText(tester, 'New Registration');
    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    await tapText(tester, 'Exit');

    expect(find.text('Are you sure you want to exit?'), findsOneWidget);
    expect(find.text('Your current kiosk session will be cleared.'), findsOneWidget);
  });

  testWidgets('the wipe clears the journey, not just the arrival flow', (
    WidgetTester tester,
  ) async {
    wireJourney();
    final KioskAppState shell = await pumpApp(tester);

    await tapText(tester, 'New Registration');
    await tapText(tester, 'English');
    await tapText(tester, 'Continue');
    await tapText(tester, 'Agree and Continue');
    await tapText(tester, 'Mobile OTP');
    for (final String digit in '9876543210'.split('')) {
      await tapText(tester, digit);
    }
    await tapText(tester, 'Send code');

    api.onJson('/v1/kiosk/sessions/$sessionId/end', sessionJson(state: 'EXITED'), status: 201);
    await tapText(tester, 'Exit');
    expect(find.text('Are you sure you want to exit?'), findsOneWidget);

    // The dialog's Exit, not the screen's underneath it — both carry the same label, and
    // tapping the wrong one leaves the session open.
    await tester.tap(
      find.descendant(of: find.byType(Dialog), matching: find.text('Exit')),
    );
    await tester.pumpAndSettle();

    expect(shell.view, ShellView.home);
    // The next patient must not find the previous one's masked number on screen.
    expect(find.textContaining('******3210'), findsNothing);
  });
}

/// Runs the shell's own UI-state clearers and nothing else.
class _ShellClearingWipe implements SecureWipe {
  _ShellClearingWipe(this._clearers);

  final List<VoidCallback> _clearers;

  @override
  Future<WipeReport> wipe() async {
    for (final VoidCallback clear in _clearers) {
      clear();
    }
    return const WipeReport(cleared: <String>['ui-state'], failed: <String>[]);
  }
}
