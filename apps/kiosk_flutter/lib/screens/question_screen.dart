import 'package:flutter/material.dart';

import '../config/question.dart';
import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// Renders one question.
///
/// Two rules shape this screen:
///
/// 1. **Declining is as easy as answering.** The non-committal options are the same size
///    and in the same list as the substantive ones, not tucked below a divider. A patient
///    who is unsure should not have to work harder than one who is certain.
///
/// 2. **The question is always visible.** It sits above the scroll, so a long option list
///    can never leave someone reading answers to a question they can no longer see.
class QuestionScreen extends StatelessWidget {
  const QuestionScreen({
    required this.strings,
    required this.question,
    required this.selectedOptionIds,
    required this.answeredCount,
    required this.totalApplicable,
    required this.onToggleOption,
    required this.onNonCommittal,
    required this.onContinue,
    required this.onExit,
    this.textValue,
    this.onTextChanged,
    this.scaleValue,
    this.onScaleChanged,
    this.busy = false,
    this.voiceAvailable = false,
    this.listening = false,
    this.pendingTranscript,
    this.matchedOptionLabel,
    this.voiceUnavailableMessage,
    this.onStartListening,
    this.onStopListening,
    this.onAcceptTranscript,
    this.onRejectTranscript,
    super.key,
  });

  final KioskStrings strings;
  final Question question;
  final Set<String> selectedOptionIds;
  final int answeredCount;
  final int totalApplicable;
  final ValueChanged<String> onToggleOption;
  final ValueChanged<NonCommittal> onNonCommittal;
  final VoidCallback onContinue;
  final VoidCallback onExit;
  final String? textValue;
  final ValueChanged<String>? onTextChanged;
  final int? scaleValue;
  final ValueChanged<int>? onScaleChanged;
  final bool busy;

  /// Whether this kiosk can recognise the patient's language ON DEVICE. False hides the
  /// control entirely rather than offering something that will fail when pressed.
  final bool voiceAvailable;
  final bool listening;

  /// What the recogniser heard, awaiting the patient's confirmation.
  ///
  /// Held separately from [textValue] on purpose: a transcript is a machine's guess, and
  /// until the patient has read it and said yes it is not their answer. Writing it
  /// straight into the field would make it one, silently, and "no pain" and "know pain"
  /// are one mishearing apart.
  final String? pendingTranscript;
  /// The option the transcript was matched to, when the question has options and the
  /// match was unambiguous. Null means the patient is told to choose on screen instead.
  final String? matchedOptionLabel;
  final String? voiceUnavailableMessage;
  final VoidCallback? onStartListening;
  final VoidCallback? onStopListening;
  final VoidCallback? onAcceptTranscript;
  final VoidCallback? onRejectTranscript;

