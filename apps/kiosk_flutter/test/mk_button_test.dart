import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/theme/design_tokens.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

Widget _host(Widget child, {AccessibilitySettings? settings}) {
  return MaterialApp(
    home: AccessibilityScope(
      settings: settings ?? const AccessibilitySettings(),
      child: Scaffold(body: Center(child: child)),
    ),
  );
}

void main() {
  testWidgets('meets the 48dp minimum touch target', (WidgetTester tester) async {
    await tester.pumpWidget(
      _host(MkButton(label: 'Continue', onPressed: () {})),
    );

    final Size size = tester.getSize(find.byType(MkButton));
    expect(size.height, greaterThanOrEqualTo(MkA11y.minTouchTargetDp));
    expect(size.width, greaterThanOrEqualTo(MkA11y.minTouchTargetDp));
  });

  testWidgets('renders the text label even when an icon is supplied', (WidgetTester tester) async {
    await tester.pumpWidget(
      _host(MkButton(label: 'Select Language', icon: Icons.language, onPressed: () {})),
    );

    expect(find.text('Select Language'), findsOneWidget);
    expect(find.byIcon(Icons.language), findsOneWidget);
  });

  testWidgets('exposes button semantics for screen readers', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _host(MkButton(label: 'Continue', onPressed: () {})),
    );

    final SemanticsNode node = tester.getSemantics(find.byType(MkButton));
    expect(node.label, contains('Continue'));
    expect(node.hasFlag(SemanticsFlag.isButton), isTrue);
    handle.dispose();
  });

  testWidgets('a disabled button stays visible rather than disappearing', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_host(const MkButton(label: 'Continue', onPressed: null)));
    expect(find.text('Continue'), findsOneWidget);
  });

  testWidgets('large text scales the label', (WidgetTester tester) async {
    await tester.pumpWidget(
      _host(MkButton(label: 'Continue', onPressed: () {})),
    );
    final double normal = tester.widget<Text>(find.text('Continue')).style!.fontSize!;

    await tester.pumpWidget(
      _host(
        MkButton(label: 'Continue', onPressed: () {}),
        settings: const AccessibilitySettings(largeText: true),
      ),
    );
    final double large = tester.widget<Text>(find.text('Continue')).style!.fontSize!;

    expect(large, greaterThan(normal));
    expect(large / normal, closeTo(MkA11y.largeTextScale, 0.001));
  });

  testWidgets('a selected option uses the orange selected-state colour', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _host(MkButton(label: 'हिन्दी', selected: true, onPressed: () {})),
    );

    final Material material = tester.widget<Material>(
      find.descendant(of: find.byType(MkButton), matching: find.byType(Material)).first,
    );
    expect(material.color, MkColors.lightOrange);
  });

  testWidgets('a tap invokes the callback exactly once', (WidgetTester tester) async {
    int taps = 0;
    await tester.pumpWidget(_host(MkButton(label: 'Continue', onPressed: () => taps += 1)));

    await tester.tap(find.byType(MkButton));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });
}
