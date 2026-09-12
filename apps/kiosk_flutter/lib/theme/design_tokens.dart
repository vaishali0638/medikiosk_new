// GENERATED FILE — DO NOT EDIT.
// Source: packages/design_tokens/src/tokens.ts
// Regenerate with: npm run tokens:build
//
// Colour semantics are a safety requirement:
//   blue   -> navigation and information
//   orange -> primary actions and selected states
//   red    -> internal/system alert status only, never a patient-facing diagnosis.

import 'package:flutter/material.dart';

/// A typography token: size in logical pixels, weight and line-height multiplier.
@immutable
class MkTextToken {
  const MkTextToken({
    required this.sizeSp,
    required this.weight,
    required this.lineHeight,
  });

  final double sizeSp;
  final FontWeight weight;
  final double lineHeight;

  TextStyle toTextStyle({required Color color, double scale = 1.0}) => TextStyle(
        fontSize: sizeSp * scale,
        fontWeight: weight,
        height: lineHeight,
        color: color,
      );
}

/// Canonical MediKiosk colours.
abstract final class MkColors {
  static const Color background = Color(0xFFFFFFFF);
  static const Color primaryBlue = Color(0xFF1565C0);
  static const Color darkBlue = Color(0xFF0D47A1);
  static const Color actionOrange = Color(0xFFF57C00);
  static const Color lightOrange = Color(0xFFFFF3E0);
  static const Color success = Color(0xFF2E7D32);
  static const Color neutralText = Color(0xFF263238);
  static const Color mutedText = Color(0xFF546E7A);
  static const Color border = Color(0xFFD9E2F3);
  static const Color internalAlert = Color(0xFFC62828);
  static const Color neutralErrorSurface = Color(0xFFECEFF1);
}

/// Spacing scale in logical pixels (dp).
abstract final class MkSpacing {
  static const double xs = 4.0;
  static const double sm = 8.0;
  static const double md = 16.0;
  static const double lg = 24.0;
  static const double xl = 32.0;
  static const double xxl = 48.0;
}

/// Corner radii in logical pixels (dp).
abstract final class MkRadius {
  static const double sm = 8.0;
  static const double md = 16.0;
  static const double lg = 24.0;
  static const double pill = 999.0;
}

/// Accessibility floors, enforced by widget tests.
abstract final class MkA11y {
  static const double minTouchTargetDp = 48.0;
  static const double minBodyTextSp = 18.0;
  static const double largeTextScale = 1.35;
  static const double minContrastRatio = 4.5;
}

/// Typography tokens.
abstract final class MkType {
  static const MkTextToken display = MkTextToken(
    sizeSp: 44.0,
    weight: FontWeight.w700,
    lineHeight: 1.15,
  );

  static const MkTextToken heading = MkTextToken(
    sizeSp: 30.0,
    weight: FontWeight.w600,
    lineHeight: 1.25,
  );

  static const MkTextToken action = MkTextToken(
    sizeSp: 24.0,
    weight: FontWeight.w600,
    lineHeight: 1.3,
  );

  static const MkTextToken body = MkTextToken(
    sizeSp: 20.0,
    weight: FontWeight.w400,
    lineHeight: 1.45,
  );

  static const MkTextToken caption = MkTextToken(
    sizeSp: 16.0,
    weight: FontWeight.w400,
    lineHeight: 1.4,
  );
}

/// Kiosk session timing defaults. Overridable per hospital via kiosk config.
abstract final class MkTiming {
  static const Duration inactivityWarning = Duration(seconds: 90);
  static const Duration inactivityWipe = Duration(seconds: 30);
  static const Duration screenTransitionBudget =
      Duration(milliseconds: 500);
}
