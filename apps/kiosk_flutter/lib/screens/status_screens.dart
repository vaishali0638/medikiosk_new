import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';

/// Shared layout for the terminal status screens: session expired, error and offline.
///
/// All three use a neutral surface and blue iconography. Red is reserved for internal
/// and system alert status; on a patient screen it reads as alarm, and none of these
/// situations is a clinical emergency.
class _StatusScreen extends StatelessWidget {
  const _StatusScreen({
    required this.icon,
    required this.title,
    required this.body,
    required this.actions,
    this.referenceCode,
    this.referenceLabel,
  });

  final IconData icon;
  final String title;
  final String body;
  final List<Widget> actions;

  /// Correlation id, shown small so counter staff can quote it. Carries no patient data.
  final String? referenceCode;
  final String? referenceLabel;

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
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Icon(icon, size: 72, color: MkColors.primaryBlue),
                  const SizedBox(height: MkSpacing.lg),
                  Semantics(
                    header: true,
                    child: Text(
                      title,
                      textAlign: TextAlign.center,
                      style: MkType.heading.toTextStyle(
                        color: MkColors.darkBlue,
                        scale: a11y.textScale,
                      ),
                    ),
                  ),
                  const SizedBox(height: MkSpacing.md),
                  Text(
                    body,
                    textAlign: TextAlign.center,
                    style: MkType.body.toTextStyle(
                      color: MkColors.neutralText,
                      scale: a11y.textScale,
                    ),
                  ),
                  const SizedBox(height: MkSpacing.xl),
                  ...actions,
                  if (referenceCode != null) ...<Widget>[
                    const SizedBox(height: MkSpacing.xl),
                    Text(
                      '${referenceLabel ?? 'Reference'}: $referenceCode',
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
    );
  }
}

/// Shown after an inactivity timeout has already wiped the session.
class SessionExpiredScreen extends StatelessWidget {
  const SessionExpiredScreen({required this.strings, required this.onStartAgain, super.key});

  final KioskStrings strings;
  final VoidCallback onStartAgain;

  @override
  Widget build(BuildContext context) {
    return _StatusScreen(
      icon: Icons.timer_off_outlined,
      title: strings['expired.title'],
      body: strings['expired.body'],
      actions: <Widget>[
        MkButton(
          label: strings['common.startAgain'],
          emphasis: MkButtonEmphasis.primary,
          onPressed: onStartAgain,
        ),
      ],
    );
  }
}

/// Generic error. Carries a correlation id and nothing else.
///
/// It deliberately does not say what failed. A kiosk stands in a public corridor, and an
/// error that explains why a lookup failed leaks information about who is registered.
class KioskErrorScreen extends StatelessWidget {
  const KioskErrorScreen({
    required this.strings,
    required this.onStartAgain,
    this.correlationId,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onStartAgain;
  final String? correlationId;

  @override
  Widget build(BuildContext context) {
    return _StatusScreen(
      icon: Icons.info_outline,
      title: strings['error.title'],
      body: strings['error.body'],
      referenceCode: correlationId,
      referenceLabel: strings['common.referenceCode'],
      actions: <Widget>[
        MkButton(
          label: strings['common.startAgain'],
          emphasis: MkButtonEmphasis.primary,
          onPressed: onStartAgain,
        ),
      ],
    );
  }
}

/// Shown when the backend is unreachable.
///
/// Offers a retry and nothing else. There is no offline check-in path: a token can only
/// come from the hospital HIS, so letting a patient continue here would build up work
/// that cannot produce a token and would end in a worse failure further along.
class NetworkUnavailableScreen extends StatelessWidget {
  const NetworkUnavailableScreen({
    required this.strings,
    required this.onRetry,
    this.onExit,
    this.correlationId,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onRetry;
  final VoidCallback? onExit;
  final String? correlationId;

  @override
  Widget build(BuildContext context) {
    return _StatusScreen(
      icon: Icons.cloud_off,
      title: strings['offline.title'],
      body: strings['offline.body'],
      referenceCode: correlationId,
      referenceLabel: strings['common.referenceCode'],
      actions: <Widget>[
        MkButton(
          label: strings['offline.retry'],
          emphasis: MkButtonEmphasis.primary,
          onPressed: onRetry,
        ),
        if (onExit != null) ...<Widget>[
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['common.exit'],
            emphasis: MkButtonEmphasis.quiet,
            onPressed: onExit,
          ),
        ],
      ],
    );
  }
}

/// Boot screen while configuration and health are checked.
class StartupScreen extends StatelessWidget {
  const StartupScreen({required this.strings, this.unavailableReason, super.key});

  final KioskStrings strings;

  /// Set when the kiosk cannot be used at all — an operational message for staff, not a
  /// patient instruction.
  final String? unavailableReason;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);
    final bool unavailable = unavailableReason != null;

    return Scaffold(
      backgroundColor: MkColors.background,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            if (!unavailable)
              const CircularProgressIndicator(color: MkColors.primaryBlue)
            else
              const Icon(Icons.build_circle_outlined, size: 72, color: MkColors.mutedText),
            const SizedBox(height: MkSpacing.lg),
            Text(
              unavailable ? strings['startup.unavailable'] : strings['startup.title'],
              style: MkType.heading.toTextStyle(
                color: MkColors.darkBlue,
                scale: a11y.textScale,
              ),
            ),
            const SizedBox(height: MkSpacing.sm),
            Text(
              unavailableReason ?? strings['startup.body'],
              textAlign: TextAlign.center,
              style: MkType.body.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
