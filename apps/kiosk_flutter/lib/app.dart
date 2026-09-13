import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'api/api_exception.dart';
import 'config/consent_notice.dart';
import 'config/kiosk_config.dart';
import 'l10n/kiosk_strings.dart';
import 'platform/audio_guidance.dart';
import 'platform/qr_scanner.dart';
import 'platform/token_printer.dart';
import 'platform/kiosk_lock.dart';
import 'screens/arrival_screens.dart';
import 'screens/consent_screen.dart';
import 'screens/dialogs.dart';
import 'screens/home_screen.dart';
import 'screens/language_screen.dart';
import 'screens/status_screens.dart';
import 'screens/token_screen.dart';
import 'session/secure_wipe.dart';
import 'session/session_manager.dart';
import 'session/session_state.dart';
import 'theme/accessibility_settings.dart';
import 'theme/mk_theme.dart';

/// What the shell is currently showing.
enum ShellView {
  startup,
  home,
  language,
  consent,
  consentFullNotice,
  consentDeclined,
  consentUnavailable,
  scanQr,
  confirmVisit,
  changedSince,
  qrRejected,
  token,
  tokenPending,
  expired,
  error,
  offline,
}

/// The kiosk shell: boot, lock-down, navigation, inactivity and session termination.
///
/// PHASE 3 SCOPE. The three patient journeys on the home screen (mobile QR, new
/// registration, existing check-in) are not built yet and are rendered inert rather than
/// hidden, so the specified home layout stays reviewable. They are wired in Phases 5–6.
class KioskApp extends StatefulWidget {
  const KioskApp({
    required this.api,
    required this.kioskLock,
    required this.audio,
    required this.scanner,
    required this.printer,
    required this.wipeBuilder,
    super.key,
  });

