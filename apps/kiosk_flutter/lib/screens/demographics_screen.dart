import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// Sex, as the hospital record stores it.
///
/// `PREFER_NOT_TO_SAY` is offered because the alternative is a patient inventing an answer
/// to get past a screen, and a wrong value in the record is worse than a missing one.
enum PatientSex {
  female('FEMALE', 'demographics.female'),
  male('MALE', 'demographics.male'),
  other('OTHER', 'demographics.other'),
  preferNotToSay('PREFER_NOT_TO_SAY', 'demographics.preferNot');

  const PatientSex(this.wire, this.stringKey);

  final String wire;
  final String stringKey;
}

/// What the patient entered.
@immutable
class Demographics {
  const Demographics({
    required this.name,
    required this.sex,
    required this.ageYears,
    this.address,
  });

  final String name;
  final PatientSex sex;
  final int ageYears;
  final String? address;
}

/// "Basic patient details" — master prompt §11.
///
/// Age in years rather than a date of birth. Many patients at a government OPD do not know
/// their date of birth, and a date picker that must be satisfied produces a confident,
/// fabricated 01-01-1970 in the record. An age the patient is sure of is more use to a
/// clinician than a precise date they guessed. The API accepts either.
///
/// Email is omitted entirely. It is optional in the specification, it is not used anywhere
/// in this system, and asking for a contact detail with no purpose is collecting personal
/// data for its own sake.
class DemographicsScreen extends StatefulWidget {
  const DemographicsScreen({
    required this.strings,
    required this.maskedMobile,
    required this.onSubmit,
    required this.onBack,
    required this.onExit,
    this.addressRequired = false,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;

  /// The verified number, shown masked so the patient can see it is the one they used.
  final String maskedMobile;

  final ValueChanged<Demographics> onSubmit;
  final VoidCallback onBack;
  final VoidCallback onExit;

  /// Hospital policy. Off by default: an address is not needed to be seen.
  final bool addressRequired;
  final bool busy;

  @override
  State<DemographicsScreen> createState() => _DemographicsScreenState();
}

class _DemographicsScreenState extends State<DemographicsScreen> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _age = TextEditingController();
  final TextEditingController _address = TextEditingController();
  PatientSex? _sex;

  @override
  void dispose() {
    _name.dispose();
    _age.dispose();
    _address.dispose();
    super.dispose();
  }

  int? get _parsedAge {
    final int? age = int.tryParse(_age.text.trim());
    return age != null && age >= 0 && age <= 130 ? age : null;
  }

  bool get _complete =>
      _name.text.trim().isNotEmpty &&
      _sex != null &&
      _parsedAge != null &&
      (!widget.addressRequired || _address.text.trim().isNotEmpty);

  void _submit() {
    final int? age = _parsedAge;
    final PatientSex? sex = _sex;
    if (age == null || sex == null) return;

    widget.onSubmit(
      Demographics(
        name: _name.text.trim(),
        sex: sex,
        ageYears: age,
        address: _address.text.trim().isEmpty ? null : _address.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final KioskStrings strings = widget.strings;
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['demographics.title'],
      primaryAction: MkButton(
        label: strings['common.continue'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: _complete && !widget.busy ? _submit : null,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: widget.onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _field(
            context,
            label: strings['demographics.name'],
            controller: _name,
            capitalization: TextCapitalization.words,
          ),
          const SizedBox(height: MkSpacing.md),

          _field(
            context,
            label: strings['demographics.age'],
            controller: _age,
            keyboardType: TextInputType.number,
            formatters: <TextInputFormatter>[
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(3),
            ],
          ),
          const SizedBox(height: MkSpacing.lg),

          Text(
            strings['demographics.sex'],
            style: MkType.body.toTextStyle(
              color: MkColors.neutralText,
              scale: a11y.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.sm),
          Wrap(
            spacing: MkSpacing.sm,
            runSpacing: MkSpacing.sm,
            children: <Widget>[
              for (final PatientSex option in PatientSex.values)
                SizedBox(
                  width: 220,
                  child: MkButton(
                    label: strings[option.stringKey],
                    selected: _sex == option,
                    onPressed: () => setState(() => _sex = option),
                  ),
                ),
            ],
          ),
          const SizedBox(height: MkSpacing.lg),

          if (widget.addressRequired) ...<Widget>[
            _field(
              context,
              label: strings['demographics.address'],
              controller: _address,
              capitalization: TextCapitalization.sentences,
              maxLines: 2,
            ),
            const SizedBox(height: MkSpacing.lg),
          ],

          // Shown, not editable. Changing it here would silently detach the record from
          // the number that was actually verified by OTP a moment ago.
          Text(
            '${strings['demographics.mobile']}: ${widget.maskedMobile}',
            style: MkType.caption.toTextStyle(
              color: MkColors.mutedText,
              scale: a11y.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['common.back'],
            emphasis: MkButtonEmphasis.quiet,
            onPressed: widget.busy ? null : widget.onBack,
          ),
        ],
      ),
    );
  }

  Widget _field(
    BuildContext context, {
    required String label,
    required TextEditingController controller,
    TextCapitalization capitalization = TextCapitalization.none,
    TextInputType? keyboardType,
    List<TextInputFormatter>? formatters,
    int maxLines = 1,
  }) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return TextField(
      controller: controller,
      enabled: !widget.busy,
      textCapitalization: capitalization,
      keyboardType: keyboardType,
      inputFormatters: formatters,
      maxLines: maxLines,
      onChanged: (_) => setState(() {}),
      style: MkType.body.toTextStyle(color: MkColors.neutralText, scale: a11y.textScale),
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(MkRadius.sm)),
        contentPadding: const EdgeInsets.all(MkSpacing.md),
      ),
    );
  }
}

/// "A similar hospital record was found." — master prompt §11.
///
/// The patient decides, and the wording never says which record or whose. Merging on a
/// name match is how two people called Ravi Kumar end up sharing a medical history.
class PossibleDuplicateScreen extends StatelessWidget {
  const PossibleDuplicateScreen({
    required this.strings,
    required this.onThisIsMe,
    required this.onNotMe,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onThisIsMe;
  final VoidCallback onNotMe;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['demographics.duplicate.title'],
      subtitle: strings['demographics.duplicate.body'],
      // Neither answer is primary. Presenting "this is me" as the expected choice would
      // nudge a patient into claiming a record that is not theirs.
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          MkButton(label: strings['demographics.duplicate.isMe'], onPressed: onThisIsMe),
          const SizedBox(height: MkSpacing.md),
          MkButton(label: strings['demographics.duplicate.notMe'], onPressed: onNotMe),
        ],
      ),
    );
  }
}
