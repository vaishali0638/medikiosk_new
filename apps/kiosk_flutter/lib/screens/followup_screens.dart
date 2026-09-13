import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// The eight things a follow-up asks about, from master prompt §19.
enum FollowUpSection {
  symptoms('SYMPTOMS', 'followup.symptoms'),
  newSymptom('NEW_SYMPTOM', 'followup.newSymptom'),
  medicines('MEDICINES', 'followup.medicines'),
  allergy('ALLERGY_OR_SIDE_EFFECT', 'followup.allergy'),
  newReport('NEW_REPORT', 'followup.newReport'),
  newDiagnosis('NEW_DIAGNOSIS_ELSEWHERE', 'followup.newDiagnosis'),
  questions('QUESTIONS_FOR_DOCTOR', 'followup.questions');

  const FollowUpSection(this.wire, this.stringKey);

  final String wire;
  final String stringKey;
}

/// Confirms the visit being followed up, before asking what changed.
///
/// The date and department are shown because a patient cannot report changes "since last
/// time" without being told which time is meant. Someone who attends three departments
/// has three last times, and answering against the wrong one produces a delta that is
/// wrong in both directions at once.
class PreviousVisitScreen extends StatelessWidget {
  const PreviousVisitScreen({
    required this.strings,
    required this.verifiedOn,
    required this.department,
    required this.onContinue,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;

  /// Already formatted for the patient's locale by the caller.
  final String verifiedOn;
  final String department;
  final VoidCallback onContinue;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['followup.previousVisit.title'],
      primaryAction: MkButton(
        label: strings['common.continue'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: onContinue,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(MkSpacing.lg),
            decoration: BoxDecoration(
              color: MkColors.lightOrange,
              borderRadius: BorderRadius.circular(MkRadius.md),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  verifiedOn,
                  style: MkType.heading.toTextStyle(
                    color: MkColors.darkBlue,
                    scale: a11y.textScale,
                  ),
                ),
                const SizedBox(height: MkSpacing.xs),
                Text(
                  department,
                  style: MkType.body.toTextStyle(
                    color: MkColors.neutralText,
                    scale: a11y.textScale,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: MkSpacing.md),
          Text(
            strings['followup.previousVisit.body'],
            style: MkType.body.toTextStyle(
              color: MkColors.mutedText,
              scale: a11y.textScale,
            ),
          ),
        ],
      ),
    );
  }
}

/// What has changed since that visit.
///
/// Multi-select, and "nothing has changed" is a distinct, equally available answer rather
/// than the result of selecting none and pressing Continue. A patient who genuinely has
/// nothing to report should be able to say so, and a doctor should be able to tell that
/// from a patient who skipped the question.
class WhatChangedScreen extends StatelessWidget {
  const WhatChangedScreen({
    required this.strings,
    required this.selected,
    required this.onToggle,
    required this.onNothingChanged,
    required this.onContinue,
    required this.onExit,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;
  final Set<FollowUpSection> selected;
  final ValueChanged<FollowUpSection> onToggle;
  final VoidCallback onNothingChanged;
  final VoidCallback onContinue;
  final VoidCallback onExit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['followup.whatChanged.title'],
      subtitle: strings['followup.whatChanged.subtitle'],
      primaryAction: selected.isEmpty
          ? MkButton(
              label: strings['followup.nothingChanged'],
              emphasis: MkButtonEmphasis.primary,
              onPressed: busy ? null : onNothingChanged,
            )
          : MkButton(
              label: strings['common.continue'],
              emphasis: MkButtonEmphasis.primary,
              onPressed: busy ? null : onContinue,
            ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final FollowUpSection section in FollowUpSection.values) ...<Widget>[
            MkButton(
              label: strings[section.stringKey],
              selected: selected.contains(section),
              onPressed: busy ? null : () => onToggle(section),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
        ],
      ),
    );
  }
}
