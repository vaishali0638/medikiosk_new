import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/config/consent_notice.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/consent_screen.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

const ConsentNotice _notice = ConsentNotice(
  version: 'v1.0',
  language: 'en',
  title: 'Privacy and consent',
  collectedItems: <String>[
    'Basic patient details',
    'Health information you tell us',
    'Documents you choose to upload',
  ],
  purpose: 'OPD clinical intake and consultation at this hospital',
  fullText: 'The complete notice text, which is long and scrollable.',
  audioAvailable: false,
  approvedBy: <String>['Dr A Reviewer'],
);

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  Future<void> pump(
    WidgetTester tester, {
    VoidCallback? onAgree,
    VoidCallback? onDecline,
    VoidCallback? onListen,
    VoidCallback? onReadFullNotice,
    VoidCallback? onExit,
    bool speaking = false,
    bool audioUnavailable = false,
    AccessibilitySettings settings = const AccessibilitySettings(),
  }) {
    return tester.pumpWidget(
      host(
        ConsentScreen(
          strings: strings,
          notice: _notice,
          speaking: speaking,
          audioUnavailable: audioUnavailable,
          onListen: onListen ?? () {},
          onReadFullNotice: onReadFullNotice ?? () {},
          onAgree: onAgree ?? () {},
          onDecline: onDecline ?? () {},
          onExit: onExit ?? () {},
        ),
        settings: settings,
      ),
    );
  }

  testWidgets('shows the governed title, items and purpose verbatim', (
    WidgetTester tester,
  ) async {
    await pump(tester);

    expect(find.text('Privacy and consent'), findsOneWidget);
    for (final String item in _notice.collectedItems) {
      expect(find.text(item), findsOneWidget);
    }
    expect(find.text(_notice.purpose), findsOneWidget);
  });

  testWidgets('offers all four specified actions', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('Listen to explanation'), findsOneWidget);
    expect(find.text('Read full notice'), findsOneWidget);
    expect(find.text('Agree and Continue'), findsOneWidget);
    expect(find.text('Do not agree'), findsOneWidget);
    expect(find.text('Exit'), findsOneWidget);
  });

  testWidgets('gives agree and decline the same size, so decline is not discouraged', (
    WidgetTester tester,
  ) async {
    await pump(tester);

    final Size agree = tester.getSize(
      find.ancestor(of: find.text('Agree and Continue'), matching: find.byType(MkButton)),
    );
    final Size decline = tester.getSize(
      find.ancestor(of: find.text('Do not agree'), matching: find.byType(MkButton)),
    );

    // Consent that has been nudged is not freely given.
    expect(decline.height, agree.height);
    expect(decline.width, agree.width);
  });

  testWidgets('shows the notice version, so the artefact can be traced', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    expect(find.textContaining('v1.0'), findsOneWidget);
  });

  testWidgets('reports agreement', (WidgetTester tester) async {
    int agreed = 0;
    await pump(tester, onAgree: () => agreed += 1);
    await tester.tap(find.text('Agree and Continue'));
    await tester.pumpAndSettle();
    expect(agreed, 1);
  });

  testWidgets('reports a decline', (WidgetTester tester) async {
    int declined = 0;
    await pump(tester, onDecline: () => declined += 1);
    await tester.tap(find.text('Do not agree'));
    await tester.pumpAndSettle();
    expect(declined, 1);
  });

  testWidgets('offers to stop while speaking', (WidgetTester tester) async {
    await pump(tester, speaking: true);
    expect(find.text('Stop'), findsOneWidget);
    expect(find.text('Listen to explanation'), findsNothing);
  });

  testWidgets('says so plainly when audio is unavailable', (WidgetTester tester) async {
    await pump(tester, audioUnavailable: true);
    // A patient relying on audio must not be left waiting on a silent button.
    expect(find.text('Spoken guidance is not available in this language.'), findsOneWidget);
  });

  testWidgets('does not claim audio is unavailable before it has been tried', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    expect(find.text('Spoken guidance is not available in this language.'), findsNothing);
  });

  testWidgets('scales with large text', (WidgetTester tester) async {
    await pump(tester);
    final double normal = tester.widget<Text>(find.text(_notice.purpose)).style!.fontSize!;

    await pump(tester, settings: const AccessibilitySettings(largeText: true));
    final double large = tester.widget<Text>(find.text(_notice.purpose)).style!.fontSize!;

    expect(large, greaterThan(normal));
  });

  testWidgets('marks the title as a header', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pump(tester);
    expect(
      tester.getSemantics(find.text('Privacy and consent')).hasFlag(SemanticsFlag.isHeader),
      isTrue,
    );
    handle.dispose();
  });

  group('full notice', () {
    testWidgets('shows the complete text and who approved it', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          ConsentFullNoticeScreen(
            strings: strings,
            notice: _notice,
            onBack: () {},
            onExit: () {},
          ),
        ),
      );

      expect(find.textContaining('The complete notice text'), findsOneWidget);
      expect(find.textContaining('Dr A Reviewer'), findsOneWidget);
      expect(find.textContaining('v1.0'), findsOneWidget);
    });

    testWidgets('returns to the consent screen', (WidgetTester tester) async {
      int backs = 0;
      await tester.pumpWidget(
        host(
          ConsentFullNoticeScreen(
            strings: strings,
            notice: _notice,
            onBack: () => backs += 1,
            onExit: () {},
          ),
        ),
      );
      await tester.tap(find.text('Back'));
      await tester.pumpAndSettle();
      expect(backs, 1);
    });
  });

  group('declined', () {
    testWidgets('states that intake will not continue', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(ConsentDeclinedScreen(strings: strings, onExit: () {})),
      );

      expect(find.textContaining('not to provide digital consent'), findsOneWidget);
      expect(find.textContaining('will not continue'), findsOneWidget);
    });

    testWidgets('offers Exit and nothing else', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(ConsentDeclinedScreen(strings: strings, onExit: () {})),
      );

      // No second chance to agree: re-asking someone who has just said no is pressure.
      expect(find.byType(MkButton), findsOneWidget);
      expect(find.text('Exit'), findsOneWidget);
      expect(find.text('Agree and Continue'), findsNothing);
    });

    testWidgets('tells the patient they can still be seen at the counter', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        host(ConsentDeclinedScreen(strings: strings, onExit: () {})),
      );
      // Declining consent must not read as being refused care.
      expect(find.textContaining('counter'), findsOneWidget);
    });
  });
}
