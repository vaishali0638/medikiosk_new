import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/widgets/mk_keypad.dart';

import 'support/widget_host.dart';

void main() {
  testWidgets('shows ten digits plus clear and delete', (WidgetTester tester) async {
    await tester.pumpWidget(
      host(MkKeypad(onDigit: (_) {}, onBackspace: () {}, onClear: () {})),
    );

    for (int i = 0; i <= 9; i += 1) {
      expect(find.text('$i'), findsOneWidget);
    }
    expect(find.text('C'), findsOneWidget);
    expect(find.byIcon(Icons.backspace_outlined), findsOneWidget);
  });

  testWidgets('reports the digit that was pressed', (WidgetTester tester) async {
    final List<String> pressed = <String>[];
    await tester.pumpWidget(
      host(MkKeypad(onDigit: pressed.add, onBackspace: () {}, onClear: () {})),
    );

    await tester.tap(find.text('7'));
    await tester.tap(find.text('0'));
    await tester.pumpAndSettle();
    expect(pressed, <String>['7', '0']);
  });

  testWidgets('every key clears the touch-target floor generously', (WidgetTester tester) async {
    await tester.pumpWidget(
      host(MkKeypad(onDigit: (_) {}, onBackspace: () {}, onClear: () {})),
    );

    // Hit repeatedly, often by someone with poor eyesight or an unsteady hand.
    for (int i = 0; i <= 9; i += 1) {
      expect(tester.getSize(find.text('$i')).height, greaterThan(0));
      final Size key = tester.getSize(
        find.ancestor(of: find.text('$i'), matching: find.byType(Material)).first,
      );
      expect(key.height, greaterThanOrEqualTo(48.0));
    }
  });

  testWidgets('goes inert while disabled', (WidgetTester tester) async {
    final List<String> pressed = <String>[];
    await tester.pumpWidget(
      host(MkKeypad(onDigit: pressed.add, onBackspace: () {}, onClear: () {}, enabled: false)),
    );

    await tester.tap(find.text('5'));
    await tester.pumpAndSettle();
    expect(pressed, isEmpty);
  });

  group('digit display', () {
    testWidgets('shows one slot per expected digit', (WidgetTester tester) async {
      await tester.pumpWidget(host(const MkDigitDisplay(value: '12', length: 6)));
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.byType(Container), findsNWidgets(6));
    });

    testWidgets('announces progress for screen readers', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(
        host(const MkDigitDisplay(value: '123', length: 6, semanticLabel: 'Code')),
      );

      final SemanticsNode node = tester.getSemantics(find.byType(MkDigitDisplay));
      expect(node.value, contains('3 of 6'));
      handle.dispose();
    });
  });
}
