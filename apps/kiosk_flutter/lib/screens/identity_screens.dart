import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_keypad.dart';
import '../widgets/mk_screen.dart';

/// New-patient registration method.
///
/// Mobile OTP is always offered. ABHA appears only when the hospital has enabled and
/// approved the integration — a disabled feature must not render at all, not even greyed
/// out, or patients will ask staff for something the deployment cannot do.
///
/// Neither ABHA, Aadhaar nor a smartphone is ever required for care.
class NewRegistrationMethodScreen extends StatelessWidget {
  const NewRegistrationMethodScreen({
    required this.strings,
    required this.onMobileOtp,
    required this.onExit,
    this.abhaEnabled = false,
    this.onScanAbha,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onMobileOtp;
  final VoidCallback onExit;
  final bool abhaEnabled;
  final VoidCallback? onScanAbha;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['identity.newRegistration.title'],
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          MkButton(
            label: strings['identity.mobileOtp'],
            emphasis: MkButtonEmphasis.primary,
            icon: Icons.sms_outlined,
            onPressed: onMobileOtp,
          ),
          if (abhaEnabled) ...<Widget>[
            const SizedBox(height: MkSpacing.md),
            MkButton(
              label: strings['identity.scanAbha'],
              icon: Icons.qr_code_scanner,
              onPressed: onScanAbha,
            ),
          ],
        ],
      ),
    );
  }
}

/// Existing-patient identification options.
///
/// Exactly the three specified routes. There is deliberately no token-entry option: a
/// token exists only once the hospital HIS has issued one, so a field to type one in
/// would invite patients to invent or reuse them.
class ExistingPatientMethodScreen extends StatelessWidget {
  const ExistingPatientMethodScreen({
    required this.strings,
    required this.onScanAppointmentQr,
    required this.onEnterUhid,
    required this.onEnterMobile,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback? onScanAppointmentQr;
  final VoidCallback onEnterUhid;
  final VoidCallback onEnterMobile;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['identity.existingPatient.title'],
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          MkButton(
            label: strings['identity.scanAppointmentQr'],
            icon: Icons.qr_code_scanner,
            onPressed: onScanAppointmentQr,
          ),
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['identity.enterUhid'],
            icon: Icons.badge_outlined,
            onPressed: onEnterUhid,
          ),
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['identity.enterMobile'],
            icon: Icons.phone_android,
            onPressed: onEnterMobile,
          ),
        ],
      ),
    );
  }
}

/// Ten-digit mobile entry, on the kiosk's own keypad.
class MobileEntryScreen extends StatelessWidget {
  const MobileEntryScreen({
    required this.strings,
    required this.value,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    required this.onSubmit,
    required this.onExit,
    this.busy = false,
    super.key,
  });

  static const int mobileLength = 10;

  final KioskStrings strings;
  final String value;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final VoidCallback onSubmit;
  final VoidCallback onExit;
  final bool busy;

  bool get _complete => value.length == mobileLength;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['identity.mobile.title'],
      subtitle: strings['identity.mobile.subtitle'],
      primaryAction: MkButton(
        label: strings['identity.sendCode'],
        emphasis: MkButtonEmphasis.primary,
        // Disabled until ten digits are present: a short number would produce a refusal
        // the patient cannot interpret.
        onPressed: _complete && !busy ? onSubmit : null,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        children: <Widget>[
          MkDigitDisplay(
            value: value,
            length: mobileLength,
            semanticLabel: strings['identity.mobile.title'],
          ),
          const SizedBox(height: MkSpacing.xl),
          MkKeypad(
            onDigit: (String d) => value.length < mobileLength ? onDigit(d) : null,
            onBackspace: onBackspace,
            onClear: onClear,
            enabled: !busy,
          ),
        ],
      ),
    );
  }
}

/// Six-digit one-time code entry.
class OtpEntryScreen extends StatelessWidget {
  const OtpEntryScreen({
    required this.strings,
    required this.maskedMobile,
    required this.value,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    required this.onSubmit,
    required this.onResend,
    required this.onExit,
    this.busy = false,
    this.canResend = true,
    this.attemptsRemaining,
    super.key,
  });

  static const int codeLength = 6;

  final KioskStrings strings;
  final String maskedMobile;
  final String value;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final VoidCallback onSubmit;
  final VoidCallback onResend;
  final VoidCallback onExit;
  final bool busy;
  final bool canResend;

  /// Shown once an attempt has failed, so a patient is not surprised by a lockout.
  final int? attemptsRemaining;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['identity.otp.title'],
      subtitle: '${strings['identity.otp.sentTo']} $maskedMobile',
      primaryAction: MkButton(
        label: strings['identity.verify'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: value.length == codeLength && !busy ? onSubmit : null,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        children: <Widget>[
          MkDigitDisplay(
            value: value,
            length: codeLength,
            semanticLabel: strings['identity.otp.title'],
          ),
          if (attemptsRemaining != null) ...<Widget>[
            const SizedBox(height: MkSpacing.md),
            Text(
              '$attemptsRemaining ${strings['identity.otp.attemptsRemaining']}',
              style: MkType.caption.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
          ],
          const SizedBox(height: MkSpacing.lg),
          MkKeypad(
            onDigit: (String d) => value.length < codeLength ? onDigit(d) : null,
            onBackspace: onBackspace,
            onClear: onClear,
            enabled: !busy,
          ),
          const SizedBox(height: MkSpacing.lg),
          MkButton(
            label: strings['identity.resendCode'],
            icon: Icons.refresh,
            onPressed: canResend && !busy ? onResend : null,
          ),
        ],
      ),
    );
  }
}