  bool get _hasAnswer =>
      selectedOptionIds.isNotEmpty ||
      (question.isText && (textValue?.trim().isNotEmpty ?? false)) ||
      (question.isScale && scaleValue != null);

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: question.prompt,
      subtitle: question.help,
      primaryAction: MkButton(
        label: strings['common.continue'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: _hasAnswer && !busy ? onContinue : null,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (totalApplicable > 0) ...<Widget>[
            Semantics(
              label: '${strings['question.progress']} $answeredCount / $totalApplicable',
              child: LinearProgressIndicator(
                value: totalApplicable == 0 ? 0 : answeredCount / totalApplicable,
                backgroundColor: MkColors.border,
                color: MkColors.primaryBlue,
                minHeight: 8,
              ),
            ),
            const SizedBox(height: MkSpacing.lg),
          ],

          if (voiceAvailable) ...<Widget>[
            MkButton(
              label: listening ? strings['question.listening'] : strings['question.speak'],
              icon: listening ? Icons.stop_circle_outlined : Icons.mic,
              selected: listening,
              onPressed: busy
                  ? null
                  : (listening ? onStopListening : onStartListening),
            ),
            const SizedBox(height: MkSpacing.md),
          ],

          // The confirmation gate. Nothing the recogniser produced reaches the answer
          // until the patient has read it back and accepted it.
          if (pendingTranscript != null) ...<Widget>[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(MkSpacing.md),
              decoration: BoxDecoration(
                color: MkColors.lightOrange,
                borderRadius: BorderRadius.circular(MkRadius.sm),
                border: Border.all(color: MkColors.actionOrange),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    strings['question.heardYouSay'],
                    style: MkType.body.toTextStyle(
                      color: MkColors.neutralText,
                      scale: a11y.textScale,
                    ),
                  ),
                  const SizedBox(height: MkSpacing.sm),
                  Text(
                    pendingTranscript!,
                    style: MkType.heading.toTextStyle(
                      color: MkColors.neutralText,
                      scale: a11y.textScale,
                    ),
                  ),
                  const SizedBox(height: MkSpacing.sm),
                  if (matchedOptionLabel != null) ...<Widget>[
                    const SizedBox(height: MkSpacing.sm),
                    // What the words will DO, not just what they were. On an option
                    // question the consequence of confirming is a selection, and the
                    // patient has to see which one before they agree to it.
                    Text(
                      '→ ${matchedOptionLabel!}',
                      style: MkType.body.toTextStyle(
                        color: MkColors.darkBlue,
                        scale: a11y.textScale,
                      ),
                    ),
                  ],
                  const SizedBox(height: MkSpacing.sm),
                  Text(
                    matchedOptionLabel == null && !question.isText
                        ? strings['question.couldNotMatch']
                        : strings['question.checkTheWords'],
                    style: MkType.caption.toTextStyle(
                      color: MkColors.mutedText,
                      scale: a11y.textScale,
                    ),
                  ),
                  const SizedBox(height: MkSpacing.md),
                  Row(
                    children: <Widget>[
                      if (question.isText || matchedOptionLabel != null) ...<Widget>[
                        Expanded(
                          child: MkButton(
                            label: strings['question.useThisText'],
                            emphasis: MkButtonEmphasis.primary,
                            onPressed: busy ? null : onAcceptTranscript,
                          ),
                        ),
                        const SizedBox(width: MkSpacing.md),
                      ],
                      Expanded(
                        child: MkButton(
                          label: strings['question.speakAgain'],
                          onPressed: busy ? null : onRejectTranscript,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: MkSpacing.md),
          ],

          if (voiceUnavailableMessage != null) ...<Widget>[
            Text(
              voiceUnavailableMessage!,
              style: MkType.caption.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
            const SizedBox(height: MkSpacing.md),
          ],

          if (question.isText)
            TextField(
              maxLength: question.maxLength ?? 600,
              maxLines: 4,
              enabled: !busy,
              onChanged: onTextChanged,
              controller: TextEditingController.fromValue(
                TextEditingValue(
                  text: textValue ?? '',
                  selection: TextSelection.collapsed(offset: (textValue ?? '').length),
                ),
              ),
              style: MkType.body.toTextStyle(
                color: MkColors.neutralText,
                scale: a11y.textScale,
              ),
              decoration: InputDecoration(
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(MkRadius.sm)),
                contentPadding: const EdgeInsets.all(MkSpacing.md),
              ),
            )
          else if (question.isScale && question.scale != null)
            _ScaleInput(
              scale: question.scale!,
              value: scaleValue,
              onChanged: busy ? null : onScaleChanged,
            )
          else
            for (final QuestionOption option in question.options) ...<Widget>[
              MkButton(
                label: option.label,
                selected: selectedOptionIds.contains(option.id),
                onPressed: busy ? null : () => onToggleOption(option.id),
              ),
              const SizedBox(height: MkSpacing.md),
            ],

          const SizedBox(height: MkSpacing.md),

          // Same size, same list. Not tucked below a divider — a patient who is unsure
          // should not have to work harder than one who is certain.
          for (final NonCommittal option in question.nonCommittal) ...<Widget>[
            MkButton(
              label: strings[option.stringKey],
              selected: selectedOptionIds.contains(option.wire),
              onPressed: busy ? null : () => onNonCommittal(option),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
        ],
      ),
    );
  }
}

class _ScaleInput extends StatelessWidget {
  const _ScaleInput({required this.scale, required this.value, required this.onChanged});

  final NumericScale scale;
  final int? value;
  final ValueChanged<int>? onChanged;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Flexible(
              child: Text(
                scale.minLabel,
                style: MkType.caption.toTextStyle(
                  color: MkColors.mutedText,
                  scale: a11y.textScale,
                ),
              ),
            ),
            Flexible(
              child: Text(
                scale.maxLabel,
                textAlign: TextAlign.end,
                style: MkType.caption.toTextStyle(
                  color: MkColors.mutedText,
                  scale: a11y.textScale,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: MkSpacing.md),
        // Discrete buttons rather than a slider: a slider needs fine motor control and
        // gives no feedback about which value is selected at a glance.
        Wrap(
          spacing: MkSpacing.sm,
          runSpacing: MkSpacing.sm,
          children: <Widget>[
            for (int i = scale.min; i <= scale.max; i += 1)
              SizedBox(
                width: 64,
                child: MkButton(
                  label: '$i',
                  selected: value == i,
                  onPressed: onChanged == null ? null : () => onChanged!(i),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// The "why are we asking?" screen shown before a sensitive question.
///
/// The specification names smoking, alcohol, menstruation, family history and mental
/// health. The patient sees the reason first and can decline without ever seeing the
/// question — which is the point: being asked at all is the intrusion.
class SensitiveQuestionIntro extends StatelessWidget {
  const SensitiveQuestionIntro({
    required this.strings,
    required this.explanation,
    required this.onAnswer,
    required this.onDiscussWithDoctor,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;
  final String explanation;
  final VoidCallback onAnswer;
  final VoidCallback onDiscussWithDoctor;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['question.whyAsking'],
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            explanation,
            style: MkType.body.toTextStyle(
              color: MkColors.neutralText,
              scale: a11y.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.xl),
          MkButton(
            label: strings['question.answer'],
            emphasis: MkButtonEmphasis.primary,
            onPressed: onAnswer,
          ),
          const SizedBox(height: MkSpacing.md),
          // Equally weighted with answering: the patient can decline without ever seeing
          // the question, because being asked at all is the intrusion.
          MkButton(
            label: strings['question.preferToDiscuss'],
            onPressed: onDiscussWithDoctor,
          ),
        ],
      ),
    );
  }
}
