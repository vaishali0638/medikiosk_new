import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api/api_client.dart';
import 'api/api_exception.dart';
import 'config/kiosk_config.dart';
import 'l10n/kiosk_strings.dart';
import 'platform/kiosk_lock.dart';
import 'screens/dialogs.dart';
import 'screens/home_screen.dart';
import 'screens/language_screen.dart';
import 'screens/status_screens.dart';
import 'session/secure_wipe.dart';
import 'session/session_manager.dart';
import 'session/session_state.dart';
import 'theme/accessibility_settings.dart';
import 'theme/mk_theme.dart';

/// What the shell is currently showing.
enum ShellView { startup, home, language, expired, error, offline }

/// The kiosk shell: boot, lock-down, navigation, inactivity and session termination.
///
/// PHASE 3 SCOPE. The three patient journeys on the home screen (mobile QR, new
/// registration, existing check-in) are not built yet and are rendered inert rather than
/// hidden, so the specified home layout stays reviewable. They are wired in Phases 5–6.
class KioskApp extends StatefulWidget {
  const KioskApp({
    required this.api,
    required this.kioskLock,
    required this.wipeBuilder,
    super.key,
  });

  final ApiClient api;
  final KioskLock kioskLock;

  /// Builds the wipe once the shell can supply its UI-state clearers.
  final SecureWipe Function(List<VoidCallback> uiStateClearers) wipeBuilder;

  @override
  State<KioskApp> createState() => KioskAppState();
}

class KioskAppState extends State<KioskApp> with WidgetsBindingObserver {
  AccessibilitySettings _a11y = const AccessibilitySettings();
  ShellView _view = ShellView.startup;
  KioskConfig? _config;
  KioskLockState? _lockState;
  SessionManager? _sessions;
  String _languageTag = 'en';
  String? _pendingLanguageTag;
  String? _lastCorrelationId;
  String? _unavailableReason;
  bool _timeoutDialogOpen = false;

  KioskStrings get _strings => KioskStrings.of(_languageTag);

