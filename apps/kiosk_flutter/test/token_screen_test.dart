import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/platform/token_printer.dart';
import 'package:medikiosk_kiosk/screens/token_screen.dart';
import 'package:medikiosk_kiosk/theme/design_tokens.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  Future<void> pump(
    WidgetTester tester, {
    bool printerAvailable = false,
    bool printFailed = false,
    VoidCallback? onPrint,
    VoidCallback? onFinish,
  }) {
    return tester.pumpWidget(
      host(
        TokenScreen(
          strings: strings,
          token: 'AYU-0247',
          departmentName: 'Ayurveda OPD',
          room: '3',
          queueStatus: 'Waiting',
          printerAvailable: printerAvailable,
          printFailed: printFailed,
          onPrint: onPrint ?? () {},
          onSendToMobile: () {},
          onFinish: onFinish ?? () {},
        ),
      ),
    );
  }

  testWidgets('shows the token and where to go', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('AYU-0247'), findsOneWidget);
    expect(find.textContaining('Ayurveda OPD'), findsOneWidget);
    expect(find.textContaining('Room: 3'), findsOneWidget);
    expect(find.textContaining('Waiting'), findsOneWidget);
  });

  testWidgets('renders the token larger than anything else on screen', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    final double tokenSize = tester.widget<Text>(find.text('AYU-0247')).style!.fontSize!;
    final double titleSize =
        tester.widget<Text>(find.text('Check-in successful')).style!.fontSize!;

    // It has to be readable at arm's length and photographable, because the printer is
    // a convenience and must never be load-bearing.
    expect(tokenSize, greaterThan(titleSize));
  });

  testWidgets('works with no printer at all', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('Print token'), findsNothing);
    // The token and the way out are still there.
    expect(find.text('AYU-0247'), findsOneWidget);
    expect(find.text('Finish'), findsOneWidget);
  });

  testWidgets('offers printing when a printer is present', (WidgetTester tester) async {
    int printed = 0;
    await pump(tester, printerAvailable: true, onPrint: () => printed += 1);
    await tester.tap(find.text('Print token'));
    await tester.pumpAndSettle();
    expect(printed, 1);
  });

  testWidgets('says the token is still valid when printing fails', (WidgetTester tester) async {
    await pump(tester, printerAvailable: true, printFailed: true);

    expect(find.textContaining('still valid'), findsOneWidget);
    // The token is unchanged and the patient can still finish.
    expect(find.text('AYU-0247'), findsOneWidget);
    expect(find.text('Finish'), findsOneWidget);
  });

  testWidgets('uses success green, not alarm red', (WidgetTester tester) async {
    await pump(tester);
    final Icon icon = tester.widget<Icon>(find.byType(Icon).first);
    expect(icon.color, MkColors.success);
    expect(icon.color, isNot(MkColors.internalAlert));
  });

  testWidgets('reads the token aloud correctly for a screen reader', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pump(tester);
    expect(
      tester.getSemantics(find.text('AYU-0247')).label,
      contains('AYU-0247'),
    );
    handle.dispose();
  });

  group('pending', () {
    testWidgets('never says the check-in failed', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          TokenPendingScreen(strings: strings, onFinish: () {}, correlationId: 'abc-123'),
        ),
      );

      // The outcome is unknown, and it may well have succeeded. The honest instruction is
      // to ask a person.
      expect(find.text('Please speak to the counter'), findsOneWidget);
      expect(find.textContaining('failed'), findsNothing);
      expect(find.textContaining('error'), findsNothing);
      expect(find.textContaining('abc-123'), findsOneWidget);
    });

    testWidgets('offers no retry', (WidgetTester tester) async {
      await tester.pumpWidget(host(TokenPendingScreen(strings: strings, onFinish: () {})));
      // The backend decides whether a retry is safe; a kiosk that second-guessed it could
      // produce a duplicate token.
      expect(find.byType(MkButton), findsOneWidget);
      expect(find.text('Finish'), findsOneWidget);
    });
  });

  group('printer', () {
    test('the unavailable printer never reports success', () async {
      const UnavailableTokenPrinter printer = UnavailableTokenPrinter();
      final PrintResult result = await printer.printToken(
        const TokenSlip(token: 'AYU-0247', departmentName: 'Ayurveda OPD'),
      );
      expect(result.printed, isFalse);
      expect(result.failure, PrintFailure.unavailable);
      expect(await printer.isAvailable(), isFalse);
    });

    test('a scripted printer records what it printed', () async {
      final ScriptedTokenPrinter printer = ScriptedTokenPrinter();
      await printer.printToken(
        const TokenSlip(token: 'AYU-0247', departmentName: 'Ayurveda OPD', room: '3'),
      );
      expect(printer.printed.single.token, 'AYU-0247');
      expect(printer.printed.single.room, '3');
    });

    test('reports why a print failed, so ops can tell paper from hardware', () async {
      final ScriptedTokenPrinter printer = ScriptedTokenPrinter(failWith: PrintFailure.noPaper);
      final PrintResult result = await printer.printToken(
        const TokenSlip(token: 'AYU-0247', departmentName: 'Ayurveda OPD'),
      );
      expect(result.failure, PrintFailure.noPaper);
    });
  });
}
