import 'package:flutter/material.dart';

import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';

/// Emphasis levels available to a kiosk button.
///
/// A screen carries at most one [MkButtonEmphasis.primary] button. That is a usability
/// requirement for elderly and low-literacy patients: the next step must be unmistakable.
enum MkButtonEmphasis {
  /// Orange, filled. The single primary action on the screen.
  primary,

  /// Blue, outlined. Navigation and alternative choices.
  secondary,

  /// Low-emphasis. Used for Exit, which is present on every active screen.
  quiet,
}

/// A large, high-contrast kiosk button that always meets the 48dp touch-target floor.
class MkButton extends StatelessWidget {
  const MkButton({
    required this.label,
    required this.onPressed,
    this.emphasis = MkButtonEmphasis.secondary,
    this.icon,
    this.semanticLabel,
    this.selected = false,
    super.key,
  });

  final String label;

  /// `null` renders the button visibly disabled rather than hiding it, so the layout
  /// a patient learned does not shift under them.
  final VoidCallback? onPressed;

  final MkButtonEmphasis emphasis;

  /// Icons are only ever shown alongside the text label, never instead of it.
  final IconData? icon;

  /// Spoken description when it needs to differ from the visible label.
  final String? semanticLabel;

  /// Selected state uses orange, matching the primary-action colour role.
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);
    final bool enabled = onPressed != null;

    // Every emphasis carries a border of the same width — transparent for primary — so
    // buttons of different emphasis are exactly the same size. On the consent screen
    // Agree and Decline must be equally weighted, and a 4px height difference is a nudge.
    final (Color background, Color foreground, Color outline) = switch (emphasis) {
      MkButtonEmphasis.primary => (
          MkColors.actionOrange,
          MkColors.background,
          MkColors.actionOrange,
        ),
      MkButtonEmphasis.secondary => selected
          ? (MkColors.lightOrange, MkColors.darkBlue, MkColors.actionOrange)
          : (MkColors.background, MkColors.primaryBlue, MkColors.primaryBlue),
      MkButtonEmphasis.quiet => (MkColors.background, MkColors.mutedText, MkColors.border),
    };

    final TextStyle labelStyle = MkType.action.toTextStyle(
      color: enabled ? foreground : MkColors.mutedText,
      scale: a11y.textScale,
    );

    return Semantics(
      button: true,
      enabled: enabled,
      selected: selected,
      label: semanticLabel ?? label,
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: MkA11y.minTouchTargetDp,
          minWidth: MkA11y.minTouchTargetDp,
        ),
        child: Material(
          color: enabled ? background : MkColors.neutralErrorSurface,
          borderRadius: BorderRadius.circular(MkRadius.lg),
          child: InkWell(
            onTap: onPressed,
            borderRadius: BorderRadius.circular(MkRadius.lg),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: MkSpacing.lg,
                vertical: MkSpacing.md,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(MkRadius.lg),
                border: Border.all(color: enabled ? outline : MkColors.border, width: 2),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (icon != null) ...<Widget>[
                    Icon(icon, size: labelStyle.fontSize, color: labelStyle.color),
                    const SizedBox(width: MkSpacing.sm),
                  ],
                  Flexible(
                    child: Text(label, style: labelStyle, textAlign: TextAlign.center),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
