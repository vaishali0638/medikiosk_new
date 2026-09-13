import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// One answer as the patient sees it back.
@immutable
class ReviewItem {
  const ReviewItem({
    required this.questionId,
    required this.prompt,
    required this.answered,
    required this.display,
    required this.provenance,
  });

  final String questionId;
  final String prompt;
  final bool answered;

  /// What the patient said, in their own language. Null when unanswered.
  final String? display;

  /// The provenance label, or null for an unanswered question — a non-answer has no
  /// source, and labelling one "patient-reported" attributes something they never said.
  final String? provenance;
}

/// A document attached to the visit, as the review screen lists it.
@immutable
class ReviewDocument {
  const ReviewDocument({required this.label, required this.awaitingReview});

  final String label;
  final bool awaitingReview;
}

/// "Your information for the doctor" — the last screen before submission.
///
/// It shows the patient their own answers and nothing else. No narrative, no draft, no
/// extracted text: those are produced after submission and are for a clinician, who is in
/// a position to judge them. Asking a patient to approve a generated summary would be
/// asking them to vouch for something they cannot check.
///
/// Every row is editable. The specification's Edit button is not decorative — a patient
/// who spots a wrong answer and cannot fix it either submits something they know is wrong
/// or walks away.
class ReviewScreen extends StatelessWidget {
  const ReviewScreen({
    required this.strings,
    required this.items,
    required this.documents,
    required this.onEdit,
    required this.onSubmit,
    required this.onExit,
    this.submitting = false,
    super.key,
  });

  final KioskStrings strings;
  final List<ReviewItem> items;
  final List<ReviewDocument> documents;

  /// Reopens one question. The patient returns here afterwards.
  final ValueChanged<String> onEdit;

  /// "I reviewed and want to submit". The only route to submission.
  final VoidCallback onSubmit;
  final VoidCallback onExit;
  final bool submitting;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['review.title'],
      subtitle: strings['review.subtitle'],
      primaryAction: MkButton(
        label: strings['review.submit'],
        emphasis: MkButtonEmphasis.primary,
        // Disabled only while a submission is in flight, so a double tap cannot send
        // twice. The server is idempotent regardless; this is about the patient not
        // seeing two things happen.
        onPressed: submitting ? null : onSubmit,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            strings['review.sentTo'],
            style: MkType.body.toTextStyle(
              color: MkColors.neutralText,
              scale: a11y.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.lg),

          for (final ReviewItem item in items)
            _ReviewRow(
              strings: strings,
              item: item,
              onEdit: () => onEdit(item.questionId),
            ),

          if (documents.isNotEmpty) ...<Widget>[
            const SizedBox(height: MkSpacing.lg),
            Text(
              strings['review.documents'],
              style: MkType.action.toTextStyle(
                color: MkColors.darkBlue,
                scale: a11y.textScale,
              ),
            ),
            const SizedBox(height: MkSpacing.sm),
            for (final ReviewDocument document in documents)
              Padding(
                padding: const EdgeInsets.only(bottom: MkSpacing.xs),
                child: Text(
                  '${document.label} — ${document.awaitingReview ? strings['documents.readyForDoctor'] : strings['documents.saved']}',
                  style: MkType.caption.toTextStyle(
                    color: MkColors.mutedText,
                    scale: a11y.textScale,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({required this.strings, required this.item, required this.onEdit});

  final KioskStrings strings;
  final ReviewItem item;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: MkSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            item.prompt,
            style: MkType.caption.toTextStyle(
              color: MkColors.mutedText,
              scale: a11y.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.xs),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  item.answered
                      ? (item.display ?? strings['review.noAnswer'])
                      : strings['review.noAnswer'],
                  style: MkType.body.toTextStyle(
                    color: item.answered ? MkColors.neutralText : MkColors.mutedText,
                    scale: a11y.textScale,
                  ),
                ),
              ),
              const SizedBox(width: MkSpacing.sm),
              MkButton(
                label: strings['review.edit'],
                emphasis: MkButtonEmphasis.quiet,
                onPressed: onEdit,
                semanticLabel: '${strings['review.edit']}: ${item.prompt}',
              ),
            ],
          ),
          if (item.provenance != null) ...<Widget>[
            const SizedBox(height: MkSpacing.xs),
            // The label the doctor will see against this answer, shown to the patient too.
            // They should know that "you said this" is exactly how it will be presented.
            Text(
              '${strings['review.label']}: ${item.provenance}',
              style: MkType.caption.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
