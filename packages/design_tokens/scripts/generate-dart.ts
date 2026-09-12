/**
 * Generates the Dart mirror of the canonical design tokens.
 * Run via `npm run tokens:build`. Do not edit the generated file by hand.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { colors, spacing, radius, a11y, typography, timing } from '../src/tokens';

const here = __dirname;
const outPath = resolve(here, '../../../apps/kiosk_flutter/lib/theme/design_tokens.dart');

const hexToDart = (hex: string): string => `0xFF${hex.replace('#', '').toUpperCase()}`;

const camelToDart = (name: string): string => name;

const colorLines = Object.entries(colors)
  .map(([name, hex]) => `  static const Color ${camelToDart(name)} = Color(${hexToDart(hex)});`)
  .join('\n');

const spacingLines = Object.entries(spacing)
  .map(([name, value]) => `  static const double ${name} = ${value.toFixed(1)};`)
  .join('\n');

const radiusLines = Object.entries(radius)
  .map(([name, value]) => `  static const double ${name} = ${value.toFixed(1)};`)
  .join('\n');

const typographyLines = Object.entries(typography)
  .map(
    ([name, t]) =>
      `  static const MkTextToken ${name} = MkTextToken(\n` +
      `    sizeSp: ${t.sizeSp.toFixed(1)},\n` +
      `    weight: FontWeight.w${t.weight},\n` +
      `    lineHeight: ${t.lineHeight},\n` +
      `  );`,
  )
  .join('\n\n');

const dart = `// GENERATED FILE — DO NOT EDIT.
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
${colorLines}
}

/// Spacing scale in logical pixels (dp).
abstract final class MkSpacing {
${spacingLines}
}

/// Corner radii in logical pixels (dp).
abstract final class MkRadius {
${radiusLines}
}

/// Accessibility floors, enforced by widget tests.
abstract final class MkA11y {
  static const double minTouchTargetDp = ${a11y.minTouchTargetDp.toFixed(1)};
  static const double minBodyTextSp = ${a11y.minBodyTextSp.toFixed(1)};
  static const double largeTextScale = ${a11y.largeTextScale};
  static const double minContrastRatio = ${a11y.minContrastRatio};
}

/// Typography tokens.
abstract final class MkType {
${typographyLines}
}

/// Kiosk session timing defaults. Overridable per hospital via kiosk config.
abstract final class MkTiming {
  static const Duration inactivityWarning = Duration(seconds: ${timing.inactivityWarningSec});
  static const Duration inactivityWipe = Duration(seconds: ${timing.inactivityWipeSec});
  static const Duration screenTransitionBudget =
      Duration(milliseconds: ${timing.screenTransitionBudgetMs});
}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, dart, 'utf8');
process.stdout.write(`design tokens -> ${outPath}\n`);
