import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/platform/qr_scanner.dart';
import 'package:medikiosk_kiosk/screens/arrival_screens.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  group('scan screen', () {
    testWidgets('offers Scan QR and Exit', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(ScanQrScreen(strings: strings, onScan: () {}, onExit: () {})),
      );
      expect(find.text('Scan QR'), findsOneWidget);
      expect(find.text('Exit'), findsOneWidget);
    });

    testWidgets('offers no way to generate a new code', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(ScanQrScreen(strings: strings, onScan: () {}, onExit: () {})),
      );
      // The kiosk does not issue QRs; offering it would send patients round a loop the
      // kiosk cannot close.
      expect(find.textContaining('Generate'), findsNothing);
      expect(find.textContaining('New QR'), findsNothing);
    });

    testWidgets('says plainly when the camera is unavailable', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          ScanQrScreen(
            strings: strings,
            onScan: () {},
            onExit: () {},
            cameraUnavailable: true,
          ),
        ),
      );

      expect(find.textContaining('scanner is not working'), findsOneWidget);
      final MkButton scan = tester.widget<MkButton>(
        find.ancestor(of: find.text('Scan QR'), matching: find.byType(MkButton)),
      );
      expect(scan.onPressed, isNull);
    });
  });

  group('confirm visit', () {
    Future<void> pump(WidgetTester tester, {VoidCallback? onConfirm}) {
      return tester.pumpWidget(
        host(
          ConfirmVisitScreen(
            strings: strings,
            maskedName: 'R*** K****',
            maskedMobile: '******3210',
            hospitalName: 'Government AYUSH Hospital',
            departmentName: 'Ayurveda OPD',
            visitTypeLabel: 'Regular follow-up',
            onConfirm: onConfirm ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('shows the visit with the identity masked', (WidgetTester tester) async {
      await pump(tester);
      expect(find.text('R*** K****'), findsOneWidget);
      expect(find.text('******3210'), findsOneWidget);
      // Facility details are not personal and help the patient spot a wrong visit.
      expect(find.text('Ayurveda OPD'), findsOneWidget);
      expect(find.text('Regular follow-up'), findsOneWidget);
    });

    testWidgets('discloses nothing clinical', (WidgetTester tester) async {
      await pump(tester);
      for (final String word in <String>['diagnos', 'medicine', 'symptom', 'complaint']) {
        expect(find.textContaining(word), findsNothing);
      }
    });

    testWidgets('requires an explicit confirmation', (WidgetTester tester) async {
      int confirmed = 0;
      await pump(tester, onConfirm: () => confirmed += 1);
      await tester.tap(find.text('Yes, continue'));
      await tester.pumpAndSettle();
      expect(confirmed, 1);
    });
  });

  group('changed since', () {
    testWidgets('asks yes or no first', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          ChangedSinceScreen(
            strings: strings,
            selected: const <ChangedSection>{},
            onToggle: (_) {},
            onNothingChanged: () {},
            onContinue: () {},
            onExit: () {},
          ),
        ),
      );

      expect(find.text('No, nothing has changed'), findsOneWidget);
      expect(find.text('Yes, something has changed'), findsOneWidget);
      expect(find.text('Symptoms'), findsNothing);
    });

    testWidgets('lists the sections once the patient says something changed', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        host(
          ChangedSinceScreen(
            strings: strings,
            declaring: true,
            selected: const <ChangedSection>{},
            onToggle: (_) {},
            onNothingChanged: () {},
            onContinue: () {},
            onExit: () {},
          ),
        ),
      );

      for (final String label in <String>[
        'Symptoms',
        'Medicines',
        'Allergy or side effect',
        'New report',
        'New diagnosis',
        'Something else',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
    });

    testWidgets('will not continue until a section is named', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          ChangedSinceScreen(
            strings: strings,
            declaring: true,
            selected: const <ChangedSection>{},
            onToggle: (_) {},
            onNothingChanged: () {},
            onContinue: () {},
            onExit: () {},
          ),
        ),
      );

      // "Something changed" with nothing named tells the doctor nothing and reopens nothing.
      final MkButton continueButton = tester.widget<MkButton>(
        find.ancestor(of: find.text('Continue'), matching: find.byType(MkButton)),
      );
      expect(continueButton.onPressed, isNull);
    });

    testWidgets('continues once a section is selected', (WidgetTester tester) async {
      int continued = 0;
      await tester.pumpWidget(
        host(
          ChangedSinceScreen(
            strings: strings,
            declaring: true,
            selected: const <ChangedSection>{ChangedSection.symptoms},
            onToggle: (_) {},
            onNothingChanged: () {},
            onContinue: () => continued += 1,
            onExit: () {},
          ),
        ),
      );

      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(continued, 1);
    });

    testWidgets('maps each section to the wire value the API expects', (
      WidgetTester tester,
    ) async {
      expect(ChangedSection.allergy.wire, 'ALLERGY_OR_SIDE_EFFECT');
      expect(ChangedSection.values.map((ChangedSection s) => s.wire).toList(), <String>[
        'SYMPTOMS',
        'MEDICINES',
        'ALLERGY_OR_SIDE_EFFECT',
        'NEW_REPORT',
        'NEW_DIAGNOSIS',
        'OTHER',
      ]);
    });
  });

  group('rejected QR', () {
    testWidgets('gives one neutral message and Exit only', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(QrRejectedScreen(strings: strings, onExit: () {}, correlationId: 'abc-123')),
      );

      expect(find.text('This QR cannot be used'), findsOneWidget);
      expect(find.byType(MkButton), findsOneWidget);
      expect(find.text('Exit'), findsOneWidget);
      // No hint about WHICH check failed — that would help someone probe a stolen code.
      // ("cannot be used" is the neutral phrasing itself, so the body is what matters.)
      expect(find.textContaining('expired'), findsNothing);
      expect(find.textContaining('already'), findsNothing);
      expect(find.textContaining('wrong hospital'), findsNothing);
      expect(find.textContaining('signature'), findsNothing);
      expect(find.textContaining('abc-123'), findsOneWidget);
    });
  });

  group('scanner', () {
    test('the unavailable scanner never fabricates a payload', () async {
      const UnavailableQrScanner scanner = UnavailableQrScanner();
      final ScanResult result = await scanner.scan();

      // A fake that returned a plausible token would let the arrival flow appear to work
      // on a machine that cannot scan anything.
      expect(result.payload, isNull);
      expect(result.cameraUnavailable, isTrue);
      expect(await scanner.isAvailable(), isFalse);
    });

    test('the scripted scanner returns what the harness supplied', () async {
      final ScriptedQrScanner scanner = ScriptedQrScanner('mk1.dev.payload.sig');
      expect((await scanner.scan()).payload, 'mk1.dev.payload.sig');

      scanner.payload = null;
      expect((await scanner.scan()).cancelled, isTrue);
    });

    test('stopping releases the camera, so no preview survives a session', () async {
      final ScriptedQrScanner scanner = ScriptedQrScanner('x');
      await scanner.stop();
      expect(scanner.stopCount, 1);
    });
  });
}
