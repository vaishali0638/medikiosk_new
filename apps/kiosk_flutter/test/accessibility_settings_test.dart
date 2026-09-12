import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/theme/design_tokens.dart';

void main() {
  test('defaults to no accessibility overrides', () {
    const AccessibilitySettings settings = AccessibilitySettings();
    expect(settings.largeText, isFalse);
    expect(settings.highContrast, isFalse);
    expect(settings.audioGuidance, isFalse);
    expect(settings.textScale, 1.0);
  });

  test('large text applies the token scale', () {
    const AccessibilitySettings settings = AccessibilitySettings(largeText: true);
    expect(settings.textScale, MkA11y.largeTextScale);
  });

  test('copyWith changes only the named field', () {
    const AccessibilitySettings base = AccessibilitySettings(audioGuidance: true);
    final AccessibilitySettings next = base.copyWith(highContrast: true);
    expect(next.audioGuidance, isTrue);
    expect(next.highContrast, isTrue);
    expect(next.largeText, isFalse);
  });

  test('value equality holds, so the inherited widget only notifies on real changes', () {
    expect(
      const AccessibilitySettings(largeText: true),
      equals(const AccessibilitySettings(largeText: true)),
    );
    expect(
      const AccessibilitySettings(largeText: true),
      isNot(equals(const AccessibilitySettings())),
    );
  });
}
