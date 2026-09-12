import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/home_screen.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  Future<void> pumpHome(
    WidgetTester tester, {
    String language = 'en',
    VoidCallback? onSelectLanguage,
    AccessibilitySettings settings = const AccessibilitySettings(),
  }) {
    return tester.pumpWidget(
      host(
        HomeScreen(
          strings: KioskStrings.of(language),
          onCheckInWithMobileQr: null,
          onNewRegistration: null,
          onExistingPatientCheckIn: null,
          onSelectLanguage: onSelectLanguage ?? () {},
          onToggleAudioGuidance: () {},
        ),
        settings: settings,
      ),
    );
  }

  testWidgets('shows exactly the five specified home options', (WidgetTester tester) async {
    await pumpHome(tester);

    expect(find.text('Check in with Mobile QR'), findsOneWidget);
    expect(find.text('New Registration'), findsOneWidget);
    expect(find.text('Existing Patient Check-in'), findsOneWidget);
    expect(find.text('Select Language'), findsOneWidget);
    expect(find.text('Audio Guidance'), findsOneWidget);
    expect(find.byType(MkButton), findsNWidgets(5));
  });

  testWidgets('shows the product title and tagline', (WidgetTester tester) async {
    await pumpHome(tester);
    expect(find.text('MediKiosk'), findsOneWidget);
    expect(find.text('Prepare your hospital visit'), findsOneWidget);
  });

  testWidgets('has no Exit — an idle kiosk has no session to end', (WidgetTester tester) async {
    await pumpHome(tester);
    expect(find.text('Exit'), findsNothing);
  });

  testWidgets('renders none of the forbidden options', (WidgetTester tester) async {
    await pumpHome(tester);

    // Each of these either routes around hospital authority or advertises a support
    // channel this deployment does not provide. CI scans source; this checks what a
    // patient can actually see.
    for (final String forbidden in <String>[
      'Staff Help',
      'Get Staff Help',
      'Urgent Help',
      'I need urgent help',
      'Generate New QR',
      'Enter hospital reference',
      'Register without phone',
      'Enter token',
      'Approved ABHA Flow',
    ]) {
      expect(find.text(forbidden), findsNothing, reason: '"$forbidden" must never render');
    }
  });

  testWidgets('offers language selection', (WidgetTester tester) async {
    int taps = 0;
    await pumpHome(tester, onSelectLanguage: () => taps += 1);

    await tester.tap(find.text('Select Language'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('renders unbuilt journeys inert rather than removing them', (
    WidgetTester tester,
  ) async {
    await pumpHome(tester);
    // Phases 5-6 wire these. Keeping them visible preserves the specified layout; keeping
    // them inert means nothing pretends to work.
    final MkButton qr = tester.widget<MkButton>(
      find.ancestor(of: find.text('Check in with Mobile QR'), matching: find.byType(MkButton)),
    );
    expect(qr.onPressed, isNull);
  });

  testWidgets('renders in Hindi when Hindi is selected', (WidgetTester tester) async {
    await pumpHome(tester, language: 'hi');
    expect(find.text('नया पंजीकरण'), findsOneWidget);
    expect(find.text('भाषा चुनें'), findsOneWidget);
  });

  testWidgets('every touch target clears the 48dp floor', (WidgetTester tester) async {
    await pumpHome(tester);
    for (final Element element in find.byType(MkButton).evaluate()) {
      final Size size = tester.getSize(find.byWidget(element.widget));
      expect(size.height, greaterThanOrEqualTo(48.0));
    }
  });

  testWidgets('does not clip its options on a short screen', (WidgetTester tester) async {
    // A landscape wall mount is short. Overflowing here would put the last options off
    // the bottom of the glass where nobody can reach them.
    tester.view.physicalSize = const Size(1024, 500);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await pumpHome(tester);
    expect(tester.takeException(), isNull);
    expect(find.byType(MkButton), findsNWidgets(5));
  });

  testWidgets('does not clip its options with Large Text on', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await pumpHome(tester, settings: const AccessibilitySettings(largeText: true));
    expect(tester.takeException(), isNull);
  });

  testWidgets('marks the title as a header for screen readers', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pumpHome(tester);
    expect(tester.getSemantics(find.text('MediKiosk')).flagsCollection.isHeader, isTrue);
    handle.dispose();
  });
}
