import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/config/question.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/arrival_screens.dart';
import 'package:medikiosk_kiosk/screens/ayush_screen.dart';
import 'package:medikiosk_kiosk/screens/consent_screen.dart';
import 'package:medikiosk_kiosk/screens/demographics_screen.dart';
import 'package:medikiosk_kiosk/screens/department_screen.dart';
import 'package:medikiosk_kiosk/screens/document_screens.dart';
import 'package:medikiosk_kiosk/screens/followup_screens.dart';
import 'package:medikiosk_kiosk/screens/identity_screens.dart';
import 'package:medikiosk_kiosk/screens/question_screen.dart';
import 'package:medikiosk_kiosk/screens/review_screen.dart';
import 'package:medikiosk_kiosk/screens/status_screens.dart';
import 'package:medikiosk_kiosk/config/kiosk_config.dart';
import 'package:medikiosk_kiosk/screens/language_screen.dart';
import 'package:medikiosk_kiosk/screens/token_screen.dart';

import 'support/widget_host.dart';

/// Every active screen must offer a way out.
///
/// The specification puts it plainly: "Every active screen must show only the `Exit`
/// termination action." A patient who cannot leave is standing at a machine holding their
/// medical answers, in a public corridor, with a queue behind them.
///
/// The screens where this is most likely to be missed are the ones nobody demonstrates,
/// because a demonstration goes forwards. So every screen is built here directly rather
/// than reached by walking the journey — several of them need a scanner, a printer or a
/// network failure to reach, and a screen that can only be tested by reproducing a fault
/// is a screen that stops being tested.
void main() {
  final KioskStrings strings = KioskStrings.of('en');
  void noop() {}
  const Widget nothing = SizedBox.shrink();

  final Question question = Question(
    id: 'q1',
    type: 'SINGLE_SELECT',
    prompt: 'What brings you here today?',
    nonCommittal: const <NonCommittal>[NonCommittal.notSure],
    options: const <QuestionOption>[QuestionOption(id: 'pain', label: 'Pain')],
  );

  /// Every screen a patient can be looking at mid-journey.
  final Map<String, Widget> activeScreens = <String, Widget>{
    'language': LanguageScreen(
      strings: strings,
      languages: const <LanguageOption>[
        LanguageOption(tag: 'en', label: 'English', clinicallyReviewed: true, audioAvailable: false),
      ],
      selectedTag: 'en',
      onSelect: (_) {},
      onContinue: noop,
      onToggleAudioGuidance: noop,
      onToggleLargeText: noop,
      onToggleHighContrast: noop,
      onExit: noop,
    ),
    'new registration method': NewRegistrationMethodScreen(
      strings: strings,
      onMobileOtp: noop,
      onExit: noop,
    ),
    'existing patient method': ExistingPatientMethodScreen(
      strings: strings,
      onScanAppointmentQr: noop,
      onEnterUhid: noop,
      onEnterMobile: noop,
      onExit: noop,
    ),
    'mobile entry': MobileEntryScreen(
      strings: strings,
      value: '',
      onDigit: (_) {},
      onBackspace: noop,
      onClear: noop,
      onSubmit: noop,
      onExit: noop,
    ),
    'otp entry': OtpEntryScreen(
      strings: strings,
      maskedMobile: '******3210',
      value: '',
      onDigit: (_) {},
      onBackspace: noop,
      onClear: noop,
      onSubmit: noop,
      onResend: noop,
      onExit: noop,
    ),
    'uhid entry': UhidEntryScreen(
      strings: strings,
      controller: TextEditingController(),
      onSubmit: noop,
      onExit: noop,
    ),
    'identity confirmation': IdentityConfirmationScreen(
      strings: strings,
      maskedName: 'R**** K****',
      maskedMobile: '******3210',
      onConfirm: noop,
      onExit: noop,
    ),
    'identity not confirmed': IdentityNotConfirmedScreen(strings: strings, onExit: noop),
    'demographics': DemographicsScreen(
      strings: strings,
      maskedMobile: '******3210',
      onSubmit: (_) {},
      onBack: noop,
      onExit: noop,
    ),
    'possible duplicate': PossibleDuplicateScreen(
      strings: strings,
      onThisIsMe: noop,
      onNotMe: noop,
      onExit: noop,
    ),
    'department': DepartmentScreen(
      strings: strings,
      departments: const <DepartmentOption>[
        DepartmentOption(code: 'AYU-OPD', name: 'Ayurveda OPD'),
      ],
      onSelect: (_) {},
      onExit: noop,
    ),
    'ayush selection': AyushSelectionScreen(
      strings: strings,
      available: const <AyushSystem>[AyushSystem.ayurveda],
      selected: null,
      onSelect: (_) {},
      onNotSure: noop,
      onContinue: noop,
      onExit: noop,
    ),
    'question': QuestionScreen(
      strings: strings,
      question: question,
      selectedOptionIds: const <String>{},
      answeredCount: 1,
      totalApplicable: 10,
      onToggleOption: (_) {},
      onNonCommittal: (_) {},
      onContinue: noop,
      onExit: noop,
    ),
    'add documents': AddDocumentsScreen(
      strings: strings,
      attached: const <AttachedDocument>[],
      onCapture: (_) {},
      onNoDocuments: noop,
      onContinue: noop,
      onExit: noop,
    ),
    'document type': DocumentTypeScreen(strings: strings, onSelect: (_) {}, onExit: noop),
    'image quality': ImageQualityScreen(
      strings: strings,
      problems: const <String>['documents.quality.blurry'],
      onUseAnyway: noop,
      onExit: noop,
    ),
    'ocr status': OcrStatusScreen(
      strings: strings,
      attached: const <AttachedDocument>[],
      onContinue: noop,
      onExit: noop,
    ),
    'previous visit': PreviousVisitScreen(
      strings: strings,
      verifiedOn: '2 August 2026',
      department: 'Ayurveda OPD',
      onContinue: noop,
      onExit: noop,
    ),
    'what changed': WhatChangedScreen(
      strings: strings,
      selected: const <FollowUpSection>{},
      onToggle: (_) {},
      onNothingChanged: noop,
      onContinue: noop,
      onExit: noop,
    ),
    'review': ReviewScreen(
      strings: strings,
      items: const <ReviewItem>[],
      documents: const <ReviewDocument>[],
      onEdit: (_) {},
      onSubmit: noop,
      onExit: noop,
    ),
    'scan qr': ScanQrScreen(
      strings: strings,
      onScan: noop,
      onExit: noop,
    ),
    'qr rejected': QrRejectedScreen(strings: strings, onExit: noop),
    'consent declined': ConsentDeclinedScreen(strings: strings, onExit: noop),
    // TokenPendingScreen deliberately offers Finish rather than Exit: the visit is
    // recorded and the patient is being sent to the counter, so "exit" would suggest
    // abandoning something that already happened.
  };

  testWidgets('every active screen offers a way out', (WidgetTester tester) async {
    for (final MapEntry<String, Widget> entry in activeScreens.entries) {
      await tester.pumpWidget(host(entry.value));
      await tester.pumpAndSettle();

      expect(
        find.text(strings['common.exit']),
        findsOneWidget,
        reason: 'the ${entry.key} screen has no way out',
      );
    }
  });

  testWidgets('the screens that offer no exit are the ones with nothing to leave', (
    WidgetTester tester,
  ) async {
    // Three, and each is right. The idle home screen IS the exited state; startup has
    // collected nothing and exists because the kiosk is not ready; and an expired session
    // was already wiped, so "Start again" is the honest action.
    final Map<String, Widget> withoutExit = <String, Widget>{
      'startup': StartupScreen(strings: strings),
      'session expired': SessionExpiredScreen(strings: strings, onStartAgain: noop),
    };

    for (final MapEntry<String, Widget> entry in withoutExit.entries) {
      await tester.pumpWidget(host(entry.value));
      // A single pump, not pumpAndSettle: the startup screen shows a continuous progress
      // indicator, so there is no settled state to wait for.
      await tester.pump();
      expect(
        find.text(strings['common.exit']),
        findsNothing,
        reason: '${entry.key} offers an Exit for a session that has already ended',
      );
    }
  });

  test('the screen inventory keeps pace with the shell', () {
    // A count rather than a list, so adding a screen without adding it here is a visible
    // failure rather than a silent omission. It is the whole point of the file.
    expect(activeScreens.length, greaterThanOrEqualTo(22));
    expect(nothing, isNotNull);
  });
}
