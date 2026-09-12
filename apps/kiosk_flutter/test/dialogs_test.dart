import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/dialogs.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/theme/mk_theme.dart';

/// Hosts a button that opens the dialog under test and records its result.
Widget dialogHost(Future<bool> Function(BuildContext) open, List<bool> results) {
  return AccessibilityScope(
    settings: const AccessibilitySettings(),
    child: MaterialApp(
      theme: MkTheme.build(),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: ElevatedButton(
              onPressed: () async => results.add(await open(context)),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  group('exit confirmation', () {
    testWidgets('warns that the session will be cleared', (WidgetTester tester) async {
      await tester.pumpWidget(
        dialogHost((BuildContext c) => showExitConfirmation(c, strings), <bool>[]),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      expect(find.text('Are you sure you want to exit?'), findsOneWidget);
      expect(find.text('Your current kiosk session will be cleared.'), findsOneWidget);
    });

    testWidgets('returns true when the patient confirms', (WidgetTester tester) async {
      final List<bool> results = <bool>[];
      await tester.pumpWidget(
        dialogHost((BuildContext c) => showExitConfirmation(c, strings), results),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(InkWell, 'Exit'));
      await tester.pumpAndSettle();
      expect(results, <bool>[true]);
    });

    testWidgets('returns false when the patient continues', (WidgetTester tester) async {
      final List<bool> results = <bool>[];
      await tester.pumpWidget(
        dialogHost((BuildContext c) => showExitConfirmation(c, strings), results),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(InkWell, 'Continue'));
      await tester.pumpAndSettle();
      expect(results, <bool>[false]);
    });

    testWidgets('cannot be dismissed by tapping outside', (WidgetTester tester) async {
      await tester.pumpWidget(
        dialogHost((BuildContext c) => showExitConfirmation(c, strings), <bool>[]),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      // A stray touch must not silently discard a half-finished session, nor silently
      // keep one the patient meant to end.
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(find.text('Are you sure you want to exit?'), findsOneWidget);
    });
  });

  group('timeout warning', () {
    testWidgets('shows a countdown so a slow reader knows how long they have', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        dialogHost(
          (BuildContext c) => showTimeoutWarning(c, strings, const Duration(seconds: 30)),
          <bool>[],
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pump();

      expect(find.textContaining('30 seconds remaining'), findsOneWidget);

      await tester.pump(const Duration(seconds: 1));
      expect(find.textContaining('29 seconds remaining'), findsOneWidget);

      // Let the periodic ticker drain before the test ends.
      await tester.pump(const Duration(seconds: 30));
      await tester.pumpAndSettle();
    });

    testWidgets('returns true when the patient says they are still there', (
      WidgetTester tester,
    ) async {
      final List<bool> results = <bool>[];
      await tester.pumpWidget(
        dialogHost(
          (BuildContext c) => showTimeoutWarning(c, strings, const Duration(seconds: 30)),
          results,
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pump();

      await tester.tap(find.text('I am still here'));
      await tester.pumpAndSettle();
      expect(results, <bool>[true]);
    });

    testWidgets('offers no way to dismiss without answering', (WidgetTester tester) async {
      await tester.pumpWidget(
        dialogHost(
          (BuildContext c) => showTimeoutWarning(c, strings, const Duration(seconds: 30)),
          <bool>[],
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pump();

      await tester.tapAt(const Offset(10, 10));
      await tester.pump();
      expect(find.text('Are you still there?'), findsOneWidget);

      await tester.pump(const Duration(seconds: 31));
      await tester.pumpAndSettle();
    });
  });
}