/// Hospital UHID entry.
///
/// A UHID can contain letters, so this uses a text field rather than the numeric keypad.
class UhidEntryScreen extends StatelessWidget {
  const UhidEntryScreen({
    required this.strings,
    required this.controller,
    required this.onSubmit,
    required this.onExit,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;
  final TextEditingController controller;
  final VoidCallback onSubmit;
  final VoidCallback onExit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['identity.uhid.title'],
      subtitle: strings['identity.uhid.subtitle'],
      primaryAction: ValueListenableBuilder<TextEditingValue>(
        valueListenable: controller,
        builder: (BuildContext context, TextEditingValue value, _) => MkButton(
          label: strings['common.continue'],
          emphasis: MkButtonEmphasis.primary,
          onPressed: value.text.trim().length >= 3 && !busy ? onSubmit : null,
        ),
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: TextField(
        controller: controller,
        enabled: !busy,
        autofocus: true,
        textCapitalization: TextCapitalization.characters,
        style: MkType.heading.toTextStyle(
          color: MkColors.neutralText,
          scale: a11y.textScale,
        ),
        decoration: InputDecoration(
          labelText: strings['identity.uhid.label'],
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(MkRadius.sm)),
          contentPadding: const EdgeInsets.all(MkSpacing.md),
        ),
      ),
    );
  }
}

/// Masked confirmation: the patient decides whether the record found is theirs.
///
/// The system proposes; the person standing there decides. Without this step a UHID typed
/// one digit wrong would silently open a stranger's record. Everything shown is masked,
/// because the kiosk stands in a public corridor.
class IdentityConfirmationScreen extends StatelessWidget {
  const IdentityConfirmationScreen({
    required this.strings,
    required this.maskedName,
    required this.maskedMobile,
    required this.onConfirm,
    required this.onExit,
    this.maskedUhid,
    this.busy = false,
    super.key,
  });

  final KioskStrings strings;
  final String maskedName;
  final String maskedMobile;
  final String? maskedUhid;
  final VoidCallback onConfirm;
  final VoidCallback onExit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.only(bottom: MkSpacing.sm),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              SizedBox(
                width: 160,
                child: Text(
                  label,
                  style: MkType.body.toTextStyle(
                    color: MkColors.mutedText,
                    scale: a11y.textScale,
                  ),
                ),
              ),
              Expanded(
                child: Text(
                  value,
                  style: MkType.body.toTextStyle(
                    color: MkColors.neutralText,
                    scale: a11y.textScale,
                  ),
                ),
              ),
            ],
          ),
        );

    return MkScreen(
      title: strings['identity.confirm.title'],
      subtitle: strings['identity.confirm.subtitle'],
      primaryAction: MkButton(
        label: strings['identity.confirm.yes'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: busy ? null : onConfirm,
      ),
      // No "this is not me" button: the answer to that is to stop, which Exit already
      // does. A separate control would only add a second way to end the same session.
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          row(strings['identity.confirm.name'], maskedName),
          row(strings['identity.confirm.mobile'], maskedMobile),
          if (maskedUhid != null) row(strings['identity.confirm.uhid'], maskedUhid!),
        ],
      ),
    );
  }
}

/// Shown when identity could not be confirmed, for any reason.
///
/// One screen for every failure — not found, ambiguous, too weak, expired code. The
/// distinction lives in the audit log. Telling a patient "we found two people with this
/// number" would disclose that a second person is registered here.
class IdentityNotConfirmedScreen extends StatelessWidget {
  const IdentityNotConfirmedScreen({
    required this.strings,
    required this.onExit,
    this.correlationId,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onExit;
  final String? correlationId;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Scaffold(
      backgroundColor: MkColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Padding(
              padding: const EdgeInsets.all(MkSpacing.xl),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const Icon(Icons.info_outline, size: 72, color: MkColors.primaryBlue),
                  const SizedBox(height: MkSpacing.lg),
                  Semantics(
                    header: true,
                    child: Text(
                      strings['identity.notConfirmed.title'],
                      textAlign: TextAlign.center,
                      style: MkType.heading.toTextStyle(
                        color: MkColors.darkBlue,
                        scale: a11y.textScale,
                      ),
                    ),
                  ),
                  const SizedBox(height: MkSpacing.md),
                  Text(
                    strings['identity.notConfirmed.body'],
                    textAlign: TextAlign.center,
                    style: MkType.body.toTextStyle(
                      color: MkColors.neutralText,
                      scale: a11y.textScale,
                    ),
                  ),
                  const SizedBox(height: MkSpacing.xl),
                  MkButton(
                    label: strings['common.exit'],
                    emphasis: MkButtonEmphasis.primary,
                    onPressed: onExit,
                  ),
                  if (correlationId != null) ...<Widget>[
                    const SizedBox(height: MkSpacing.xl),
                    Text(
                      '${strings['common.referenceCode']}: $correlationId',
                      textAlign: TextAlign.center,
                      style: MkType.caption.toTextStyle(
                        color: MkColors.mutedText,
                        scale: a11y.textScale,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
