import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// The AYUSH systems the specification names, with their string keys.
///
/// The list is fixed; which of them a patient actually sees is not. The server returns
/// only systems with both an enabled department and an approved module, and this screen
/// renders exactly what it was given.
enum AyushSystem {
  ayurveda('AYURVEDA', 'ayush.ayurveda'),
  unani('UNANI', 'ayush.unani'),
  siddha('SIDDHA', 'ayush.siddha'),
  yogaNaturopathy('YOGA_NATUROPATHY', 'ayush.yogaNaturopathy'),
  sowaRigpa('SOWA_RIGPA', 'ayush.sowaRigpa'),
  homoeopathy('HOMOEOPATHY', 'ayush.homoeopathy');

  const AyushSystem(this.wire, this.stringKey);

  final String wire;
  final String stringKey;

  static AyushSystem? fromWire(String value) {
    for (final AyushSystem s in AyushSystem.values) {
      if (s.wire == value) return s;
    }
    return null;
  }
}

/// AYUSH system selection.
///
/// "I am not sure" is offered with the same weight as every system, because a patient who
/// does not know which system of medicine they want is the normal case, not an edge case.
/// Choosing it does not block the visit — the common clinical core is collected either
/// way, and the doctor decides.
class AyushSelectionScreen extends StatelessWidget {
  const AyushSelectionScreen({
    required this.strings,
    required this.available,
    required this.selected,
    required this.onSelect,
    required this.onNotSure,
    required this.onContinue,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;

  /// Only systems the hospital has configured AND has an approved module for.
  final List<AyushSystem> available;

  final AyushSystem? selected;
  final ValueChanged<AyushSystem> onSelect;
  final VoidCallback onNotSure;
  final VoidCallback onContinue;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['ayush.title'],
      subtitle: strings['ayush.subtitle'],
      primaryAction: MkButton(
        label: strings['common.continue'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: selected == null ? null : onContinue,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final AyushSystem system in available) ...<Widget>[
            MkButton(
              label: strings[system.stringKey],
              selected: selected == system,
              onPressed: () => onSelect(system),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
          const SizedBox(height: MkSpacing.md),
          // Same weight as any system. Not knowing is the normal case.
          MkButton(
            label: strings['ayush.notSure'],
            onPressed: onNotSure,
          ),
        ],
      ),
    );
  }
}
