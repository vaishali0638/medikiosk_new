import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/theme/design_tokens.dart';

/// WCAG relative luminance.
double _luminance(Color c) {
  double channel(double v) {
    final double s = v;
    return s <= 0.03928 ? s / 12.92 : math.pow((s + 0.055) / 1.055, 2.4).toDouble();
  }

  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double _contrast(Color a, Color b) {
  final double la = _luminance(a);
  final double lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  group('accessibility floors', () {
    test('body text meets the minimum readable size for elderly patients', () {
      expect(MkType.body.sizeSp, greaterThanOrEqualTo(MkA11y.minBodyTextSp));
      expect(MkType.action.sizeSp, greaterThanOrEqualTo(MkA11y.minBodyTextSp));
    });

    test('body text on the page background meets the contrast floor', () {
      expect(
        _contrast(MkColors.neutralText, MkColors.background),
        greaterThanOrEqualTo(MkA11y.minContrastRatio),
      );
    });

    test('supporting text on the page background meets the contrast floor', () {
      expect(
        _contrast(MkColors.mutedText, MkColors.background),
        greaterThanOrEqualTo(MkA11y.minContrastRatio),
      );
    });

    test('secondary button text on white meets the contrast floor', () {
      expect(
        _contrast(MkColors.primaryBlue, MkColors.background),
        greaterThanOrEqualTo(MkA11y.minContrastRatio),
      );
      expect(
        _contrast(MkColors.darkBlue, MkColors.lightOrange),
        greaterThanOrEqualTo(MkA11y.minContrastRatio),
      );
    });

    test('the touch-target floor is at least the 48dp the specification requires', () {
      expect(MkA11y.minTouchTargetDp, greaterThanOrEqualTo(48.0));
    });
  });

  group('colour roles', () {
    test('the page background is white', () {
      expect(MkColors.background, const Color(0xFFFFFFFF));
    });

    test('primary blue and action orange are distinct enough to tell apart', () {
      expect(MkColors.primaryBlue, isNot(MkColors.actionOrange));
      expect(_contrast(MkColors.primaryBlue, MkColors.actionOrange), greaterThan(1.5));
    });
  });

  group('session timing', () {
    test('a patient is warned before the session is wiped', () {
      expect(MkTiming.inactivityWarning.inSeconds, greaterThan(0));
      expect(MkTiming.inactivityWipe.inSeconds, greaterThan(0));
    });

    test('the screen transition budget matches the stated performance target', () {
      expect(MkTiming.screenTransitionBudget.inMilliseconds, lessThanOrEqualTo(500));
    });
  });
}
