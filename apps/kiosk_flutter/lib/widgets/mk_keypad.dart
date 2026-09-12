import 'package:flutter/material.dart';

import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';

/// On-screen numeric keypad.
///
/// The kiosk uses this rather than the Android soft keyboard for three reasons: the
/// system keyboard can expose clipboard history and voice input, its keys are far below
/// the 48dp floor on a wall-mounted screen, and it can be dismissed leaving a patient
/// stuck at a field they cannot fill.
class MkKeypad extends StatelessWidget {
  const MkKeypad({
    required this.onDigit,
    required this.onBackspace,
    this.onClear,
    this.enabled = true,
    super.key,
  });

  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback? onClear;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (final List<String> row in const <List<String>>[
            <String>['1', '2', '3'],
            <String>['4', '5', '6'],
            <String>['7', '8', '9'],
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: MkSpacing.sm),
              child: Row(
                children: <Widget>[
                  for (final String digit in row)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: MkSpacing.xs),
                        child: _Key(label: digit, onTap: enabled ? () => onDigit(digit) : null),
                      ),
                    ),
                ],
              ),
            ),
          Row(
            children: <Widget>[
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: MkSpacing.xs),
                  child: _Key(
                    label: 'C',
                    semanticLabel: 'Clear',
                    onTap: enabled ? onClear : null,
                  ),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: MkSpacing.xs),
                  child: _Key(label: '0', onTap: enabled ? () => onDigit('0') : null),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: MkSpacing.xs),
                  child: _Key(
                    icon: Icons.backspace_outlined,
                    semanticLabel: 'Delete',
                    onTap: enabled ? onBackspace : null,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Key extends StatelessWidget {
  const _Key({this.label, this.icon, this.semanticLabel, this.onTap});

  final String? label;
  final IconData? icon;
  final String? semanticLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);
    final bool enabled = onTap != null;
    final Color foreground = enabled ? MkColors.darkBlue : MkColors.mutedText;

    return Semantics(
      button: true,
      enabled: enabled,
      label: semanticLabel ?? label,
      child: SizedBox(
        // Generously above the 48dp floor: these are hit repeatedly, often by someone
        // with poor eyesight or an unsteady hand.
        height: 72,
        child: Material(
          color: enabled ? MkColors.background : MkColors.neutralErrorSurface,
          borderRadius: BorderRadius.circular(MkRadius.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(MkRadius.md),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(MkRadius.md),
                border: Border.all(color: MkColors.border, width: 2),
              ),
              alignment: Alignment.center,
              child: icon != null
                  ? Icon(icon, size: 28 * a11y.textScale, color: foreground)
                  : Text(
                      label ?? '',
                      style: MkType.heading.toTextStyle(
                        color: foreground,
                        scale: a11y.textScale,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Displays entered digits as fixed slots.
///
/// Shows position and length without echoing anything sensitive elsewhere on screen.
class MkDigitDisplay extends StatelessWidget {
  const MkDigitDisplay({
    required this.value,
    required this.length,
    this.semanticLabel,
    super.key,
  });

  final String value;
  final int length;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Semantics(
      label: semanticLabel,
      value: '${value.length} of $length entered',
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          for (int i = 0; i < length; i += 1)
            Container(
              width: 44,
              height: 60,
              margin: const EdgeInsets.symmetric(horizontal: MkSpacing.xs),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(MkRadius.sm),
                border: Border.all(
                  color: i < value.length ? MkColors.actionOrange : MkColors.border,
                  width: 2,
                ),
              ),
              alignment: Alignment.center,
              child: Text(
                i < value.length ? value[i] : '',
                style: MkType.heading.toTextStyle(
                  color: MkColors.neutralText,
                  scale: a11y.textScale,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