  @visibleForTesting
  ShellView get view => _view;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_boot());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sessions?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // A resume can follow a crash-restart or an MDM policy change, either of which can
    // silently drop lock-task mode. Re-engaging on resume is what makes the reboot
    // requirement hold in practice rather than only at first launch.
    if (state == AppLifecycleState.resumed) {
      unawaited(_engageLock());
    }
  }

  Future<void> _boot() async {
    await _engageLock();

    try {
      final Map<String, dynamic> json = await widget.api.get('/v1/kiosk/config');
      final KioskConfig config = KioskConfig.fromJson(json);

      final SessionManager sessions = SessionManager(
        api: widget.api,
        wipe: widget.wipeBuilder(<VoidCallback>[_clearUiState]),
        timing: config.session,
      )..addListener(_onSessionChanged);

      if (!mounted) return;
      setState(() {
        _config = config;
        _sessions = sessions;
        _view = ShellView.home;
        _unavailableReason = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _lastCorrelationId = error.correlationId;
        _view = ShellView.offline;
      });
    }
  }

  Future<void> _engageLock() async {
    final KioskLockState state = await widget.kioskLock.engage();
    if (!mounted) return;
    setState(() => _lockState = state);
  }

  /// Clears everything the shell itself holds about the current patient.
  /// Passed into the wipe so device clearing and UI clearing happen as one operation.
  void _clearUiState() {
    _pendingLanguageTag = null;
    _languageTag = 'en';
    _a11y = const AccessibilitySettings();
  }

  void _onSessionChanged() {
    final SessionManager? sessions = _sessions;
    if (sessions == null || !mounted) return;

    if (sessions.phase == SessionPhase.warning && !_timeoutDialogOpen) {
      unawaited(_showTimeoutWarning());
    }
    setState(() {});
  }

  Future<void> _showTimeoutWarning() async {
    final SessionManager? sessions = _sessions;
    final KioskConfig? config = _config;
    if (sessions == null || config == null) return;

    _timeoutDialogOpen = true;
    final bool stayed = await showTimeoutWarning(context, _strings, config.session.wipe);
    _timeoutDialogOpen = false;

    if (stayed) {
      sessions.recordActivity();
      return;
    }
    // The dialog closed because the session's own wipe timer fired and popped it, or the
    // patient did nothing. Either way SessionManager has already ended and wiped.
    if (mounted && !sessions.hasActiveSession) {
      setState(() => _view = ShellView.expired);
    }
  }

  Future<void> _startSessionAndSelectLanguage() async {
    final SessionManager? sessions = _sessions;
    if (sessions == null) return;

    try {
      if (!sessions.hasActiveSession) await sessions.start();
      if (!mounted) return;
      setState(() => _view = ShellView.language);
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  Future<void> _confirmLanguage() async {
    final SessionManager? sessions = _sessions;
    final String? tag = _pendingLanguageTag;
    if (sessions == null || tag == null) return;

    try {
      await sessions.selectLanguage(tag);
      if (!mounted) return;
      setState(() => _languageTag = tag);
      // Phase 4 continues into the consent flow. Until then the shell returns home,
      // rather than pretending there is a next step.
      await _endSession(SessionEndReason.completed, nextView: ShellView.home);
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  Future<void> _requestExit() async {
    final bool confirmed = await showExitConfirmation(context, _strings);
    if (!confirmed) {
      _sessions?.recordActivity();
      return;
    }
    await _endSession(SessionEndReason.exit, nextView: ShellView.home);
  }

  Future<void> _endSession(SessionEndReason reason, {required ShellView nextView}) async {
    final SessionManager? sessions = _sessions;
    if (sessions == null) return;

    final WipeReport report = await sessions.end(reason);
    if (!mounted) return;

    setState(() {
      _view = nextView;
      _languageTag = 'en';
      _pendingLanguageTag = null;
      _a11y = const AccessibilitySettings();
    });

    // A wipe that did not fully succeed is an operational fault, not a patient-facing
    // one. The patient sees the normal screen; the fault is visible to staff through the
    // banner and, because `wiped: true` was withheld, in the server's open-session sweep.
    if (!report.isComplete) {
      debugPrint('MediKiosk: incomplete wipe — ${report.failed.join(', ')}');
    }
  }

  void _handleApiFailure(ApiException error) {
    if (!mounted) return;
    setState(() {
      _lastCorrelationId = error.correlationId;
      _view = error.isNetworkFailure ? ShellView.offline : ShellView.error;
    });
  }

  @override
  Widget build(BuildContext context) {
    return AccessibilityScope(
      settings: _a11y,
      child: MaterialApp(
        title: 'MediKiosk',
        debugShowCheckedModeBanner: false,
        theme: MkTheme.build(highContrast: _a11y.highContrast, textScale: _a11y.textScale),
        home: _ActivityDetector(
          onActivity: () => _sessions?.recordActivity(),
          child: Stack(
            children: <Widget>[
              _buildView(),
              if (_lockState != null && !_lockState!.isFullyLockedDown)
                _LockdownWarningBanner(state: _lockState!),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildView() {
    switch (_view) {
      case ShellView.startup:
        return StartupScreen(strings: _strings, unavailableReason: _unavailableReason);

      case ShellView.home:
        return HomeScreen(
          strings: _strings,
          features: _config?.features ?? FeatureFlags.allDisabled,
          // Phases 5-6. Inert rather than hidden so the specified layout stays reviewable.
          onCheckInWithMobileQr: null,
          onNewRegistration: null,
          onExistingPatientCheckIn: null,
          onSelectLanguage: () => unawaited(_startSessionAndSelectLanguage()),
          onToggleAudioGuidance: () => setState(
            () => _a11y = _a11y.copyWith(audioGuidance: !_a11y.audioGuidance),
          ),
        );

      case ShellView.language:
        return LanguageScreen(
          strings: _strings,
          languages: _config?.languages ?? const <LanguageOption>[],
          selectedTag: _pendingLanguageTag,
          onSelect: (String tag) => setState(() => _pendingLanguageTag = tag),
          onContinue: () => unawaited(_confirmLanguage()),
          onExit: () => unawaited(_requestExit()),
          onToggleAudioGuidance: () => setState(
            () => _a11y = _a11y.copyWith(audioGuidance: !_a11y.audioGuidance),
          ),
          onToggleLargeText: () => setState(
            () => _a11y = _a11y.copyWith(largeText: !_a11y.largeText),
          ),
          onToggleHighContrast: () => setState(
            () => _a11y = _a11y.copyWith(highContrast: !_a11y.highContrast),
          ),
        );

      case ShellView.expired:
        return SessionExpiredScreen(
          strings: _strings,
          onStartAgain: () => setState(() => _view = ShellView.home),
        );

      case ShellView.error:
        return KioskErrorScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onStartAgain: () => setState(() => _view = ShellView.home),
        );

      case ShellView.offline:
        return NetworkUnavailableScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onRetry: () {
            setState(() => _view = ShellView.startup);
            unawaited(_boot());
          },
        );
    }
  }
}

/// Treats any touch anywhere as patient activity.
///
/// Uses [Listener] rather than [GestureDetector] so it observes pointer events without
/// competing in the gesture arena: a patient tapping a button must not have that tap
/// swallowed by the inactivity tracker.
class _ActivityDetector extends StatelessWidget {
  const _ActivityDetector({required this.onActivity, required this.child});

  final VoidCallback onActivity;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (PointerDownEvent _) => onActivity(),
      onPointerSignal: (PointerSignalEvent _) => onActivity(),
      child: child,
    );
  }
}

/// Staff-facing warning that the device is not fully locked down.
///
/// Deliberately small, in the corner, and in English: it is an operational message for
/// hospital IT, not something a patient needs to read or act on. It uses the internal
/// alert colour, which is the one place red is permitted.
class _LockdownWarningBanner extends StatelessWidget {
  const _LockdownWarningBanner({required this.state});

  final KioskLockState state;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: 0,
      right: 0,
      child: SafeArea(
        child: Semantics(
          liveRegion: true,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            color: const Color(0xFFC62828),
            child: const Text(
              'DEVICE NOT LOCKED DOWN',
              style: TextStyle(color: Color(0xFFFFFFFF), fontSize: 11, letterSpacing: 0.5),
            ),
          ),
        ),
      ),
    );
  }
}
