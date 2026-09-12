import 'package:flutter/material.dart';

import '../config/kiosk_config.dart';
import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';

/// The idle screen.
///
/// This is the only screen without an Exit action: there is no session to end, and
/// offering Exit on an idle kiosk would be a control that does nothing.
///
/// The five options here are fixed by the product specification. Two omissions are
/// deliberate and enforced by the CI forbidden-option scan: there is no token-entry
/// option, because a token exists only when the hospital HIS has issued one; and there
/// is no in-software staff channel, because this deployment does not provide one.
/// (Both banned phrases appear in tools/src/forbidden-options.ts.)
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    required this.strings,
    required this.onCheckInWithMobileQr,
    required this.onNewRegistration,
    required this.onExistingPatientCheckIn,
    required this.onSelectLanguage,
    required this.onToggleAudioGuidance,
    this.features = FeatureFlags.allDisabled,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback? onCheckInWithMobileQr;
  final VoidCallback? onNewRegistration;
  final VoidCallback? onExistingPatientCheckIn;
  final VoidCallback onSelectLanguage;
  final VoidCallback onToggleAudioGuidance;
  final FeatureFlags features;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Scaffold(
      backgroundColor: MkColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Padding(
              padding: const EdgeInsets.all(MkSpacing.xl),
              // Scrolls only when the content does not fit. On a tall portrait kiosk it
              // never does, but a landscape mount or Large Text must not clip the bottom
              // options off the screen where nobody can reach them.
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Semantics(
                      header: true,
                      child: Text(
                        strings['app.title'],
                        textAlign: TextAlign.center,
                        style: MkType.display.toTextStyle(
                          color: MkColors.darkBlue,
                          scale: a11y.textScale,
                        ),
                      ),
                    ),
                    const SizedBox(height: MkSpacing.sm),
                    Text(
                      strings['app.tagline'],
                      textAlign: TextAlign.center,
                      style: MkType.body.toTextStyle(
                        color: MkColors.mutedText,
                        scale: a11y.textScale,
                      ),
                    ),
                    const SizedBox(height: MkSpacing.xxl),

                    // Mobile QR first: patients who pre-checked in at home are the ones
                    // the queue most needs to move through quickly.
                    MkButton(
                      label: strings['home.checkInWithMobileQr'],
                      emphasis: MkButtonEmphasis.primary,
                      icon: Icons.qr_code_scanner,
                      onPressed: onCheckInWithMobileQr,
                    ),
                    const SizedBox(height: MkSpacing.md),
                    MkButton(
                      label: strings['home.newRegistration'],
                      icon: Icons.person_add_alt,
                      onPressed: onNewRegistration,
                    ),
                    const SizedBox(height: MkSpacing.md),
                    MkButton(
                      label: strings['home.existingPatientCheckIn'],
                      icon: Icons.badge_outlined,
                      onPressed: onExistingPatientCheckIn,
                    ),
                    const SizedBox(height: MkSpacing.xl),
                    MkButton(
                      label: strings['home.selectLanguage'],
                      icon: Icons.language,
                      onPressed: onSelectLanguage,
                    ),
                    const SizedBox(height: MkSpacing.md),
                    MkButton(
                      label: strings['home.audioGuidance'],
                      icon: Icons.volume_up,
                      selected: a11y.audioGuidance,
                      onPressed: onToggleAudioGuidance,
                    ),
                    const SizedBox(height: MkSpacing.xl),
                    Text(
                      strings['home.touchToBegin'],
                      textAlign: TextAlign.center,
                      style: MkType.caption.toTextStyle(
                        color: MkColors.mutedText,
                        scale: a11y.textScale,
                      ),
                    ),
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
