import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/config/question.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/question_screen.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

const List<NonCommittal> _allThree = <NonCommittal>[
  NonCommittal.notSure,
  NonCommittal.preferToDiscuss,
  NonCommittal.notApplicable,
];

Question select({bool sensitive = false}) => Question(
      id: 'chiefComplaint',
      type: 'SINGLE_SELECT',
      prompt: 'What brings you here today?',
      options: const <QuestionOption>[
        QuestionOption(id: 'pain', label: 'Pain'),
        QuestionOption(id: 'fever', label: 'Fever'),
      ],
      sensitive: sensitive,
      sensitiveExplanation: sensitive ? 'This may help the doctor.' : null,
      nonCommittal: _allThree,
    );

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  Future<void> pump(
    WidgetTester tester, {
    Question? question,
    Set<String> selected = const <String>{},
    ValueChanged<String>? onToggle,
    ValueChanged<NonCommittal>? onNonCommittal,
    VoidCallback? onContinue,
    int? scaleValue,
  }) {
    return tester.pumpWidget(
      host(
        QuestionScreen(
          strings: strings,
          question: question ?? select(),
          selectedOptionIds: selected,
          answeredCount: 3,
          totalApplicable: 10,
          scaleValue: scaleValue,
          onToggleOption: onToggle ?? (_) {},
          onNonCommittal: onNonCommittal ?? (_) {},
          onContinue: onContinue ?? () {},
          onExit: () {},
          onScaleChanged: (_) {},
        ),
      ),
    );
  }

  testWidgets('shows the published prompt and options verbatim', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('What brings you here today?'), findsOneWidget);
    expect(find.text('Pain'), findsOneWidget);
    expect(find.text('Fever'), findsOneWidget);
  });

  testWidgets('offers every way to decline, in the same list', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('I am not sure'), findsOneWidget);
    expect(find.text('I prefer to tell the doctor'), findsOneWidget);
    expect(find.text('This does not apply to me'), findsOneWidget);
  });

  testWidgets('gives declining the same weight as answering', (WidgetTester tester) async {
    await pump(tester);
    final Size answer = tester.getSize(
      find.ancestor(of: find.text('Pain'), matching: find.byType(MkButton)),
    );
    final Size decline = tester.getSize(
      find.ancestor(of: find.text('I am not sure'), matching: find.byType(MkButton)),
    );

    // A patient who is unsure should not have to work harder than one who is certain.
    expect(decline.height, answer.height);
    expect(decline.width, answer.width);
  });

  testWidgets('keeps Continue inert until something is chosen', (WidgetTester tester) async {
    await pump(tester);
    final MkButton button = tester.widget<MkButton>(
      find.ancestor(of: find.text('Continue'), matching: find.byType(MkButton)),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('enables Continue once an option is chosen', (WidgetTester tester) async {
    int continued = 0;
    await pump(tester, selected: <String>{'pain'}, onContinue: () => continued += 1);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(continued, 1);
  });

  testWidgets('enables Continue on a non-committal answer too', (WidgetTester tester) async {
    // Declining is a complete answer, not a failure to answer.
    await pump(tester, selected: <String>{'NOT_SURE'});
    final MkButton button = tester.widget<MkButton>(
      find.ancestor(of: find.text('Continue'), matching: find.byType(MkButton)),
    );
    expect(button.onPressed, isNotNull);
  });

  testWidgets('reports the chosen option', (WidgetTester tester) async {
    final List<String> toggled = <String>[];
    await pump(tester, onToggle: toggled.add);
    await tester.tap(find.text('Pain'));
    await tester.pumpAndSettle();
    expect(toggled, <String>['pain']);
  });

  testWidgets('reports a non-committal choice distinctly', (WidgetTester tester) async {
    final List<NonCommittal> chosen = <NonCommittal>[];
    await pump(tester, onNonCommittal: chosen.add);
    // Below the fold on the 800x600 test surface; the substantive options scroll too, so
    // this is equal treatment rather than a buried control.
    await tester.ensureVisible(find.text('I prefer to tell the doctor'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('I prefer to tell the doctor'));
    await tester.pumpAndSettle();
    expect(chosen, <NonCommittal>[NonCommittal.preferToDiscuss]);
  });

  testWidgets('keeps every way to decline reachable on a short screen', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 500);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await pump(tester);
    expect(tester.takeException(), isNull);
    for (final String label in <String>[
      'I am not sure',
      'I prefer to tell the doctor',
      'This does not apply to me',
    ]) {
      await tester.ensureVisible(find.text(label));
      await tester.pumpAndSettle();
      expect(find.text(label), findsOneWidget);
    }
  });

  testWidgets('shows progress against applicable questions', (WidgetTester tester) async {
    await pump(tester);
    final LinearProgressIndicator bar =
        tester.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator));
    expect(bar.value, closeTo(0.3, 0.001));
  });

  testWidgets('renders a numeric scale as discrete buttons, not a slider', (
    WidgetTester tester,
  ) async {
    await pump(
      tester,
      question: const Question(
        id: 'severity',
        type: 'NUMERIC_SCALE',
        prompt: 'How severe is it?',
        scale: NumericScale(min: 0, max: 10, minLabel: 'None', maxLabel: 'Worst'),
        nonCommittal: _allThree,
      ),
      scaleValue: 4,
    );

    // A slider needs fine motor control and shows no value at a glance.
    expect(find.byType(Slider), findsNothing);
    expect(find.text('0'), findsOneWidget);
    expect(find.text('10'), findsOneWidget);
    expect(find.text('None'), findsOneWidget);
  });

  group('sensitive questions', () {
    testWidgets('explains why before the question is shown', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          SensitiveQuestionIntro(
            strings: strings,
            explanation: 'This information may help the doctor understand your health.',
            onAnswer: () {},
            onDiscussWithDoctor: () {},
            onExit: () {},
          ),
        ),
      );

      expect(find.text('Why are we asking?'), findsOneWidget);
      expect(find.textContaining('may help the doctor'), findsOneWidget);
      // The question itself is not on screen yet.
      expect(find.text('Continue'), findsNothing);
    });

    testWidgets('lets the patient decline without ever seeing the question', (
      WidgetTester tester,
    ) async {
      int declined = 0;
      await tester.pumpWidget(
        host(
          SensitiveQuestionIntro(
            strings: strings,
            explanation: 'Explanation.',
            onAnswer: () {},
            onDiscussWithDoctor: () => declined += 1,
            onExit: () {},
          ),
        ),
      );

      await tester.tap(find.text('I prefer to tell the doctor'));
      await tester.pumpAndSettle();
      expect(declined, 1);
    });

    testWidgets('weights answering and declining equally', (WidgetTester tester) async {
      await tester.pumpWidget(
        host(
          SensitiveQuestionIntro(
            strings: strings,
            explanation: 'Explanation.',
            onAnswer: () {},
            onDiscussWithDoctor: () {},
            onExit: () {},
          ),
        ),
      );

      final Size answer = tester.getSize(
        find.ancestor(of: find.text('Answer this question'), matching: find.byType(MkButton)),
      );
      final Size decline = tester.getSize(
        find.ancestor(
          of: find.text('I prefer to tell the doctor'),
          matching: find.byType(MkButton),
        ),
      );
      expect(decline.height, answer.height);
    });
  });

  group('parsing', () {
    test('reads a published question', () {
      final Question parsed = Question.fromJson(<String, dynamic>{
        'id': 'smoking',
        'type': 'SINGLE_SELECT',
        'prompt': 'Do you use tobacco?',
        'options': <dynamic>[
          <String, dynamic>{'id': 'never', 'label': 'Never'},
        ],
        'sensitive': true,
        'sensitiveExplanation': 'Because it matters.',
        'nonCommittal': <dynamic>['NOT_SURE', 'PREFER_TO_DISCUSS_WITH_DOCTOR'],
      });

      expect(parsed.sensitive, isTrue);
      expect(parsed.nonCommittal, <NonCommittal>[
        NonCommittal.notSure,
        NonCommittal.preferToDiscuss,
      ]);
    });

    test('ignores a non-committal value it does not recognise', () {
      // Forward compatibility: a newer questionnaire must not crash an older kiosk.
      final Question parsed = Question.fromJson(<String, dynamic>{
        'id': 'x',
        'type': 'TEXT',
        'prompt': 'X',
        'nonCommittal': <dynamic>['NOT_SURE', 'SOMETHING_NEW'],
      });
      expect(parsed.nonCommittal, <NonCommittal>[NonCommittal.notSure]);
    });
  });
}
