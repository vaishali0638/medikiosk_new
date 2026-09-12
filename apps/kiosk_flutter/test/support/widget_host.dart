import 'package:flutter/material.dart';
import 'package:medikiosk_kiosk/theme/accessibility_settings.dart';
import 'package:medikiosk_kiosk/theme/mk_theme.dart';

/// Wraps a screen in the same theme and accessibility scope the shell provides.
Widget host(
  Widget child, {
  AccessibilitySettings settings = const AccessibilitySettings(),
}) {
  return AccessibilityScope(
    settings: settings,
    child: MaterialApp(
      theme: MkTheme.build(
        highContrast: settings.highContrast,
        textScale: settings.textScale,
      ),
      home: child,
    ),
  );
}
