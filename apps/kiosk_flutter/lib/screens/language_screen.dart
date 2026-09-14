import 'package:flutter/material.dart';

import '../config/kiosk_config.dart';
import '../l10n/indian_languages.dart';
import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// Language and accessibility selection.
///
/// Only languages the server returned are offered, and the server returns only
/// clinically reviewed ones. The kiosk asserts the same rule again here rather than
/// trusting the payload, because rendering an unreviewed translation as if it were
/// approved clinical wording is a governance failure regardless of where the mistake
/// originated.
class LanguageScreen extends StatelessWidget {
  const LanguageScreen({
    required this.strings,
    required this.languages,
    required this.selectedTag,
    required this.onSelect,
    required this.onContinue,
    required this.onExit,
    required this.onToggleAudioGuidance,
    required this.onToggleLargeText,
    required this.onToggleHighContrast,
    super.key,
  });

  final KioskStrings strings;
  final List<LanguageOption> languages;
  final String? selectedTag;
  final ValueChanged<String> onSelect;
  final VoidCallback? onContinue;
  final VoidCallback onExit;
  final VoidCallback onToggleAudioGuidance;
  final VoidCallback onToggleLargeText;
  final VoidCallback onToggleHighContrast;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);
    final List<LanguageOption> offerable =
        languages.where((LanguageOption l) => l.clinicallyReviewed).toList(growable: false);

    return MkScreen(
      title: strings['language.title'],
      primaryAction: MkButton(
        label: strings['language.continue'],
        emphasis: MkButtonEmphasis.primary,
        // Disabled rather than hidden until a language is chosen, so the layout the
        // patient is reading does not move underneath them.
        onPressed: selectedTag == null ? null : onContinue,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // Two per row: large targets, and the endonym stays readable at large text sizes.
          Wrap(
            spacing: MkSpacing.md,
            runSpacing: MkSpacing.md,
            children: <Widget>[
              for (final LanguageOption language in offerable)
                SizedBox(
                  width: 280,
                  child: MkButton(
                    label: _labelFor(language),
                    selected: language.tag == selectedTag,
                    semanticLabel: _semanticLabelFor(language),
                    onPressed: () => onSelect(language.tag),
                  ),
                ),
            ],
          ),
          const SizedBox(height: MkSpacing.xl),
          const Divider(color: MkColors.border, height: MkSpacing.xl),
          _AccessibilityToggle(
            label: strings['language.audioGuidance'],
            icon: Icons.volume_up,
            enabled: a11y.audioGuidance,
            onToggle: onToggleAudioGuidance,
            strings: strings,
          ),
          const SizedBox(height: MkSpacing.md),
          _AccessibilityToggle(
            label: strings['language.largeText'],
            icon: Icons.format_size,
            enabled: a11y.largeText,
            onToggle: onToggleLargeText,
            strings: strings,
          ),
          const SizedBox(height: MkSpacing.md),
          _AccessibilityToggle(
            label: strings['language.highContrast'],
            icon: Icons.contrast,
            enabled: a11y.highContrast,
            onToggle: onToggleHighContrast,
            strings: strings,
          ),
        ],
      ),
    );
  }

  /// What the button says.
  ///
  /// The endonym comes from the canonical registry, not from the server payload. A
  /// hospital administrator typing language labels into a config table will sooner or
  /// later type "Odia" in Latin script, and a patient who reads only Odia cannot find
  /// their language in a list written in an alphabet they do not read. The registry knows
  /// the name is ଓଡ଼ିଆ and that is not a per-hospital decision.
  ///
  /// Scripts with no font on a stock Android device — Meetei Mayek, Ol Chiki — get the
  /// English name appended, so that a kiosk which has not had the font installed shows
  /// "▯▯▯▯ (Manipuri)" rather than a row of empty boxes with nothing to identify it.
  static String _labelFor(LanguageOption option) {
    final IndianLanguage? known = findLanguage(option.tag);
    if (known == null) return option.label;
    return known.needsBundledFont ? '${known.endonym} (${known.englishName})' : known.endonym;
  }

  /// Screen readers and staff get the English name and the tag; patients get the endonym.
  static String _semanticLabelFor(LanguageOption option) {
    final IndianLanguage? known = findLanguage(option.tag);
    if (known == null) return '${option.label} (${option.tag})';
    return '${known.endonym}, ${known.englishName} (${known.tag})';
  }
}

class _AccessibilityToggle extends StatelessWidget {
  const _AccessibilityToggle({
    required this.label,
    required this.icon,
    required this.enabled,
    required this.onToggle,
    required this.strings,
  });

  final String label;
  final IconData icon;
  final bool enabled;
  final VoidCallback onToggle;
  final KioskStrings strings;

  @override
  Widget build(BuildContext context) {
    final String stateLabel = enabled ? strings['language.on'] : strings['language.off'];
    return MkButton(
      label: '$label: $stateLabel',
      icon: icon,
      selected: enabled,
      semanticLabel: '$label, $stateLabel',
      onPressed: onToggle,
    );
  }
}
