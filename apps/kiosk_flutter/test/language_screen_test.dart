import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/config/kiosk_config.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/language_screen.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

const List<LanguageOption> _reviewed = <LanguageOption>[
  LanguageOption(tag: 'en', label: 'English', clinicallyReviewed: true, audioAvailable: true),
  LanguageOption(tag: 'hi', label: 'हिन्दी', clinicallyReviewed: true, audioAvailable: true),
];

void main() {
  Future<void> pump(
    WidgetTester tester, {
    List<LanguageOption> languages = _reviewed,
    String? selected,
    ValueChanged<String>? onSelect,
    VoidCallback? onContinue,
    VoidCallback? onExit,
    AccessibilitySettings settings = const AccessibilitySettings(),
  }) {
    return tester.pumpWidget(
      host(
        LanguageScreen(
          strings: KioskStrings.of('en'),
          languages: languages,
          selectedTag: selected,
          onSelect: onSelect ?? (_) {},
          onContinue: onContinue,
          onExit: onExit ?? () {},
          onToggleAudioGuidance: () {},
          onToggleLargeText: () {},
          onToggleHighContrast: () {},
        ),
        settings: settings,
      ),
    );
  }

  testWidgets('offers each reviewed language in its own script', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('हिन्दी'), findsOneWidget);
  });

  testWidgets('withholds a language that has not been clinically reviewed', (
    WidgetTester tester,
  ) async {
    await pump(
      tester,
      languages: const <LanguageOption>[
        ..._reviewed,
        LanguageOption(
          tag: 'ta',
          label: 'தமிழ்',
          clinicallyReviewed: false,
          audioAvailable: false,
        ),
      ],
    );

    // Showing an unreviewed translation would present unapproved wording as if it were
    // approved clinical content.
    expect(find.text('தமிழ்'), findsNothing);
  });

  testWidgets('keeps Continue inert until a language is chosen', (WidgetTester tester) async {
    await pump(tester);
    final MkButton continueButton = tester.widget<MkButton>(
      find.ancestor(of: find.text('Continue'), matching: find.byType(MkButton)),
    );
    // Disabled, not hidden: the layout the patient is reading must not shift.
    expect(continueButton.onPressed, isNull);
  });

  testWidgets('enables Continue once a language is chosen', (WidgetTester tester) async {
    int continued = 0;
    await pump(tester, selected: 'hi', onContinue: () => continued += 1);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(continued, 1);
  });

  testWidgets('reports the chosen language tag', (WidgetTester tester) async {
    final List<String> chosen = <String>[];
    await pump(tester, onSelect: chosen.add);

    await tester.tap(find.text('हिन्दी'));
    await tester.pumpAndSettle();
    expect(chosen, <String>['hi']);
  });

  testWidgets('always offers Exit', (WidgetTester tester) async {
    int exits = 0;
    await pump(tester, onExit: () => exits += 1);

    await tester.tap(find.text('Exit'));
    await tester.pumpAndSettle();
    expect(exits, 1);
  });

  testWidgets('shows the three accessibility toggles with their state', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    expect(find.text('Audio Guidance: Off'), findsOneWidget);
    expect(find.text('Large Text: Off'), findsOneWidget);
    expect(find.text('High Contrast: Off'), findsOneWidget);
  });

  testWidgets('reflects an enabled accessibility setting', (WidgetTester tester) async {
    await pump(tester, settings: const AccessibilitySettings(largeText: true));
    expect(find.text('Large Text: On'), findsOneWidget);
  });

  testWidgets('names the language and its tag for screen readers', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pump(tester);

    final MkButton hindi = tester.widget<MkButton>(
      find.ancestor(of: find.text('हिन्दी'), matching: find.byType(MkButton)),
    );
    expect(hindi.semanticLabel, contains('hi'));
    handle.dispose();
  });

  testWidgets('renders no forbidden option', (WidgetTester tester) async {
    await pump(tester);
    for (final String forbidden in <String>[
      'Staff Help',
      'Urgent Help',
      'Generate New QR',
      'Enter token',
    ]) {
      expect(find.text(forbidden), findsNothing);
    }
  });
}
