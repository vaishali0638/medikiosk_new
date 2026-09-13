import 'package:flutter/material.dart';

import '../config/kiosk_config.dart';
import '../l10n/kiosk_strings.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';
import '../theme/design_tokens.dart';

/// Which department the visit is opened against.
///
/// A patient arriving with a mobile QR never sees this — their department was chosen on
/// the phone and is bound into the signed code. It exists for the walk-in, whose visit has
/// to be created here and needs a department to be created against.
///
/// The kiosk offers only what the server sent, and the server sends only enabled
/// departments on this kiosk's own branch. Both ends check: the list is a convenience, not
/// the control.
class DepartmentScreen extends StatelessWidget {
  const DepartmentScreen({
    required this.strings,
    required this.departments,
    required this.onSelect,
    required this.onExit,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;
  final List<DepartmentOption> departments;
  final ValueChanged<DepartmentOption> onSelect;
  final VoidCallback onExit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['department.title'],
      subtitle: strings['department.subtitle'],
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final DepartmentOption department in departments) ...<Widget>[
            MkButton(
              label: department.name,
              onPressed: busy ? null : () => onSelect(department),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
        ],
      ),
    );
  }
}
