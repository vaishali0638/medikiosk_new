import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/followup_screens.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  group('previous visit', () {
    Future<void> pump(WidgetTester tester, {VoidCallback? onContinue}) {
      return tester.pumpWidget(
        host(
          PreviousVisitScreen(
            strings: strings,
            verifiedOn: '2 August 2026',
            department: 'Ayurveda OPD',
            onContinue: onContinue ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('names the visit being followed up', (WidgetTester tester) async {
      await pump(tester);

      // A patient cannot report changes "since last time" without being told which time
      // is meant; someone attending three departments has three last times.
      expect(find.text('2 August 2026'), findsOneWidget);
      expect(find.text('Ayurveda OPD'), findsOneWidget);
    });

    testWidgets('says a doctor confirmed it, not that a system produced it', (
      WidgetTester tester,
    ) async {
      await pump(tester);

      expect(find.textContaining('A doctor confirmed your information'), findsOneWidget);
      expect(find.textContaining('draft'), findsNothing);
      expect(find.textContaining('AI'), findsNothing);
    });
  });

  group('what changed', () {
    Future<void> pump(
      WidgetTester tester, {
      Set<FollowUpSection> selected = const <FollowUpSection>{},
      ValueChanged<FollowUpSection>? onToggle,
      VoidCallback? onNothingChanged,
      VoidCallback? onContinue,
    }) {
      return tester.pumpWidget(
        host(
          WhatChangedScreen(
            strings: strings,
            selected: selected,
            onToggle: onToggle ?? (_) {},
            onNothingChanged: onNothingChanged ?? () {},
            onContinue: onContinue ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('offers all eight things a follow-up asks about', (WidgetTester tester) async {
      await pump(tester);

      for (final FollowUpSection section in FollowUpSection.values) {
        await tester.ensureVisible(find.text(strings[section.stringKey]));
        expect(find.text(strings[section.stringKey]), findsOneWidget);
      }
    });

    testWidgets('"nothing has changed" is its own answer, not an empty Continue', (
      WidgetTester tester,
    ) async {
      bool declared = false;
      await pump(tester, onNothingChanged: () => declared = true);

      // A doctor should be able to tell a patient who reported nothing from one who
      // skipped the question.
      final MkButton button = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'Nothing has changed'),
      );
      expect(button.emphasis, MkButtonEmphasis.primary);

      await tester.tap(find.text('Nothing has changed'));
      expect(declared, isTrue);
    });

    testWidgets('once something is selected, Continue replaces it', (
      WidgetTester tester,
    ) async {
      await pump(tester, selected: <FollowUpSection>{FollowUpSection.medicines});

      expect(find.text('Nothing has changed'), findsNothing);
      final MkButton button = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'Continue'),
      );
      expect(button.emphasis, MkButtonEmphasis.primary);
    });

    testWidgets('several things can change at once', (WidgetTester tester) async {
      final List<FollowUpSection> toggled = <FollowUpSection>[];
      await pump(tester, onToggle: toggled.add);

      await tester.ensureVisible(find.text(strings['followup.medicines']));
      await tester.tap(find.text(strings['followup.medicines']));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text(strings['followup.newSymptom']));
      await tester.tap(find.text(strings['followup.newSymptom']));
      await tester.pumpAndSettle();

      expect(toggled, <FollowUpSection>[FollowUpSection.medicines, FollowUpSection.newSymptom]);
    });

    testWidgets('exit is reachable', (WidgetTester tester) async {
      await pump(tester);
      expect(find.text('Exit'), findsOneWidget);
    });
  });
}
