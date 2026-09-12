import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';

/// Exit confirmation.
///
/// Barrier dismissal is off and there is no close affordance: a stray touch must not
/// silently discard a session a patient is partway through, and it must not silently
/// keep one they meant to end. The choice has to be explicit.
Future<bool> showExitConfirmation(BuildContext context, KioskStrings strings) async {
  final bool? confirmed = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (BuildContext dialogContext) => _KioskDialog(
      icon: Icons.logout,
      title: strings['exit.title'],
      body: strings['exit.body'],
      actions: <Widget>[
        MkButton(
          label: strings['exit.confirm'],
          emphasis: MkButtonEmphasis.primary,
          onPressed: () => Navigator.of(dialogContext).pop(true),
        ),
        const SizedBox(height: MkSpacing.md),
        MkButton(
          label: strings['exit.cancel'],
          onPressed: () => Navigator.of(dialogContext).pop(false),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

/// Inactivity warning with a visible countdown.
///
/// Returns true if the patient said they are still there. The countdown is shown rather
/// than left implicit because a patient who is simply reading slowly deserves to know how
/// long they have, and elderly and low-literacy patients are exactly who this kiosk is for.
///
/// The dialog does not itself wipe anything. [SessionManager] owns the timer that fires
/// the wipe, so a rendering problem here cannot leave a session open indefinitely.
Future<bool> showTimeoutWarning(
  BuildContext context,
  KioskStrings strings,
  Duration remaining,
) async {
  final bool? stayed = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (BuildContext dialogContext) => _TimeoutDialog(
      strings: strings,
      remaining: remaining,
      onStay: () => Navigator.of(dialogContext).pop(true),
    ),
  );
  return stayed ?? false;
}

class _KioskDialog extends StatelessWidget {
  const _KioskDialog({
    required this.icon,
    required this.title,
    required this.body,
    required this.actions,
  });

  final IconData icon;
  final String title;
  final String body;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Dialog(
      backgroundColor: MkColors.background,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MkRadius.md)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Padding(
          padding: const EdgeInsets.all(MkSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Icon(icon, size: 56, color: MkColors.primaryBlue),
              const SizedBox(height: MkSpacing.md),
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
              const SizedBox(height: MkSpacing.sm),
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
            ],
          ),
        ),
      ),
    );
  }
}

class _TimeoutDialog extends StatefulWidget {
  const _TimeoutDialog({
    required this.strings,
    required this.remaining,
    required this.onStay,
  });

  final KioskStrings strings;
  final Duration remaining;
  final VoidCallback onStay;

  @override
  State<_TimeoutDialog> createState() => _TimeoutDialogState();
}

class _TimeoutDialogState extends State<_TimeoutDialog> {
  late int _secondsLeft = widget.remaining.inSeconds;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (Timer timer) {
      if (!mounted) return;
      setState(() => _secondsLeft = (_secondsLeft - 1).clamp(0, 1 << 30));
      if (_secondsLeft <= 0) timer.cancel();
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _KioskDialog(
      icon: Icons.timer_outlined,
      title: widget.strings['timeout.title'],
      body: '${widget.strings['timeout.body']}\n\n'
          '$_secondsLeft ${widget.strings['timeout.secondsRemaining']}',
      actions: <Widget>[
        MkButton(
          label: widget.strings['timeout.continue'],
          emphasis: MkButtonEmphasis.primary,
          onPressed: widget.onStay,
        ),
      ],
    );
  }
}
