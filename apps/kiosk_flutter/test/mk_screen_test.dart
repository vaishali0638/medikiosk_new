import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';
import 'package:medikiosk_kiosk/widgets/mk_screen.dart';

Widget _host(Widget child) => MaterialApp(
      home: AccessibilityScope(
        settings: const AccessibilitySettings(),
        child: child,
      ),
    );

void main() {
  testWidgets('keeps the heading and primary action visible when content overflows', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _host(
        MkScreen(
          title: 'What brings you today?',
          child: Column(
            children: List<Widget>.generate(
              40,
              (int i) => SizedBox(height: 80, child: Text('Option $i')),
            ),
          ),
          primaryAction: MkButton(
            label: 'Continue',
            emphasis: MkButtonEmphasis.primary,
            onPressed: () {},
          ),
          exitAction: MkButton(
            label: 'Exit',
            emphasis: MkButtonEmphasis.quiet,
            onPressed: () {},
          ),
        ),
      ),
    );

    // The question and both actions are on screen without the patient scrolling.
    expect(find.text('What brings you today?'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);
    expect(find.text('Exit'), findsOneWidget);
  });

  testWidgets('marks the title as a semantic header', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _host(const MkScreen(title: 'Privacy and consent', child: SizedBox.shrink())),
    );

    final SemanticsNode node = tester.getSemantics(find.text('Privacy and consent'));
    expect(node.hasFlag(SemanticsFlag.isHeader), isTrue);
    handle.dispose();
  });
}
