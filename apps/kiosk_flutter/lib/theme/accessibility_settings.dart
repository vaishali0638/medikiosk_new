import 'package:flutter/widgets.dart';

import 'design_tokens.dart';

/// Session accessibility preferences.
///
/// These are deliberately per-session and in-memory: the kiosk must never carry one
/// patient's settings into the next patient's session, so they are wiped along with
/// the rest of the session state.
@immutable
class AccessibilitySettings {
  const AccessibilitySettings({
    this.largeText = false,
    this.highContrast = false,
    this.audioGuidance = false,
  });

  final bool largeText;
  final bool highContrast;
  final bool audioGuidance;

  /// Multiplier applied to every text token when Large Text is on.
  double get textScale => largeText ? MkA11y.largeTextScale : 1.0;

  AccessibilitySettings copyWith({
    bool? largeText,
    bool? highContrast,
    bool? audioGuidance,
  }) {
    return AccessibilitySettings(
      largeText: largeText ?? this.largeText,
      highContrast: highContrast ?? this.highContrast,
      audioGuidance: audioGuidance ?? this.audioGuidance,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AccessibilitySettings &&
      other.largeText == largeText &&
      other.highContrast == highContrast &&
      other.audioGuidance == audioGuidance;

  @override
  int get hashCode => Object.hash(largeText, highContrast, audioGuidance);
}

/// Makes the current session's accessibility settings available to every widget.
class AccessibilityScope extends InheritedWidget {
  const AccessibilityScope({
    required this.settings,
    required super.child,
    super.key,
  });

  final AccessibilitySettings settings;

  static AccessibilitySettings of(BuildContext context) {
    final AccessibilityScope? scope =
        context.dependOnInheritedWidgetOfExactType<AccessibilityScope>();
    // Defaulting rather than throwing keeps a widget renderable in isolation in tests.
    return scope?.settings ?? const AccessibilitySettings();
  }

  @override
  bool updateShouldNotify(AccessibilityScope oldWidget) => oldWidget.settings != settings;
}
