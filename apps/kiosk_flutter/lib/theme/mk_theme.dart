import 'package:flutter/material.dart';

import 'design_tokens.dart';

/// Builds the MediKiosk [ThemeData] from the generated design tokens.
///
/// Colour roles are fixed by the product specification and are not decorative:
/// blue carries navigation and information, orange marks the single primary action
/// on a screen and any selected state, and red is reserved for internal/system alert
/// status — it must never appear on a patient screen in a way that reads as a diagnosis.
abstract final class MkTheme {
  static ThemeData build({bool highContrast = false, double textScale = 1.0}) {
    final Color text = highContrast ? const Color(0xFF000000) : MkColors.neutralText;
    final Color muted = highContrast ? const Color(0xFF000000) : MkColors.mutedText;
    final Color border = highContrast ? const Color(0xFF000000) : MkColors.border;

    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: MkColors.primaryBlue,
      brightness: Brightness.light,
    ).copyWith(
      primary: MkColors.primaryBlue,
      onPrimary: MkColors.background,
      secondary: MkColors.actionOrange,
      onSecondary: MkColors.background,
      surface: MkColors.background,
      onSurface: text,
      error: MkColors.internalAlert,
      outline: border,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: MkColors.background,
      // Every tappable thing clears the 48dp floor, not just Material's own defaults.
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.comfortable,
      textTheme: TextTheme(
        displayLarge: MkType.display.toTextStyle(color: text, scale: textScale),
        headlineMedium: MkType.heading.toTextStyle(color: text, scale: textScale),
        titleLarge: MkType.action.toTextStyle(color: text, scale: textScale),
        bodyLarge: MkType.body.toTextStyle(color: text, scale: textScale),
        bodySmall: MkType.caption.toTextStyle(color: muted, scale: textScale),
      ),
      dividerTheme: DividerThemeData(color: border, thickness: highContrast ? 2 : 1),
    );
  }
}
