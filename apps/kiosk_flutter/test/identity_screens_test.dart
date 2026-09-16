import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/identity_screens.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';
import 'package:medikiosk_kiosk/widgets/mk_keypad.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  group('new registration method', () {
    testWidgets('offers mobile OTP', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          NewRegistrationMethodScreen(
            strings: strings,
            onMobileOtp: () {},
            onExit: () {},
          ),
        ),
      );
      expect(find.text('Mobile OTP'), findsOneWidget);
      expect(find.text('Exit'), findsOneWidget);
    });

    testWidgets('hides ABHA entirely when the hospital has not enabled it', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        host(
          NewRegistrationMethodScreen(
            strings: strings,
            onMobileOtp: () {},
            onExit: () {},
          ),
        ),
      );
      // Not greyed out — absent. Otherwise patients ask staff for something the
      // deployment cannot do.
      expect(find.text('Scan ABHA QR'), findsNothing);
    });

    testWidgets('shows ABHA once the hospital enables it', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          NewRegistrationMethodScreen(
            strings: strings,
            abhaEnabled: true,
            onScanAbha: () {},
            onMobileOtp: () {},
            onExit: () {},
          ),
        ),
      );
      expect(find.text('Scan ABHA QR'), findsOneWidget);
    });
  });

  group('existing patient method', () {
    testWidgets('offers exactly the three specified routes plus Exit', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        host(
          ExistingPatientMethodScreen(
            strings: strings,
            onScanAppointmentQr: () {},
            onEnterUhid: () {},
            onEnterMobile: () {},
            onExit: () {},
          ),
        ),
      );

      expect(find.text('Scan appointment QR'), findsOneWidget);
      expect(find.text('Enter UHID'), findsOneWidget);
      expect(find.text('Enter mobile number'), findsOneWidget);
      expect(find.byType(MkButton), findsNWidgets(4));
    });

    testWidgets('offers no token-entry route', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          ExistingPatientMethodScreen(
            strings: strings,
            onScanAppointmentQr: () {},
            onEnterUhid: () {},
            onEnterMobile: () {},
            onExit: () {},
          ),
        ),
      );
      // A token exists only once the HIS has issued one.
      expect(find.textContaining('token'), findsNothing);
      expect(find.textContaining('Token'), findsNothing);
    });
  });

  group('mobile entry', () {
    Future<void> pump(WidgetTester tester, String value, {VoidCallback? onSubmit}) {
      return tester.pumpWidget(
        host(
          MobileEntryScreen(
            strings: strings,
            value: value,
            onDigit: (_) {},
            onBackspace: () {},
            onClear: () {},
            onSubmit: onSubmit ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('keeps Send code inert until ten digits are entered', (
      WidgetTester tester,
    ) async {
      await pump(tester, '98765');
      final MkButton button = tester.widget<MkButton>(
        find.ancestor(of: find.text('Send code'), matching: find.byType(MkButton)),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('enables Send code at ten digits', (WidgetTester tester) async {
      int sent = 0;
      await pump(tester, '9876543210', onSubmit: () => sent += 1);
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(sent, 1);
    });

    testWidgets('uses the kiosk keypad, not the system keyboard', (WidgetTester tester) async {
      await pump(tester, '');
      // The system keyboard exposes clipboard history and voice input, and its keys are
      // far below the touch floor on a wall-mounted screen.
      expect(find.byType(MkKeypad), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });
  });

  group('OTP entry', () {
    Future<void> pump(
      WidgetTester tester, {
      String value = '',
      int? attemptsRemaining,
      bool canResend = true,
    }) {
      return tester.pumpWidget(
        host(
          OtpEntryScreen(
            strings: strings,
            maskedMobile: '******3210',
            value: value,
            attemptsRemaining: attemptsRemaining,
            canResend: canResend,
            onDigit: (_) {},
            onBackspace: () {},
            onClear: () {},
            onSubmit: () {},
            onResend: () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('shows only the masked destination number', (WidgetTester tester) async {
      await pump(tester);
      expect(find.textContaining('******3210'), findsOneWidget);
      expect(find.textContaining('9876543210'), findsNothing);
    });

    testWidgets('keeps Verify inert until six digits are entered', (WidgetTester tester) async {
      await pump(tester, value: '123');
      final MkButton button = tester.widget<MkButton>(
        find.ancestor(of: find.text('Verify'), matching: find.byType(MkButton)),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('warns how many attempts remain, so a lockout is not a surprise', (
      WidgetTester tester,
    ) async {
      await pump(tester, attemptsRemaining: 2);
      expect(find.text('2 attempts remaining'), findsOneWidget);
    });

    testWidgets('does not mention attempts before one has failed', (WidgetTester tester) async {
      await pump(tester);
      expect(find.textContaining('attempts remaining'), findsNothing);
    });

    testWidgets('disables resend while it is rate-limited', (WidgetTester tester) async {
      await pump(tester, canResend: false);
      final MkButton button = tester.widget<MkButton>(
        find.ancestor(of: find.text('Resend code'), matching: find.byType(MkButton)),
      );
      expect(button.onPressed, isNull);
    });
  });

  group('confirmation', () {
    Future<void> pump(WidgetTester tester, {VoidCallback? onConfirm}) {
      return tester.pumpWidget(
        host(
          IdentityConfirmationScreen(
            strings: strings,
            maskedName: 'R*** K****',
            maskedMobile: '******3210',
            maskedUhid: '******2345',
            onConfirm: onConfirm ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('shows only masked details', (WidgetTester tester) async {
      await pump(tester);
      expect(find.text('R*** K****'), findsOneWidget);
      expect(find.text('******3210'), findsOneWidget);
      expect(find.text('******2345'), findsOneWidget);
    });

    testWidgets('requires an explicit yes', (WidgetTester tester) async {
      int confirmed = 0;
      await pump(tester, onConfirm: () => confirmed += 1);
      await tester.tap(find.text('Yes, this is me'));
      await tester.pumpAndSettle();
      expect(confirmed, 1);
    });

    testWidgets('offers Exit as the way to stop, not a second refusal control', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      expect(find.text('Exit'), findsOneWidget);
      expect(find.textContaining('not me'), findsNothing);
    });

    testWidgets('discloses nothing clinical', (WidgetTester tester) async {
      await pump(tester);
      for (final String word in <String>['diagnos', 'medicine', 'visit', 'history']) {
        expect(find.textContaining(word), findsNothing);
      }
    });
  });

  group('not confirmed', () {
    testWidgets('gives one neutral message whatever the reason', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          IdentityNotConfirmedScreen(
            strings: strings,
            onExit: () {},
            correlationId: 'abc-123',
          ),
        ),
      );

      expect(find.text('We could not confirm your details'), findsOneWidget);
      // Saying "we found two people with this number" would disclose that a second
      // person is registered here.
      expect(find.textContaining('two'), findsNothing);
      expect(find.textContaining('not found'), findsNothing);
      expect(find.textContaining('expired'), findsNothing);
      expect(find.textContaining('abc-123'), findsOneWidget);
    });

    testWidgets('offers Exit only when there is nothing else to try', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        host(IdentityNotConfirmedScreen(strings: strings, onExit: () {})),
      );
      expect(find.byType(MkButton), findsOneWidget);
      expect(find.text('Exit'), findsOneWidget);
    });

    testWidgets('offers another way when one exists', (WidgetTester tester) async {
      // Exit alone was the original behaviour and it sent a patient to the counter while
      // they were holding a hospital card that would have worked — hardest on exactly the
      // people a shared family phone makes ambiguous. This returns them to the same choice
      // they had a moment ago; it does not weaken the refusal, and the message stays
      // neutral about why.
      var tried = 0;
      await tester.pumpWidget(
        host(
          IdentityNotConfirmedScreen(
            strings: strings,
            onExit: () {},
            onTryAnotherWay: () => tried += 1,
          ),
        ),
      );

      expect(find.text('Try a different way'), findsOneWidget);
      await tester.tap(find.text('Try a different way'));
      await tester.pumpAndSettle();
      expect(tried, 1);

      // Still says nothing about which check failed.
      expect(find.textContaining('not found'), findsNothing);
      expect(find.textContaining('two'), findsNothing);
    });
  });

  group('mobile entry rejects what the server would', () {
    testWidgets('keeps Send code inactive for a number that cannot be Indian',
        (WidgetTester tester) async {
      // Ten digits, so the display is full — but the contract's rule is
      // /^[6-9]\d{9}$/, and the server refuses anything else with VALIDATION_FAILED.
      // Sending it put the patient on the generic error screen with their session gone,
      // for a mistyped first digit.
      await tester.pumpWidget(
        host(
          MobileEntryScreen(
            strings: KioskStrings.of('en'),
            value: '1234567890',
            onDigit: (_) {},
            onBackspace: () {},
            onClear: () {},
            onSubmit: () {},
            onExit: () {},
          ),
        ),
      );

      final MkButton send = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'Send code'),
      );
      expect(send.onPressed, isNull);
      expect(find.textContaining('begin with 6, 7, 8 or 9'), findsOneWidget);
    });

    testWidgets('accepts a real Indian mobile number', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          MobileEntryScreen(
            strings: KioskStrings.of('en'),
            value: '9876543210',
            onDigit: (_) {},
            onBackspace: () {},
            onClear: () {},
            onSubmit: () {},
            onExit: () {},
          ),
        ),
      );

      final MkButton send = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'Send code'),
      );
      expect(send.onPressed, isNotNull);
      expect(find.textContaining('begin with 6'), findsNothing);
    });

    testWidgets('says nothing while the number is still being typed',
        (WidgetTester tester) async {
      // A hint shown after two digits would accuse every patient mid-entry.
      await tester.pumpWidget(
        host(
          MobileEntryScreen(
            strings: KioskStrings.of('en'),
            value: '12',
            onDigit: (_) {},
            onBackspace: () {},
            onClear: () {},
            onSubmit: () {},
            onExit: () {},
          ),
        ),
      );

      expect(find.textContaining('begin with 6'), findsNothing);
    });

    test('matches the contract rule exactly', () {
      for (final String bad in <String>['1234567890', '5999999999', '987654321', '', 'abcdefghij']) {
        expect(MobileEntryScreen.indianMobile.hasMatch(bad), isFalse, reason: bad);
      }
      for (final String good in <String>['6000000000', '7123456789', '8999999999', '9876543210']) {
        expect(MobileEntryScreen.indianMobile.hasMatch(good), isTrue, reason: good);
      }
    });
  });
}
