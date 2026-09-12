import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme/accessibility_settings.dart';
import 'theme/design_tokens.dart';
import 'theme/mk_theme.dart';
import 'widgets/mk_button.dart';
import 'widgets/mk_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Kiosks are fixed-orientation landscape or portrait per hardware; locking here
  // prevents a rotation from re-laying out mid-answer. Phase 3 reads this from config.
  unawaited(
    SystemChrome.setPreferredOrientations(<DeviceOrientation>[
      DeviceOrientation.portraitUp,
    ]),
  );
  runApp(const MediKioskApp());
}

/// Application root.
///
/// PHASE 1 SCOPE: theme, accessibility scope and the reusable component set only.
/// Phase 3 replaces the placeholder below with the real kiosk shell — home screen,
/// language selection, exit confirmation, inactivity timeout, error and offline
/// states — plus session lifecycle and lock-task enforcement.
class MediKioskApp extends StatefulWidget {
  const MediKioskApp({super.key});

  @override
  State<MediKioskApp> createState() => _MediKioskAppState();
}

class _MediKioskAppState extends State<MediKioskApp> {
  AccessibilitySettings _settings = const AccessibilitySettings();

  void _update(AccessibilitySettings next) => setState(() => _settings = next);

  @override
  Widget build(BuildContext context) {
    return AccessibilityScope(
      settings: _settings,
      child: MaterialApp(
        title: 'MediKiosk',
        debugShowCheckedModeBanner: false,
        theme: MkTheme.build(
          highContrast: _settings.highContrast,
          textScale: _settings.textScale,
        ),
        home: _FoundationPlaceholder(
          settings: _settings,
          onSettingsChanged: _update,
        ),
      ),
    );
  }
}

/// Temporary screen proving the theme, tokens and components render.
/// Deleted in Phase 3 when the real home screen lands.
class _FoundationPlaceholder extends StatelessWidget {
  const _FoundationPlaceholder({
    required this.settings,
    required this.onSettingsChanged,
  });

  final AccessibilitySettings settings;
  final ValueChanged<AccessibilitySettings> onSettingsChanged;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: 'MediKiosk',
      subtitle: 'Prepare your hospital visit',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Foundation build. The patient workflow is not implemented yet.',
            style: MkType.body.toTextStyle(
              color: MkColors.neutralText,
              scale: settings.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.lg),
          MkButton(
            label: 'Large Text',
            selected: settings.largeText,
            onPressed: () => onSettingsChanged(
              settings.copyWith(largeText: !settings.largeText),
            ),
          ),
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: 'High Contrast',
            selected: settings.highContrast,
            onPressed: () => onSettingsChanged(
              settings.copyWith(highContrast: !settings.highContrast),
            ),
          ),
        ],
      ),
      primaryAction: const MkButton(
        label: 'Continue',
        emphasis: MkButtonEmphasis.primary,
        onPressed: null,
      ),
    );
  }
}
