import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/config/question.dart';
import 'package:medikiosk_kiosk/platform/speech_recognition.dart';
import 'package:medikiosk_kiosk/screens/question_screen.dart';

import 'support/widget_host.dart';

/// Voice input, and the gate between a transcript and a clinical record.
///
/// The gate is the whole feature. A transcript is a machine's guess, and in an intake the
/// errors that matter are small — "no pain" for "know pain", a dose, a drug name. A guess
/// written silently into a field the doctor later reads as the patient's own words is the
/// failure these tests exist to prevent.
void main() {
  const Question freeText = Question(
    id: 'anythingElse',
    type: 'TEXT',
    prompt: 'Is there anything else you want the doctor to know?',
    nonCommittal: <NonCommittal>[],
    options: <QuestionOption>[],
  );

  Future<void> pump(
    WidgetTester tester, {
    bool voiceAvailable = true,
    bool listening = false,
    String? pendingTranscript,
    String? textValue,
    VoidCallback? onStartListening,
    VoidCallback? onAcceptTranscript,
    VoidCallback? onRejectTranscript,
    Question question = freeText,
  }) {
    return tester.pumpWidget(
      host(
        QuestionScreen(
          strings: KioskStrings.of('en'),
          question: question,
          selectedOptionIds: const <String>{},
          answeredCount: 0,
          totalApplicable: 1,
          textValue: textValue,
          onToggleOption: (_) {},
          onNonCommittal: (_) {},
          onContinue: () {},
          onExit: () {},
          onTextChanged: (_) {},
          voiceAvailable: voiceAvailable,
          listening: listening,
          pendingTranscript: pendingTranscript,
          onStartListening: onStartListening ?? () {},
          onStopListening: () {},
          onAcceptTranscript: onAcceptTranscript ?? () {},
          onRejectTranscript: onRejectTranscript ?? () {},
        ),
      ),
    );
  }

  group('the speak control', () {
    testWidgets('is offered when the kiosk can recognise this language',
        (WidgetTester tester) async {
      await pump(tester);
      expect(find.text('Speak your answer'), findsOneWidget);
    });

    testWidgets('is hidden entirely when it cannot', (WidgetTester tester) async {
      // Hidden, not disabled. A control that is visible and refuses is worse than absent:
      // a patient who cannot read is exactly the person who will keep pressing it.
      await pump(tester, voiceAvailable: false);
      expect(find.text('Speak your answer'), findsNothing);
    });

    testWidgets('says it is listening while it is', (WidgetTester tester) async {
      await pump(tester, listening: true);
      expect(find.text('Listening…'), findsOneWidget);
    });
  });

  group('the confirmation gate', () {
    testWidgets('shows the patient what was heard before anything is kept',
        (WidgetTester tester) async {
      await pump(tester, pendingTranscript: 'my knee has hurt for three weeks');

      expect(find.text('We heard you say:'), findsOneWidget);
      expect(find.text('my knee has hurt for three weeks'), findsOneWidget);
      expect(find.textContaining('check the words are right'), findsOneWidget);
    });

    testWidgets('does not put the transcript in the answer field', (WidgetTester tester) async {
      // The field is still empty. Until the patient accepts, the transcript is a proposal.
      await pump(tester, pendingTranscript: 'know pain at all');

      final TextField field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller?.text, '');
    });

    testWidgets('offers both accepting and saying it again', (WidgetTester tester) async {
      await pump(tester, pendingTranscript: 'something');
      expect(find.text('Yes, use this'), findsOneWidget);
      expect(find.text('Say it again'), findsOneWidget);
    });

    testWidgets('accepting is what commits it', (WidgetTester tester) async {
      var accepted = 0;
      await pump(
        tester,
        pendingTranscript: 'something',
        onAcceptTranscript: () => accepted += 1,
      );

      final Finder accept = find.text('Yes, use this');
      await tester.ensureVisible(accept);
      await tester.pumpAndSettle();
      await tester.tap(accept);
      await tester.pumpAndSettle();
      expect(accepted, 1);
    });

    testWidgets('shows nothing when there is no transcript', (WidgetTester tester) async {
      await pump(tester);
      expect(find.text('We heard you say:'), findsNothing);
    });
  });

  group('the recogniser contract', () {
    test('an unavailable result is not a transcript', () {
      const TranscriptResult result =
          TranscriptResult.unavailable(SpeechUnavailableReason.wouldLeaveDevice);
      expect(result.heard, isFalse);
      expect(result.transcript, isNull);
    });

    test('silence is not a transcript either', () {
      // A patient who said nothing must not produce an empty answer that looks deliberate.
      const TranscriptResult result = TranscriptResult.heard('   ');
      expect(result.heard, isFalse);
    });

    test('distinguishes the reasons, because the remedies differ', () {
      // A missing language pack is the hospital's IT; a denied microphone is the device's
      // settings; wouldLeaveDevice means the only recogniser available would upload the
      // patient's voice, and is refused.
      expect(SpeechUnavailableReason.values, hasLength(4));
      expect(
        SpeechUnavailableReason.values,
        containsAll(<SpeechUnavailableReason>[
          SpeechUnavailableReason.notSupported,
          SpeechUnavailableReason.permissionDenied,
          SpeechUnavailableReason.languageUnavailable,
          SpeechUnavailableReason.wouldLeaveDevice,
        ]),
      );
    });

    test('the unavailable implementation never pretends to hear', () async {
      final UnavailableSpeechRecognition speech = UnavailableSpeechRecognition();
      final TranscriptResult result = await speech.listen(languageTag: 'ta');
      expect(result.heard, isFalse);
      expect(result.unavailable, SpeechUnavailableReason.notSupported);
      expect(await speech.isLanguageAvailable('ta'), isFalse);
    });
  });
}
