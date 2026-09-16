import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// Why the patient is here today.
///
/// This is not a reporting field. It decides whether the clinician reads a follow-up delta
/// — what has changed since the last verified visit — or takes a history from scratch, so
/// a wrong answer here produces the wrong consultation. The kiosk hardcoded NEW_COMPLAINT
/// for every walk-in before this screen existed, which made the follow-up path unreachable
/// and quietly recorded every general check-up as a complaint.
///
/// Follow-up is shown greyed rather than hidden when the patient has no verified previous
/// visit. Hiding it would leave someone who came for exactly that hunting for the option;
/// showing it disabled, with the reason underneath, answers the question they are about to
/// ask. The server refuses it too, independently — see `resolveVisitType`.
enum KioskVisitType {
  newComplaint('NEW_COMPLAINT'),
  followUp('REGULAR_FOLLOW_UP'),
  generalCheckup('GENERAL_CHECKUP');

  const KioskVisitType(this.wire);

  /// The contract's value. Kept beside the enum so the two cannot drift.
  final String wire;
}

class VisitTypeScreen extends StatelessWidget {
  const VisitTypeScreen({
    required this.strings,
    required this.onSelect,
    required this.onExit,
    this.followUpAvailable = false,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;
  final ValueChanged<KioskVisitType> onSelect;
  final VoidCallback onExit;

  /// Whether a clinician has verified a visit for this patient here before.
  final bool followUpAvailable;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['visitType.title'],
      subtitle: strings['visitType.subtitle'],
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          MkButton(
            label: strings['visitType.newComplaint'],
            onPressed: busy ? null : () => onSelect(KioskVisitType.newComplaint),
          ),
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['visitType.followUp'],
            onPressed:
                busy || !followUpAvailable ? null : () => onSelect(KioskVisitType.followUp),
          ),
          if (!followUpAvailable) ...<Widget>[
            const SizedBox(height: MkSpacing.sm),
            Text(
              strings['visitType.followUpUnavailable'],
              style: MkType.caption.toTextStyle(color: MkColors.mutedText),
            ),
          ],
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['visitType.generalCheckup'],
            onPressed: busy ? null : () => onSelect(KioskVisitType.generalCheckup),
          ),
        ],
      ),
    );
  }
}
