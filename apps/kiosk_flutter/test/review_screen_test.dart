import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/review_screen.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  ReviewItem item({
    String questionId = 'q.reason',
    String prompt = 'What brings you here today?',
    bool answered = true,
    String? display = 'knee pain for two months',
    String? provenance = 'PATIENT-REPORTED',
  }) {
    return ReviewItem(
      questionId: questionId,
      prompt: prompt,
      answered: answered,
      display: display,
      provenance: provenance,
    );
  }

  Future<void> pump(
    WidgetTester tester, {
    List<ReviewItem>? items,
    List<ReviewDocument> documents = const <ReviewDocument>[],
    ValueChanged<String>? onEdit,
    VoidCallback? onSubmit,
    bool submitting = false,
  }) {
    return tester.pumpWidget(
      host(
        ReviewScreen(
          strings: strings,
          items: items ?? <ReviewItem>[item()],
          documents: documents,
          onEdit: onEdit ?? (_) {},
          onSubmit: onSubmit ?? () {},
          onExit: () {},
          submitting: submitting,
        ),
      ),
    );
  }

  testWidgets('says who the information goes to', (WidgetTester tester) async {
    await pump(tester);

    expect(find.text('Review before submission'), findsOneWidget);
    expect(
      find.text('This information will be sent to authorised hospital staff.'),
      findsOneWidget,
    );
  });

  testWidgets('submission is the single primary action', (WidgetTester tester) async {
    bool submitted = false;
    await pump(tester, onSubmit: () => submitted = true);

    final MkButton button = tester.widget<MkButton>(
      find.widgetWithText(MkButton, 'I reviewed and want to submit'),
    );
    expect(button.emphasis, MkButtonEmphasis.primary);

    await tester.tap(find.text('I reviewed and want to submit'));
    expect(submitted, isTrue);
  });

  testWidgets('every answer can be reopened', (WidgetTester tester) async {
    String? edited;
    await pump(
      tester,
      items: <ReviewItem>[
        item(questionId: 'q.reason'),
        item(questionId: 'q.duration', prompt: 'How long?', display: '1–6 months'),
      ],
      onEdit: (String id) => edited = id,
    );

    // A patient who spots a wrong answer and cannot fix it submits something they know is
    // wrong, or walks away.
    expect(find.widgetWithText(MkButton, 'Edit'), findsNWidgets(2));
    // The list scrolls — a real review screen has twenty questions on it — so the row has
    // to be brought into view the way a patient would bring it into view.
    await tester.ensureVisible(find.widgetWithText(MkButton, 'Edit').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(MkButton, 'Edit').last);
    expect(edited, 'q.duration');
  });

  testWidgets('shows the patient the label the doctor will see', (WidgetTester tester) async {
    await pump(tester);

    expect(find.textContaining('PATIENT-REPORTED'), findsOneWidget);
  });

  testWidgets('gives an unanswered question no label at all', (WidgetTester tester) async {
    await pump(
      tester,
      items: <ReviewItem>[
        item(prompt: 'Do you have any allergy?', answered: false, display: null, provenance: null),
      ],
    );

    expect(find.text('Not answered'), findsOneWidget);
    // Labelling a question they never answered "patient-reported" attributes something to
    // them that they did not say.
    expect(find.textContaining('Label:'), findsNothing);
  });

  testWidgets('shows no draft, no narrative and no diagnosis', (WidgetTester tester) async {
    await pump(tester);

    // Asking a patient to approve a generated summary asks them to vouch for something
    // they are not in a position to check.
    expect(find.textContaining('DRAFT'), findsNothing);
    expect(find.textContaining('draft'), findsNothing);
    expect(find.textContaining('Diagnosis'), findsNothing);
    expect(find.textContaining('AI'), findsNothing);
  });

  testWidgets('lists attached documents without their contents', (WidgetTester tester) async {
    await pump(
      tester,
      documents: <ReviewDocument>[
        const ReviewDocument(label: 'Lab report', awaitingReview: true),
      ],
    );

    expect(find.textContaining('Lab report'), findsOneWidget);
    expect(find.textContaining('saved, for the doctor to check'), findsOneWidget);
  });

  testWidgets('cannot be submitted twice while a submission is in flight', (
    WidgetTester tester,
  ) async {
    await pump(tester, submitting: true);

    final MkButton button = tester.widget<MkButton>(
      find.widgetWithText(MkButton, 'I reviewed and want to submit'),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('exit is reachable from the review screen', (WidgetTester tester) async {
    await pump(tester);
    expect(find.text('Exit'), findsOneWidget);
  });
}
