import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// Sections a patient can flag as changed since they pre-checked in at home.
enum ChangedSection {
  symptoms('SYMPTOMS', 'arrival.changed.symptoms'),
  medicines('MEDICINES', 'arrival.changed.medicines'),
  allergy('ALLERGY_OR_SIDE_EFFECT', 'arrival.changed.allergy'),
  newReport('NEW_REPORT', 'arrival.changed.newReport'),
  newDiagnosis('NEW_DIAGNOSIS', 'arrival.changed.newDiagnosis'),
  other('OTHER', 'arrival.changed.other');

  const ChangedSection(this.wire, this.stringKey);

  final String wire;
  final String stringKey;
}

/// The scan screen.
class ScanQrScreen extends StatelessWidget {
  const ScanQrScreen({
    required this.strings,
    required this.onScan,
    required this.onExit,
    this.busy = false,
    this.cameraUnavailable = false,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onScan;
  final VoidCallback onExit;
  final bool busy;
  final bool cameraUnavailable;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['arrival.scan.title'],
      subtitle: strings['arrival.scan.subtitle'],
      primaryAction: MkButton(
        label: strings['arrival.scan.action'],
        emphasis: MkButtonEmphasis.primary,
        icon: Icons.qr_code_scanner,
        onPressed: busy || cameraUnavailable ? null : onScan,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        children: <Widget>[
          Container(
            height: 260,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(MkRadius.md),
              border: Border.all(color: MkColors.primaryBlue, width: 3),
              color: MkColors.neutralErrorSurface,
            ),
            alignment: Alignment.center,
            child: Icon(
              cameraUnavailable ? Icons.no_photography_outlined : Icons.qr_code_2,
              size: 96,
              color: MkColors.primaryBlue,
            ),
          ),
          if (cameraUnavailable) ...<Widget>[
            const SizedBox(height: MkSpacing.md),
            // Said plainly rather than leaving a dead button. A patient who cannot scan
            // needs to know to go to the counter, not to keep trying.
            Text(
              strings['arrival.scan.cameraUnavailable'],
              textAlign: TextAlign.center,
              style: MkType.body.toTextStyle(
                color: MkColors.neutralText,
                scale: a11y.textScale,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Masked confirmation of the visit behind a scanned QR.
class ConfirmVisitScreen extends StatelessWidget {
  const ConfirmVisitScreen({
    required this.strings,
    required this.maskedName,
    required this.maskedMobile,
    required this.hospitalName,
    required this.departmentName,
    required this.visitTypeLabel,
    required this.onConfirm,
    required this.onExit,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;
  final String maskedName;
  final String maskedMobile;
  final String hospitalName;
  final String departmentName;
  final String visitTypeLabel;
  final VoidCallback onConfirm;
  final VoidCallback onExit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.only(bottom: MkSpacing.sm),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              SizedBox(
                width: 170,
                child: Text(
                  label,
                  style: MkType.body.toTextStyle(
                    color: MkColors.mutedText,
                    scale: a11y.textScale,
                  ),
                ),
              ),
              Expanded(
                child: Text(
                  value,
                  style: MkType.body.toTextStyle(
                    color: MkColors.neutralText,
                    scale: a11y.textScale,
                  ),
                ),
              ),
            ],
          ),
        );

    return MkScreen(
      title: strings['arrival.confirm.title'],
      subtitle: strings['arrival.confirm.subtitle'],
      primaryAction: MkButton(
        label: strings['arrival.confirm.yes'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: busy ? null : onConfirm,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          row(strings['arrival.confirm.name'], maskedName),
          row(strings['arrival.confirm.mobile'], maskedMobile),
          row(strings['arrival.confirm.hospital'], hospitalName),
          row(strings['arrival.confirm.department'], departmentName),
          row(strings['arrival.confirm.visitType'], visitTypeLabel),
        ],
      ),
    );
  }
}

/// Asks whether anything has changed since the pre-check-in was completed at home.
class ChangedSinceScreen extends StatelessWidget {
  const ChangedSinceScreen({
    required this.strings,
    required this.selected,
    required this.onToggle,
    required this.onNothingChanged,
    required this.onContinue,
    required this.onExit,
    this.declaring = false,
    super.key,
  });

  final KioskStrings strings;
  final Set<ChangedSection> selected;
  final ValueChanged<ChangedSection> onToggle;
  final VoidCallback onNothingChanged;
  final VoidCallback onContinue;
  final VoidCallback onExit;

  /// False shows the yes/no question; true shows the section picker.
  final bool declaring;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: declaring
          ? strings['arrival.changed.whatChanged']
          : strings['arrival.changed.title'],
      primaryAction: declaring
          ? MkButton(
              label: strings['common.continue'],
              emphasis: MkButtonEmphasis.primary,
              // At least one section must be named, or "yes something changed" tells the
              // doctor nothing and reopens nothing.
              onPressed: selected.isEmpty ? null : onContinue,
            )
          : null,
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: declaring
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (final ChangedSection section in ChangedSection.values) ...<Widget>[
                  MkButton(
                    label: strings[section.stringKey],
                    selected: selected.contains(section),
                    onPressed: () => onToggle(section),
                  ),
                  const SizedBox(height: MkSpacing.md),
                ],
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                MkButton(
                  label: strings['arrival.changed.nothing'],
                  emphasis: MkButtonEmphasis.primary,
                  onPressed: onNothingChanged,
                ),
                const SizedBox(height: MkSpacing.md),
                MkButton(
                  label: strings['arrival.changed.somethingChanged'],
                  onPressed: onContinue,
                ),
              ],
            ),
    );
  }
}

/// Shown when a QR cannot be used, for any reason.
///
/// Exit only. There is deliberately no option to generate a new code here: the kiosk does
/// not issue QRs, and offering it would send patients round a loop the kiosk cannot close.
class QrRejectedScreen extends StatelessWidget {
  const QrRejectedScreen({
    required this.strings,
    required this.onExit,
    this.correlationId,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onExit;
  final String? correlationId;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Scaffold(
      backgroundColor: MkColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Padding(
              padding: const EdgeInsets.all(MkSpacing.xl),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Icon(Icons.info_outline, size: 72, color: MkColors.primaryBlue),
                    const SizedBox(height: MkSpacing.lg),
                    Semantics(
                      header: true,
                      child: Text(
                        strings['arrival.rejected.title'],
                        textAlign: TextAlign.center,
                        style: MkType.heading.toTextStyle(
                          color: MkColors.darkBlue,
                          scale: a11y.textScale,
                        ),
                      ),
                    ),
                    const SizedBox(height: MkSpacing.md),
                    Text(
                      strings['arrival.rejected.body'],
                      textAlign: TextAlign.center,
                      style: MkType.body.toTextStyle(
                        color: MkColors.neutralText,
                        scale: a11y.textScale,
                      ),
                    ),
                    const SizedBox(height: MkSpacing.xl),
                    MkButton(
                      label: strings['common.exit'],
                      emphasis: MkButtonEmphasis.primary,
                      onPressed: onExit,
                    ),
                    if (correlationId != null) ...<Widget>[
                      const SizedBox(height: MkSpacing.xl),
                      Text(
                        '${strings['common.referenceCode']}: $correlationId',
                        textAlign: TextAlign.center,
                        style: MkType.caption.toTextStyle(
                          color: MkColors.mutedText,
                          scale: a11y.textScale,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
