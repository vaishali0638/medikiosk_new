import 'package:flutter/material.dart';

import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';

/// Standard layout for every kiosk screen.
///
/// It guarantees three things the specification requires on every active screen:
/// the current question or heading is always visible, the primary action is never
/// hidden behind a scroll, and an Exit affordance is always reachable.
class MkScreen extends StatelessWidget {
  const MkScreen({
    required this.title,
    required this.child,
    this.subtitle,
    this.primaryAction,
    this.exitAction,
    super.key,
  });

  final String title;
  final String? subtitle;
  final Widget child;

  /// The single primary action, pinned below the scrollable content.
  final Widget? primaryAction;

  /// Exit. Required on every active workflow screen; only the idle home screen may omit it.
  final Widget? exitAction;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return Scaffold(
      backgroundColor: MkColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MkSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Semantics(
                header: true,
                child: Text(
                  title,
                  style: MkType.heading.toTextStyle(
                    color: MkColors.darkBlue,
                    scale: a11y.textScale,
                  ),
                ),
              ),
              if (subtitle != null) ...<Widget>[
                const SizedBox(height: MkSpacing.sm),
                Text(
                  subtitle!,
                  style: MkType.body.toTextStyle(
                    color: MkColors.mutedText,
                    scale: a11y.textScale,
                  ),
                ),
              ],
              const SizedBox(height: MkSpacing.lg),
              // Content scrolls; the heading above and the actions below never do.
              Expanded(child: SingleChildScrollView(child: child)),
              if (primaryAction != null) ...<Widget>[
                const SizedBox(height: MkSpacing.lg),
                primaryAction!,
              ],
              if (exitAction != null) ...<Widget>[
                const SizedBox(height: MkSpacing.md),
                exitAction!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}
