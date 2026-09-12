import 'package:flutter/material.dart';

import '../config/consent_notice.dart';
import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// The consent screen.
///
/// Shown before any clinical history, voice, document or AI processing. Everything the
/// patient reads here is governed content served by the API — the client composes none
/// of it, so the wording is always exactly what was approved and versioned.
///
/// Agree and decline are given equal visual weight below the summary. Making decline
/// quieter than agree would be a nudge, and consent that has been nudged is not freely
/// given.
class ConsentScreen extends StatelessWidget {
  const ConsentScreen({
    required this.strings,
    required this.notice,
    required this.onListen,
    required this.onReadFullNotice,
    required this.onAgree,
    required this.onDecline,
    required this.onExit,
    this.speaking = false,
    this.audioUnavailable = false,
    super.key,
  });

  final KioskStrings strings;
  final ConsentNotice notice;
  final VoidCallback onListen;
  final VoidCallback onReadFullNotice;
  final VoidCallback onAgree;
  final VoidCallback onDecline;
  final VoidCallback onExit;
  final bool speaking;

  /// Set when audio was requested but no voice is available for this language.
  final bool audioUnavailable;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: notice.title,
      // Both decisions are pinned below the scrollable summary. Pinning only Agree would
      // let Decline scroll out of view on a shorter screen, which is the nudge this
      // design exists to avoid: consent that has been nudged is not freely given.
      primaryAction: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          MkButton(
            label: strings['consent.agree'],
            emphasis: MkButtonEmphasis.primary,
            onPressed: onAgree,
          ),
          const SizedBox(height: MkSpacing.md),
          MkButton(label: strings['consent.decline'], onPressed: onDecline),
        ],
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            strings['consent.weWillCollect'],
            style: MkType.body.toTextStyle(color: MkColors.neutralText, scale: a11y.textScale),
          ),
          const SizedBox(height: MkSpacing.sm),
          for (final String item in notice.collectedItems)
            Padding(
              padding: const EdgeInsets.only(bottom: MkSpacing.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '•  ',
                    style: MkType.body.toTextStyle(
                      color: MkColors.primaryBlue,
                      scale: a11y.textScale,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      item,
                      style: MkType.body.toTextStyle(
                        color: MkColors.neutralText,
                        scale: a11y.textScale,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: MkSpacing.lg),
          Text(
            strings['consent.purpose'],
            style: MkType.caption.toTextStyle(color: MkColors.mutedText, scale: a11y.textScale),
          ),
          const SizedBox(height: MkSpacing.xs),
          Text(
            notice.purpose,
            style: MkType.body.toTextStyle(color: MkColors.neutralText, scale: a11y.textScale),
          ),
          const SizedBox(height: MkSpacing.lg),
          MkButton(
            label: speaking ? strings['consent.stopListening'] : strings['consent.listen'],
            icon: speaking ? Icons.stop_circle_outlined : Icons.volume_up,
            selected: speaking,
            onPressed: onListen,
          ),
          if (audioUnavailable) ...<Widget>[
            const SizedBox(height: MkSpacing.sm),
            // Stated plainly rather than left as a button that does nothing. A patient
            // relying on audio needs to know it is not available, not be left waiting.
            Text(
              strings['consent.audioUnavailable'],
              style: MkType.caption.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
          ],
          const SizedBox(height: MkSpacing.md),
          MkButton(
            label: strings['consent.readFullNotice'],
            icon: Icons.article_outlined,
            onPressed: onReadFullNotice,
          ),
          const SizedBox(height: MkSpacing.lg),
          Text(
            '${strings['consent.noticeVersion']}: ${notice.version}',
            style: MkType.caption.toTextStyle(color: MkColors.mutedText, scale: a11y.textScale),
          ),
        ],
      ),
    );
  }
}

/// The complete notice, behind "Read full notice".
class ConsentFullNoticeScreen extends StatelessWidget {
  const ConsentFullNoticeScreen({
    required this.strings,
    required this.notice,
    required this.onBack,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;
  final ConsentNotice notice;
  final VoidCallback onBack;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: notice.title,
      primaryAction: MkButton(
        label: strings['common.back'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: onBack,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SelectionArea(
            child: Text(
              notice.fullText,
              style: MkType.body.toTextStyle(
                color: MkColors.neutralText,
                scale: a11y.textScale,
              ),
            ),
          ),
          const SizedBox(height: MkSpacing.xl),
          Text(
            '${strings['consent.noticeVersion']}: ${notice.version}',
            style: MkType.caption.toTextStyle(color: MkColors.mutedText, scale: a11y.textScale),
          ),
          if (notice.approvedBy.isNotEmpty)
            Text(
              '${strings['consent.approvedBy']}: ${notice.approvedBy.join(', ')}',
              style: MkType.caption.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
        ],
      ),
    );
  }
}

/// Shown after a patient declines.
///
/// States the consequence and offers Exit only. There is deliberately no "are you sure"
/// and no second chance to agree: re-asking a patient who has just said no is pressure,
/// and the specification is explicit that intake stops here.
class ConsentDeclinedScreen extends StatelessWidget {
  const ConsentDeclinedScreen({required this.strings, required this.onExit, super.key});

  final KioskStrings strings;
  final VoidCallback onExit;

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
                      strings['consent.declined.title'],
                      textAlign: TextAlign.center,
                      style: MkType.heading.toTextStyle(
                        color: MkColors.darkBlue,
                        scale: a11y.textScale,
                      ),
                    ),
                  ),
                  const SizedBox(height: MkSpacing.md),
                  Text(
                    strings['consent.declined.body'],
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
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