  final ApiClient api;
  final KioskLock kioskLock;
  final AudioGuidance audio;
  final QrScanner scanner;
  final TokenPrinter printer;

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
  ConsentNotice? _notice;
  bool _speaking = false;
  bool _audioUnavailable = false;
  bool _busy = false;
  bool _cameraUnavailable = false;
  bool _declaringChanges = false;
  final Set<ChangedSection> _changedSections = <ChangedSection>{};
  String? _arrivalHandle;
  String? _arrivalMaskedName;
  String? _arrivalMaskedMobile;
  String? _arrivalHospital;
  String? _arrivalDepartment;
  String? _arrivalVisitType;
  String? _tokenHandle;
  String? _token;
  String? _tokenRoom;
  String? _tokenQueueStatus;
  bool _printerAvailable = false;
  bool _printFailed = false;

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
    _notice = null;
    _speaking = false;
    _audioUnavailable = false;
    _busy = false;
    _cameraUnavailable = false;
    _declaringChanges = false;
    _changedSections.clear();
    _arrivalHandle = null;
    _arrivalMaskedName = null;
    _arrivalMaskedMobile = null;
    _arrivalHospital = null;
    _arrivalDepartment = null;
    _arrivalVisitType = null;
    _tokenHandle = null;
    _token = null;
    _tokenRoom = null;
    _tokenQueueStatus = null;
    _printFailed = false;
    // A camera preview holds the last frames it saw. Release it with everything else.
    unawaited(widget.scanner.stop());
    // Audio must not carry from one patient into the next. Fire-and-forget: the wipe
    // reports on what it can verify, and a stuck TTS engine must not block it.
    unawaited(widget.audio.stop());
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
      await _loadConsentNotice(tag);
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  /// Fetches the published notice for the chosen language.
  ///
  /// There is no cross-language fallback. If nothing is published in this language the
  /// kiosk stops, because asking a patient to agree to wording they cannot read is not
  /// consent.
  Future<void> _loadConsentNotice(String language) async {
    try {
      final Map<String, dynamic> json =
          await widget.api.get('/v1/consents/notice?language=$language');
      if (!mounted) return;
      setState(() {
        _notice = ConsentNotice.fromJson(json);
        _audioUnavailable = false;
        _view = ShellView.consent;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.isNetworkFailure) {
        _handleApiFailure(error);
        return;
      }
      setState(() => _view = ShellView.consentUnavailable);
    }
  }

  /// Reads the notice aloud, or says plainly that it cannot.
  Future<void> _toggleListen() async {
    final ConsentNotice? notice = _notice;
    if (notice == null) return;

    if (_speaking) {
      await widget.audio.stop();
      if (mounted) setState(() => _speaking = false);
      return;
    }

    setState(() => _speaking = true);
    final SpeechResult result = await widget.audio.speak(
      text: '${notice.title}. ${notice.collectedItems.join('. ')}. ${notice.purpose}',
      languageTag: notice.language,
      approvedRecordingAvailable: notice.audioAvailable,
    );

    if (!mounted) return;
    setState(() {
      _speaking = result.spoke;
      // A patient relying on audio needs to be told it is unavailable, not left waiting
      // for a button that silently does nothing.
      _audioUnavailable = !result.spoke;
    });
  }

  Future<void> _recordConsent(String decision) async {
    final SessionManager? sessions = _sessions;
    final ConsentNotice? notice = _notice;
    if (sessions == null || notice == null) return;

    await widget.audio.stop();
    if (mounted) setState(() => _speaking = false);

    try {
      await widget.api.post(
        '/v1/consents?sessionId=${sessions.sessionId}',
        <String, dynamic>{'language': notice.language, 'decision': decision},
      );
      if (!mounted) return;

      if (decision == 'DECLINED') {
        // The server has already ended the session. The artefact survives; the screen
        // states the consequence and offers Exit only.
        setState(() => _view = ShellView.consentDeclined);
        return;
      }

      // Phase 5 continues into identity. Until then the shell completes the session
      // rather than pretending there is a next step.
      await _endSession(SessionEndReason.completed, nextView: ShellView.home);
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  /// Home -> scan. Starts a session first: the scan is the beginning of a patient's time
  /// at the kiosk, and the inactivity wipe has to be running from that moment.
  Future<void> _startMobileQrCheckIn() async {
    final SessionManager? sessions = _sessions;
    if (sessions == null) return;

    try {
      if (!sessions.hasActiveSession) await sessions.start();
      final bool available = await widget.scanner.isAvailable();
      if (!mounted) return;
      setState(() {
        _cameraUnavailable = !available;
        _view = ShellView.scanQr;
      });
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  Future<void> _scanQr() async {
    setState(() => _busy = true);
    final ScanResult scan = await widget.scanner.scan();
    await widget.scanner.stop();
    if (!mounted) return;

    if (scan.cameraUnavailable) {
      setState(() {
        _busy = false;
        _cameraUnavailable = true;
      });
      return;
    }
    if (scan.payload == null) {
      setState(() => _busy = false);
      return;
    }

    try {
      final Map<String, dynamic> json = await widget.api.post(
        '/v1/arrival/check-in',
        <String, dynamic>{
          'kioskId': widget.api.kioskDeviceCode,
          'qrPayload': scan.payload,
        },
      );
      if (!mounted) return;

      final Map<String, dynamic> masked = json['masked'] as Map<String, dynamic>;
      setState(() {
        _busy = false;
        _arrivalHandle = json['arrivalId'] as String;
        _arrivalMaskedName = masked['maskedName'] as String;
        _arrivalMaskedMobile = masked['maskedMobile'] as String;
        _arrivalHospital = json['hospitalName'] as String;
        _arrivalDepartment = json['departmentName'] as String;
        _arrivalVisitType = json['visitTypeLabel'] as String;
        _view = ShellView.confirmVisit;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.isNetworkFailure) {
        _handleApiFailure(error);
        return;
      }
      // Every QR failure lands here and looks the same. The reason is on the server.
      setState(() {
        _busy = false;
        _lastCorrelationId = error.correlationId;
        _view = ShellView.qrRejected;
      });
    }
  }

  /// Records the arrival and what the patient says has changed.
  Future<void> _confirmArrival() async {
    final String? handle = _arrivalHandle;
    if (handle == null) return;

    setState(() => _busy = true);
    try {
      final Map<String, dynamic> json =
          await widget.api.post('/v1/arrival/$handle/confirm', <String, dynamic>{
        'identityConfirmed': true,
        'changedSections':
            _changedSections.map((ChangedSection s) => s.wire).toList(growable: false),
      });
      if (!mounted) return;

      setState(() => _tokenHandle = json['tokenHandle'] as String);
      await _requestToken();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (error.isNetworkFailure) {
        _handleApiFailure(error);
        return;
      }
      setState(() {
        _lastCorrelationId = error.correlationId;
        _view = ShellView.qrRejected;
      });
    }
  }

  /// Asks the hospital for the token.
  ///
  /// Any outcome that is not an issued token sends the patient to the counter rather than
  /// retrying: the backend has already decided whether a retry is safe, and a kiosk that
  /// second-guessed that could produce a duplicate.
  Future<void> _requestToken() async {
    final String? handle = _tokenHandle;
    if (handle == null) return;

    setState(() => _busy = true);
    try {
      final Map<String, dynamic> json = await widget.api.post('/v1/arrival/$handle/token');
      final bool printerAvailable = await widget.printer.isAvailable();
      if (!mounted) return;

      setState(() {
        _busy = false;
        _token = json['token'] as String?;
        _tokenRoom = json['room'] as String?;
        _tokenQueueStatus = json['queueStatus'] as String?;
        _printerAvailable = printerAvailable;
        _view = _token == null ? ShellView.tokenPending : ShellView.token;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _lastCorrelationId = error.correlationId;
        _view = error.isNetworkFailure ? ShellView.offline : ShellView.tokenPending;
      });
    }
  }

  /// Printing is a convenience. A failure is reported beside a token that is still valid,
  /// and never changes the token's state.
  Future<void> _printToken() async {
    final String? token = _token;
    if (token == null) return;

    final PrintResult result = await widget.printer.printToken(
      TokenSlip(
        token: token,
        departmentName: _arrivalDepartment ?? '',
        room: _tokenRoom,
        queueStatus: _tokenQueueStatus,
      ),
    );
    if (!mounted) return;
    setState(() => _printFailed = !result.printed);
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
          onCheckInWithMobileQr: () => unawaited(_startMobileQrCheckIn()),
          // Phase 5's screens exist but are not yet wired into the shell journey.
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

      case ShellView.consent:
        final ConsentNotice? notice = _notice;
        if (notice == null) return StartupScreen(strings: _strings);
        return ConsentScreen(
          strings: _strings,
          notice: notice,
          speaking: _speaking,
          audioUnavailable: _audioUnavailable,
          onListen: () => unawaited(_toggleListen()),
          onReadFullNotice: () => setState(() => _view = ShellView.consentFullNotice),
          onAgree: () => unawaited(_recordConsent('GRANTED')),
          onDecline: () => unawaited(_recordConsent('DECLINED')),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.consentFullNotice:
        final ConsentNotice? notice = _notice;
        if (notice == null) return StartupScreen(strings: _strings);
        return ConsentFullNoticeScreen(
          strings: _strings,
          notice: notice,
          onBack: () => setState(() => _view = ShellView.consent),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.consentDeclined:
        return ConsentDeclinedScreen(
          strings: _strings,
          // The session is already ended and wiped server-side; Exit only clears the shell.
          onExit: () => unawaited(_endSession(SessionEndReason.exit, nextView: ShellView.home)),
        );

      case ShellView.consentUnavailable:
        return KioskErrorScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onStartAgain: () =>
              unawaited(_endSession(SessionEndReason.exit, nextView: ShellView.home)),
        );

      case ShellView.scanQr:
        return ScanQrScreen(
          strings: _strings,
          busy: _busy,
          cameraUnavailable: _cameraUnavailable,
          onScan: () => unawaited(_scanQr()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.confirmVisit:
        return ConfirmVisitScreen(
          strings: _strings,
          busy: _busy,
          maskedName: _arrivalMaskedName ?? '',
          maskedMobile: _arrivalMaskedMobile ?? '',
          hospitalName: _arrivalHospital ?? '',
          departmentName: _arrivalDepartment ?? '',
          visitTypeLabel: _arrivalVisitType ?? '',
          onConfirm: () => setState(() {
            _declaringChanges = false;
            _view = ShellView.changedSince;
          }),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.changedSince:
        return ChangedSinceScreen(
          strings: _strings,
          declaring: _declaringChanges,
          selected: _changedSections,
          onToggle: (ChangedSection section) => setState(() {
            if (!_changedSections.remove(section)) _changedSections.add(section);
          }),
          onNothingChanged: () => unawaited(_confirmArrival()),
          onContinue: () {
            if (_declaringChanges) {
              unawaited(_confirmArrival());
            } else {
              setState(() => _declaringChanges = true);
            }
          },
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.qrRejected:
        return QrRejectedScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onExit: () =>
              unawaited(_endSession(SessionEndReason.exit, nextView: ShellView.home)),
        );

      case ShellView.token:
        return TokenScreen(
          strings: _strings,
          token: _token ?? '',
          departmentName: _arrivalDepartment ?? '',
          room: _tokenRoom,
          queueStatus: _tokenQueueStatus,
          printerAvailable: _printerAvailable,
          printFailed: _printFailed,
          onPrint: () => unawaited(_printToken()),
          // Phase 12 wires the SMS send; offering it inert would promise something the
          // deployment cannot yet do.
          onSendToMobile: () {},
          onFinish: () =>
              unawaited(_endSession(SessionEndReason.completed, nextView: ShellView.home)),
        );

      case ShellView.tokenPending:
        return TokenPendingScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onFinish: () =>
              unawaited(_endSession(SessionEndReason.completed, nextView: ShellView.home)),
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
