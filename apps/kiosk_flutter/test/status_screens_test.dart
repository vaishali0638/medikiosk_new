import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/status_screens.dart';
import 'package:medikiosk_kiosk/theme/design_tokens.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  group('session expired', () {
    testWidgets('says the information was cleared', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(SessionExpiredScreen(strings: strings, onStartAgain: () {})),
      );
      expect(find.text('This session has ended'), findsOneWidget);
      expect(find.textContaining('cleared'), findsOneWidget);
    });

    testWidgets('offers a way to start again', (WidgetTester tester) async {
      int restarts = 0;
      await tester.pumpWidget(
        host(SessionExpiredScreen(strings: strings, onStartAgain: () => restarts += 1)),
      );
      await tester.tap(find.text('Start again'));
      await tester.pumpAndSettle();
      expect(restarts, 1);
    });
  });

  group('error screen', () {
    testWidgets('never says what failed', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(KioskErrorScreen(strings: strings, onStartAgain: () {}, correlationId: 'abc-123')),
      );

      // A kiosk stands in a public corridor. An error that explains why a lookup failed
      // leaks information about who is registered.
      expect(find.textContaining('database'), findsNothing);
      expect(find.textContaining('patient'), findsNothing);
      expect(find.textContaining('not found'), findsNothing);
    });

    testWidgets('shows a reference code so staff can trace it', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(KioskErrorScreen(strings: strings, onStartAgain: () {}, correlationId: 'abc-123')),
      );
      expect(find.textContaining('abc-123'), findsOneWidget);
    });

    testWidgets('uses no alarm colour — this is not a clinical emergency', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        host(KioskErrorScreen(strings: strings, onStartAgain: () {})),
      );
      final Icon icon = tester.widget<Icon>(find.byType(Icon).first);
      expect(icon.color, isNot(MkColors.internalAlert));
    });
  });

  group('network unavailable', () {
    testWidgets('offers a retry', (WidgetTester tester) async {
      int retries = 0;
      await tester.pumpWidget(
        host(NetworkUnavailableScreen(strings: strings, onRetry: () => retries += 1)),
      );
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(retries, 1);
    });

    testWidgets('offers no offline check-in path', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(NetworkUnavailableScreen(strings: strings, onRetry: () {})),
      );
      // A token can only come from the hospital HIS, so continuing offline would build up
      // work that cannot produce one.
      expect(find.text('Continue'), findsNothing);
      expect(find.text('Enter token'), findsNothing);
      expect(find.text('Generate New QR'), findsNothing);
    });
  });

  group('startup', () {
    testWidgets('shows progress while booting', (WidgetTester tester) async {
      await tester.pumpWidget(host(StartupScreen(strings: strings)));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('states plainly when the kiosk cannot be used', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(StartupScreen(strings: strings, unavailableReason: 'Configuration not published')),
      );
      expect(find.text('This kiosk is not ready for use.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });
}
