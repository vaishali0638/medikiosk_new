import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';

/// The token screen — the last thing a patient sees.
///
/// The token itself is rendered large enough to read from arm's length and to photograph.
/// That is deliberate: the printer is a convenience, and a patient whose slip never came
/// out must still leave holding something they can show at the door.
class TokenScreen extends StatelessWidget {
  const TokenScreen({
    required this.strings,
    required this.token,
    required this.departmentName,
    required this.onPrint,
    required this.onSendToMobile,
    required this.onFinish,
    this.room,
    this.queueStatus,
    this.printerAvailable = false,
    this.printFailed = false,
    this.sending = false,
    this.sentToMobile = false,
    super.key,
  });

  final KioskStrings strings;
  final String token;
  final String departmentName;
  final String? room;
  final String? queueStatus;
  final VoidCallback onPrint;
  final VoidCallback onSendToMobile;
  final VoidCallback onFinish;
  final bool printerAvailable;
  final bool printFailed;
  final bool sending;
  final bool sentToMobile;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    Widget detail(String label, String value) => Padding(
          padding: const EdgeInsets.only(bottom: MkSpacing.xs),
          child: Text(
            '$label: $value',
            textAlign: TextAlign.center,
            style: MkType.body.toTextStyle(
              color: MkColors.neutralText,
              scale: a11y.textScale,
            ),
          ),
        );

    return Scaffold(
      backgroundColor: MkColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Padding(
              padding: const EdgeInsets.all(MkSpacing.xl),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Icon(Icons.check_circle_outline, size: 72, color: MkColors.success),
                    const SizedBox(height: MkSpacing.md),
                    Semantics(
                      header: true,
                      child: Text(
                        strings['token.title'],
                        textAlign: TextAlign.center,
                        style: MkType.heading.toTextStyle(
                          color: MkColors.darkBlue,
                          scale: a11y.textScale,
                        ),
                      ),
                    ),
                    const SizedBox(height: MkSpacing.lg),
                    Text(
                      strings['token.yourToken'],
                      textAlign: TextAlign.center,
                      style: MkType.body.toTextStyle(
                        color: MkColors.mutedText,
                        scale: a11y.textScale,
                      ),
                    ),
                    const SizedBox(height: MkSpacing.sm),
                    // Deliberately the largest thing on screen: readable at arm's length
                    // and photographable, so the printer is never load-bearing.
                    Semantics(
                      label: '${strings['token.yourToken']} $token',
                      child: Text(
                        token,
                        textAlign: TextAlign.center,
                        style: MkType.display.toTextStyle(
                          color: MkColors.darkBlue,
                          scale: a11y.textScale * 1.4,
                        ),
                      ),
                    ),
                    const SizedBox(height: MkSpacing.lg),
                    detail(strings['token.department'], departmentName),
                    if (room != null) detail(strings['token.room'], room!),
                    if (queueStatus != null) detail(strings['token.queueStatus'], queueStatus!),
                    const SizedBox(height: MkSpacing.xl),

                    if (printerAvailable) ...<Widget>[
                      MkButton(
                        label: strings['token.print'],
                        icon: Icons.print_outlined,
                        onPressed: onPrint,
                      ),
                      const SizedBox(height: MkSpacing.md),
                    ],
                    if (printFailed) ...<Widget>[
                      // Stated calmly, and next to a token that is still perfectly valid.
                      Text(
                        strings['token.printFailed'],
                        textAlign: TextAlign.center,
                        style: MkType.caption.toTextStyle(
                          color: MkColors.mutedText,
                          scale: a11y.textScale,
                        ),
                      ),
                      const SizedBox(height: MkSpacing.md),
                    ],
                    MkButton(
                      label: sentToMobile
                          ? strings['token.sentToMobile']
                          : strings['token.sendToMobile'],
                      icon: sentToMobile ? Icons.check : Icons.smartphone,
                      selected: sentToMobile,
                      onPressed: sending || sentToMobile ? null : onSendToMobile,
                    ),
                    const SizedBox(height: MkSpacing.md),
                    MkButton(
                      label: strings['token.finish'],
                      emphasis: MkButtonEmphasis.primary,
                      onPressed: onFinish,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown when the hospital system could not confirm a token.
///
/// Never says the check-in failed, because it may well have succeeded — the outcome is
/// unknown, and the honest instruction is to ask a person.
class TokenPendingScreen extends StatelessWidget {
  const TokenPendingScreen({
    required this.strings,
    required this.onFinish,
    this.correlationId,
    super.key,
  });

  final KioskStrings strings;
  final VoidCallback onFinish;
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
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Icon(Icons.hourglass_empty, size: 72, color: MkColors.primaryBlue),
                    const SizedBox(height: MkSpacing.lg),
                    Semantics(
                      header: true,
                      child: Text(
                        strings['token.pending.title'],
                        textAlign: TextAlign.center,
                        style: MkType.heading.toTextStyle(
                          color: MkColors.darkBlue,
                          scale: a11y.textScale,
                        ),
                      ),
                    ),
                    const SizedBox(height: MkSpacing.md),
                    Text(
                      strings['token.pending.body'],
                      textAlign: TextAlign.center,
                      style: MkType.body.toTextStyle(
                        color: MkColors.neutralText,
                        scale: a11y.textScale,
                      ),
                    ),
                    const SizedBox(height: MkSpacing.xl),
                    MkButton(
                      label: strings['token.finish'],
                      emphasis: MkButtonEmphasis.primary,
                      onPressed: onFinish,
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
      ),
    );
  }
}
