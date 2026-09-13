import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/ayush_screen.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  Future<void> pump(
    WidgetTester tester, {
    List<AyushSystem> available = const <AyushSystem>[AyushSystem.ayurveda],
    AyushSystem? selected,
    ValueChanged<AyushSystem>? onSelect,
    VoidCallback? onNotSure,
  }) {
    return tester.pumpWidget(
      host(
        AyushSelectionScreen(
          strings: strings,
          available: available,
          selected: selected,
          onSelect: onSelect ?? (_) {},
          onNotSure: onNotSure ?? () {},
          onContinue: () {},
          onExit: () {},
        ),
      ),
    );
  }

  testWidgets('shows only the systems it was given', (WidgetTester tester) async {
    await pump(tester, available: <AyushSystem>[AyushSystem.ayurveda, AyushSystem.siddha]);

    expect(find.text('Ayurveda'), findsOneWidget);
    expect(find.text('Siddha'), findsOneWidget);
    // A system with no approved module must not appear at all — a patient choosing one
    // and then being asked nothing specific to it looks like the module failed.
    expect(find.text('Unani'), findsNothing);
    expect(find.text('Homoeopathy'), findsNothing);
  });

  testWidgets('offers "I am not sure" even when nothing is available', (
    WidgetTester tester,
  ) async {
    await pump(tester, available: const <AyushSystem>[]);
    expect(find.text('I am not sure'), findsOneWidget);
  });

  testWidgets('gives "I am not sure" the same weight as a system', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    final Size system = tester.getSize(
      find.ancestor(of: find.text('Ayurveda'), matching: find.byType(MkButton)),
    );
    final Size unsure = tester.getSize(
      find.ancestor(of: find.text('I am not sure'), matching: find.byType(MkButton)),
    );

    // Not knowing which system of medicine you want is the normal case.
    expect(unsure.height, system.height);
    expect(unsure.width, system.width);
  });

  testWidgets('says that not knowing is fine', (WidgetTester tester) async {
    await pump(tester);
    expect(find.textContaining('the doctor will decide with you'), findsOneWidget);
  });

  testWidgets('keeps Continue inert until a system is chosen', (WidgetTester tester) async {
    await pump(tester);
    final MkButton button = tester.widget<MkButton>(
      find.ancestor(of: find.text('Continue'), matching: find.byType(MkButton)),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('reports the chosen system', (WidgetTester tester) async {
    final List<AyushSystem> chosen = <AyushSystem>[];
    await pump(tester, onSelect: chosen.add);
    await tester.tap(find.text('Ayurveda'));
    await tester.pumpAndSettle();
    expect(chosen, <AyushSystem>[AyushSystem.ayurveda]);
  });

  testWidgets('reports "not sure" distinctly from a system', (WidgetTester tester) async {
    int unsure = 0;
    await pump(tester, onNotSure: () => unsure += 1);
    await tester.tap(find.text('I am not sure'));
    await tester.pumpAndSettle();
    expect(unsure, 1);
  });

  group('wire values', () {
    test('cover every system the specification names', () {
      expect(AyushSystem.values.map((AyushSystem s) => s.wire).toList(), <String>[
        'AYURVEDA',
        'UNANI',
        'SIDDHA',
        'YOGA_NATUROPATHY',
        'SOWA_RIGPA',
        'HOMOEOPATHY',
      ]);
    });

    test('parse back from the server representation', () {
      expect(AyushSystem.fromWire('SOWA_RIGPA'), AyushSystem.sowaRigpa);
      expect(AyushSystem.fromWire('NOT_A_SYSTEM'), isNull);
    });
  });
}
