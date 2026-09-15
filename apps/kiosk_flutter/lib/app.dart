import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'api/documents_api.dart';
import 'api/api_exception.dart';
import 'config/consent_notice.dart';
import 'config/kiosk_config.dart';
import 'l10n/indian_languages.dart';
import 'l10n/kiosk_strings.dart';
import 'platform/audio_guidance.dart';
import 'platform/qr_scanner.dart';
import 'platform/token_printer.dart';
import 'platform/kiosk_lock.dart';
import 'platform/document_camera.dart';
import 'screens/arrival_screens.dart';
import 'screens/ayush_screen.dart';
import 'screens/consent_screen.dart';
import 'screens/demographics_screen.dart';
import 'screens/department_screen.dart';
import 'screens/dialogs.dart';
import 'screens/document_screens.dart';
import 'screens/home_screen.dart';
import 'screens/identity_screens.dart';
import 'screens/language_screen.dart';
import 'screens/question_screen.dart';
import 'screens/review_screen.dart';
import 'screens/status_screens.dart';
import 'screens/token_screen.dart';
import 'config/question.dart';
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
  // The mobile-QR arrival: the intake already happened on the patient's phone.
  scanQr,
  confirmVisit,
  changedSince,
  qrRejected,
  // The kiosk-hosted journey, for a patient who arrives with nothing.
  identityMethod,
  identityMobile,
  identityOtp,
  identityUhid,
  identityConfirm,
  identityNotConfirmed,
  identityCounterOnly,
  demographics,
  department,
  ayush,
  question,
  addDocuments,
  documentType,
  imageQuality,
  ocrStatus,
  review,
  token,
  tokenPending,
  expired,
  error,
  offline,
}

/// Which of the two kiosk-hosted journeys the patient chose on the home screen.
///
/// They differ only in how identity is established — a new patient has no record to match
/// against — and converge from the demographics step onward.
enum JourneyKind { newRegistration, existingPatient }

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
    this.documentCamera = const UnavailableDocumentCamera(),
    super.key,
  });

  final ApiClient api;
  final KioskLock kioskLock;
  final AudioGuidance audio;
  final QrScanner scanner;
  final TokenPrinter printer;
  final DocumentCamera documentCamera;

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
  /// The screen and language last read aloud, so a rebuild does not repeat it.
  String? _lastAnnounced;
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

  // ---- the kiosk-hosted journey ----
  JourneyKind? _journey;
  final TextEditingController _uhidController = TextEditingController();
  String _mobileDigits = '';
  String _otpDigits = '';
  String? _maskedMobile;
  String? _verificationId;
  /// The resolved-but-unconfirmed candidate. Distinct from the OTP verification: one is
  /// "this phone answered", the other is "this is who the record says you are".
  String? _candidateId;
  String? _identityMaskedName;
  String? _identityMaskedUhid;
  int? _otpAttemptsRemaining;
  String? _preCheckinId;
  DepartmentOption? _department;
  AyushSystem? _ayushSelected;
  List<AyushSystem> _ayushAvailable = const <AyushSystem>[];
  Question? _question;
  int _answeredCount = 0;
  int _totalApplicable = 0;
  final Set<String> _selectedOptionIds = <String>{};
  String? _textAnswer;
  int? _scaleAnswer;
  List<AttachedDocument> _documents = const <AttachedDocument>[];
  CapturedDocument? _pendingCapture;
  List<String> _qualityProblems = const <String>[];
  bool _documentCaptureAvailable = false;

  /// True while a single question was reopened from the review screen, so answering it
  /// returns there instead of resuming the interview.
  bool _editingFromReview = false;
  List<ReviewItem> _reviewItems = const <ReviewItem>[];
  List<ReviewDocument> _reviewDocuments = const <ReviewDocument>[];

  /// A context from INSIDE the MaterialApp, for showing dialogs.
  ///
  /// `State.context` is the KioskApp element, which sits ABOVE the MaterialApp this build
  /// method creates — so it has no Navigator and no MaterialLocalizations, and
  /// `showDialog` against it throws. Every Exit button and the inactivity warning were
  /// silently doing nothing as a result: the exception was swallowed by the unawaited
  /// future behind the tap. The navigator key gives dialogs a context below the app.
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  KioskStrings get _strings => KioskStrings.of(_languageTag);

  /// Reading direction for the language in use, from the canonical registry.
  TextDirection get _textDirection =>
      findLanguage(_languageTag)?.direction ?? TextDirection.ltr;

  /// The department shown on the token. A mobile-QR arrival is told it by the server; a
  /// walk-in chose it here, and there is no arrival response to read it from.
  String get _departmentName => _arrivalDepartment ?? _department?.name ?? '';

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
    _uhidController.dispose();
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
    _journey = null;
    _uhidController.clear();
    _mobileDigits = '';
    _otpDigits = '';
    _maskedMobile = null;
    _verificationId = null;
    _candidateId = null;
    _identityMaskedName = null;
    _identityMaskedUhid = null;
    _otpAttemptsRemaining = null;
    _preCheckinId = null;
    _department = null;
    _ayushSelected = null;
    _ayushAvailable = const <AyushSystem>[];
    _question = null;
    _answeredCount = 0;
    _totalApplicable = 0;
    _selectedOptionIds.clear();
    _textAnswer = null;
    _scaleAnswer = null;
    _documents = const <AttachedDocument>[];
    // The captured image is a photograph of a patient's prescription held in memory.
    // Dropping the reference here is what keeps it out of the next patient's session.
    _pendingCapture = null;
    _qualityProblems = const <String>[];
    _documentCaptureAvailable = false;
    _editingFromReview = false;
    _reviewItems = const <ReviewItem>[];
    _reviewDocuments = const <ReviewDocument>[];
    // A camera preview holds the last frames it saw. Release it with everything else.
    unawaited(widget.scanner.stop());
    unawaited(widget.documentCamera.stop());
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
    final BuildContext? dialogContext = _navigatorKey.currentContext;
    if (dialogContext == null) return;
    final bool stayed = await showTimeoutWarning(dialogContext, _strings, config.session.wipe);
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

      if (!mounted) return;
      // Where consent leads depends on which door the patient came through. A mobile-QR
      // patient never reaches here — their consent was given on the phone.
      setState(() => _view = ShellView.identityMethod);
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
        departmentName: _departmentName,
        room: _tokenRoom,
        queueStatus: _tokenQueueStatus,
      ),
    );
    if (!mounted) return;
    setState(() => _printFailed = !result.printed);
  }

  // ---------------------------------------------------------------------------
  // The kiosk-hosted journey: identity -> demographics -> department -> AYUSH ->
  // intake -> documents -> review -> token.
  // ---------------------------------------------------------------------------

  /// Home -> language, remembering which journey the patient chose.
  ///
  /// Both journeys go through language and consent first. Asking someone to identify
  /// themselves before they have been told what the kiosk will do with their information
  /// is collecting an identifier without consent.
  Future<void> _startJourney(JourneyKind kind) async {
    final SessionManager? sessions = _sessions;
    if (sessions == null) return;

    try {
      if (!sessions.hasActiveSession) await sessions.start();
      if (!mounted) return;
      setState(() {
        _journey = kind;
        _view = ShellView.language;
      });
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  Future<void> _sendOtp() async {
    // The screen's own button is already gated on this; re-checked here because the
    // request must not be shaped by whatever last touched the state.
    if (!MobileEntryScreen.indianMobile.hasMatch(_mobileDigits)) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json = await widget.api.post(
        '/v1/identity/otp',
        <String, dynamic>{
          'mobile': _mobileDigits,
          // The purpose IS the journey. Sending the wrong one would have the server
          // treating a new registration as a lookup against records that do not exist.
          'purpose': _journey == JourneyKind.newRegistration
              ? 'NEW_REGISTRATION'
              : 'EXISTING_PATIENT_LOOKUP',
        },
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _otpDigits = '';
        _maskedMobile = json['maskedMobile'] as String?;
        _verificationId = json['verificationId'] as String?;
        _otpAttemptsRemaining = json['attemptsAllowed'] as int?;
        _view = ShellView.identityOtp;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _verifyOtp() async {
    final String? verificationId = _verificationId;
    if (verificationId == null || _otpDigits.length < 4) return;
    setState(() => _busy = true);

    try {
      await widget.api.post(
        '/v1/identity/otp/verify',
        <String, dynamic>{'verificationId': verificationId, 'code': _otpDigits},
      );
      if (!mounted) return;
      setState(() => _busy = false);

      // A new patient has no record to match against, so they go straight to giving
      // their details. An existing patient is looked up and asked to confirm.
      if (_journey == JourneyKind.newRegistration) {
        setState(() => _view = ShellView.demographics);
        return;
      }
      await _resolveIdentity(<String, dynamic>{
        'method': 'MOBILE_OTP',
        'verificationId': verificationId,
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _otpDigits = '';
      });
      if (error.isNetworkFailure) {
        _handleApiFailure(error);
        return;
      }
      // A mistyped digit is not a failed identification.
      //
      // Every outcome used to land on "we could not confirm your details — speak to the
      // counter", which made the five attempts the server grants unreachable: one wrong
      // digit in a six-digit code ended the journey, on a screen that was already built to
      // display the attempts remaining. Collapsing the outcomes was right about not
      // telling the patient WHICH kind of failure occurred; it was wrong about sending
      // them away for the one failure that is entirely normal.
      //
      // RATE_LIMITED is the server saying the attempts are gone. That, and anything
      // unexpected, still ends the attempt. A plain refusal keeps the patient on the
      // keypad.
      final bool exhausted = error.code == 'RATE_LIMITED';
      final int? remaining =
          _otpAttemptsRemaining == null ? null : _otpAttemptsRemaining! - 1;

      if (exhausted || remaining == null || remaining <= 0) {
        setState(() {
          _lastCorrelationId = error.correlationId;
          _view = ShellView.identityNotConfirmed;
        });
        return;
      }

      // Counted down locally for DISPLAY only. The server remains the authority on
      // whether another attempt is allowed; this number just stops the patient guessing
      // in the dark, and if the two ever disagree the server's refusal is what happens.
      setState(() {
        _lastCorrelationId = error.correlationId;
        _otpAttemptsRemaining = remaining;
      });
    }
  }

  Future<void> _resolveByUhid() async {
    final String uhid = _uhidController.text.trim();
    if (uhid.length < 3) return;
    await _resolveIdentity(<String, dynamic>{'method': 'UHID', 'uhid': uhid});
  }

  /// Looks up the patient and asks them to confirm a masked summary.
  ///
  /// The system proposes and the person standing there decides. A UHID typed one digit
  /// wrong would otherwise open a stranger's record without anyone noticing.
  Future<void> _resolveIdentity(Map<String, dynamic> body) async {
    final SessionManager? sessions = _sessions;
    if (sessions == null) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json = await widget.api.post(
        '/v1/identity/resolve?sessionId=${sessions.sessionId}',
        body,
      );
      if (!mounted) return;

      final Map<String, dynamic>? masked = json['masked'] as Map<String, dynamic>?;
      if (masked == null) {
        setState(() {
          _busy = false;
          _view = ShellView.identityNotConfirmed;
        });
        return;
      }

      setState(() {
        _busy = false;
        _candidateId = json['candidateId'] as String?;
        _identityMaskedName = masked['maskedName'] as String?;
        _maskedMobile = masked['maskedMobile'] as String? ?? _maskedMobile;
        _identityMaskedUhid = masked['maskedUhid'] as String?;
        _view = ShellView.identityConfirm;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (error.isNetworkFailure) {
        _handleApiFailure(error);
        return;
      }
      setState(() {
        _lastCorrelationId = error.correlationId;
        _view = ShellView.identityNotConfirmed;
      });
    }
  }

  Future<void> _confirmIdentity() async {
    final SessionManager? sessions = _sessions;
    final String? candidateId = _candidateId;
    if (sessions == null || candidateId == null) return;
    setState(() => _busy = true);

    try {
      await widget.api.post(
        '/v1/identity/confirm?sessionId=${sessions.sessionId}',
        <String, dynamic>{'candidateId': candidateId, 'isMe': true},
      );
      if (!mounted) return;
      setState(() => _busy = false);
      _goToDepartment();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _submitDemographics(Demographics details) async {
    final SessionManager? sessions = _sessions;
    final String? verificationId = _verificationId;
    if (sessions == null || verificationId == null) return;
    setState(() => _busy = true);

    try {
      await widget.api.post(
        '/v1/identity/register?sessionId=${sessions.sessionId}',
        <String, dynamic>{
          'verificationId': verificationId,
          'name': details.name,
          'sex': details.sex.wire,
          'ageYears': details.ageYears,
          if (details.address != null) 'address': details.address,
        },
      );
      if (!mounted) return;
      setState(() => _busy = false);
      _goToDepartment();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  /// A single department needs no choosing. Most OPD kiosks stand outside one.
  void _goToDepartment() {
    final List<DepartmentOption> departments = _config?.departments ?? <DepartmentOption>[];
    if (departments.length == 1) {
      unawaited(_openVisit(departments.first));
      return;
    }
    setState(() => _view = ShellView.department);
  }

  /// Opens the visit every clinical step downstream is keyed on.
  Future<void> _openVisit(DepartmentOption department) async {
    final SessionManager? sessions = _sessions;
    if (sessions == null) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json = await widget.api.post(
        '/v1/kiosk/sessions/${sessions.sessionId}/visit',
        <String, dynamic>{'departmentCode': department.code},
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _department = department;
        _preCheckinId = json['preCheckinId'] as String;
      });
      await _loadAyushSystems();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  /// Offers only systems with an approved module. A system with none is not shown at all.
  Future<void> _loadAyushSystems() async {
    try {
      final Map<String, dynamic> json =
          await widget.api.get('/v1/intakes/ayush-systems?language=$_languageTag');
      final List<AyushSystem> systems = ((json['systems'] as List<dynamic>?) ?? <dynamic>[])
          .map((dynamic e) => AyushSystem.fromWire(e as String))
          .whereType<AyushSystem>()
          .toList(growable: false);
      if (!mounted) return;

      // Nothing approved to choose between: the interview is the common clinical core,
      // and putting up a selection screen with no options would be a dead end.
      if (systems.isEmpty) {
        setState(() => _ayushAvailable = systems);
        await _loadNextQuestion();
        return;
      }
      setState(() {
        _ayushAvailable = systems;
        _view = ShellView.ayush;
      });
    } on ApiException catch (error) {
      _handleApiFailure(error);
    }
  }

  Future<void> _loadNextQuestion() async {
    final String? preCheckinId = _preCheckinId;
    if (preCheckinId == null) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json =
          await widget.api.get('/v1/intakes/$preCheckinId/next?language=$_languageTag');
      if (!mounted) return;

      final bool complete = json['complete'] as bool? ?? false;
      if (complete) {
        setState(() {
          _busy = false;
          _question = null;
        });
        await _startDocuments();
        return;
      }

      setState(() {
        _busy = false;
        _question = Question.fromJson(json['question'] as Map<String, dynamic>);
        _answeredCount = json['answeredCount'] as int? ?? _answeredCount;
        _totalApplicable = json['totalApplicable'] as int? ?? _totalApplicable;
        _selectedOptionIds.clear();
        _textAnswer = null;
        _scaleAnswer = null;
        _view = ShellView.question;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _submitAnswer({List<String>? nonCommittal}) async {
    final String? preCheckinId = _preCheckinId;
    final Question? question = _question;
    if (preCheckinId == null || question == null) return;
    setState(() => _busy = true);

    final List<String> optionIds = nonCommittal ?? _selectedOptionIds.toList(growable: false);

    try {
      await widget.api.post(
        '/v1/intakes/$preCheckinId/answers?language=$_languageTag',
        <String, dynamic>{
          'questionId': question.id,
          'selectedOptionIds': optionIds,
          if (_textAnswer != null && _textAnswer!.trim().isNotEmpty)
            'value': _textAnswer!.trim(),
          if (_scaleAnswer != null) 'value': _scaleAnswer,
          // A spoken answer and a tapped one are different evidence, and the doctor is
          // told which this was. Voice intake is not wired up, so everything here is TOUCH.
          'source': optionIds.isEmpty ? 'PATIENT_REPORTED' : 'PATIENT_SELECTED',
          'modality': 'TOUCH',
          'language': _languageTag,
        },
      );
      if (!mounted) return;
      if (_editingFromReview) {
        setState(() => _editingFromReview = false);
        await _loadReview();
        return;
      }
      await _loadNextQuestion();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _startDocuments() async {
    final bool available = await widget.documentCamera.isAvailable();
    if (!mounted) return;
    setState(() {
      _documentCaptureAvailable = available;
      _view = ShellView.addDocuments;
    });
  }

  Future<void> _captureDocument(CaptureMethod method) async {
    setState(() => _busy = true);
    final CapturedDocument? captured = await widget.documentCamera.capture();
    await widget.documentCamera.stop();
    if (!mounted) return;

    if (captured == null) {
      setState(() => _busy = false);
      return;
    }
    setState(() {
      _busy = false;
      _pendingCapture = captured;
      _qualityProblems = captured.qualityProblems;
      // The quality screen is informational and skipped when nothing was detected. It
      // never blocks: a poor scan the doctor can squint at beats no scan at all.
      _view =
          captured.qualityProblems.isEmpty ? ShellView.documentType : ShellView.imageQuality;
    });
  }

  Future<void> _uploadDocument(DocumentKind kind) async {
    final String? preCheckinId = _preCheckinId;
    final CapturedDocument? captured = _pendingCapture;
    if (preCheckinId == null || captured == null) return;
    setState(() => _busy = true);

    try {
      await DocumentsApi(widget.api).upload(
        preCheckinId: preCheckinId,
        kind: kind,
        contentType: captured.contentType,
        bytes: captured.bytes,
      );
      if (!mounted) return;
      setState(() {
        // Dropped as soon as it is stored: the kiosk has no reason to keep a photograph
        // of a prescription in memory once the server has it.
        _pendingCapture = null;
        _qualityProblems = const <String>[];
      });
      await _refreshDocuments();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _pendingCapture = null;
      });
      if (error.isNetworkFailure) {
        _handleApiFailure(error);
        return;
      }
      // A refused document is not a failed session. The patient carries on, and the
      // reason stays on the server.
      await _refreshDocuments();
    }
  }

  Future<void> _refreshDocuments() async {
    final String? preCheckinId = _preCheckinId;
    if (preCheckinId == null) return;

    try {
      final List<AttachedDocument> documents =
          await DocumentsApi(widget.api).list(preCheckinId);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _documents = documents;
        _view = ShellView.addDocuments;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _loadReview() async {
    final String? preCheckinId = _preCheckinId;
    if (preCheckinId == null) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json =
          await widget.api.get('/v1/precheckins/$preCheckinId/review?language=$_languageTag');
      if (!mounted) return;

      setState(() {
        _busy = false;
        _reviewItems = ((json['items'] as List<dynamic>?) ?? <dynamic>[])
            .cast<Map<String, dynamic>>()
            .map(
              (Map<String, dynamic> row) => ReviewItem(
                questionId: row['questionId'] as String,
                prompt: row['prompt'] as String,
                answered: row['answered'] as bool? ?? false,
                display: row['display'] as String?,
                provenance: row['provenance'] as String?,
              ),
            )
            .toList(growable: false);
        _reviewDocuments = ((json['documents'] as List<dynamic>?) ?? <dynamic>[])
            .cast<Map<String, dynamic>>()
            .map(
              (Map<String, dynamic> row) => ReviewDocument(
                label: row['label'] as String? ?? '',
                awaitingReview: row['extractionState'] == 'AWAITING_CLINICIAN_REVIEW',
              ),
            )
            .toList(growable: false);
        _view = ShellView.review;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  /// Reopens one question from the review screen, then returns here.
  Future<void> _editAnswer(String questionId) async {
    final String? preCheckinId = _preCheckinId;
    if (preCheckinId == null) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json = await widget.api
          .get('/v1/intakes/$preCheckinId/question/$questionId?language=$_languageTag');
      if (!mounted) return;
      setState(() {
        _busy = false;
        _question = Question.fromJson(json['question'] as Map<String, dynamic>);
        _selectedOptionIds.clear();
        _textAnswer = null;
        _scaleAnswer = null;
        _editingFromReview = true;
        _view = ShellView.question;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _submitIntake() async {
    final String? preCheckinId = _preCheckinId;
    if (preCheckinId == null) return;
    setState(() => _busy = true);

    try {
      final Map<String, dynamic> json = await widget.api.post(
        '/v1/precheckins/$preCheckinId/submit-intake',
        <String, dynamic>{'reviewConfirmed': true, 'language': _languageTag},
      );
      if (!mounted) return;

      final String? handle = json['tokenHandle'] as String?;
      if (handle == null) {
        // Submitted, but this visit has no kiosk-confirmed arrival to hang a token on.
        // The information reached the doctor; the counter completes the check-in.
        setState(() {
          _busy = false;
          _view = ShellView.tokenPending;
        });
        return;
      }
      setState(() => _tokenHandle = handle);
      await _requestToken();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _handleApiFailure(error);
    }
  }

  Future<void> _requestExit() async {
    final BuildContext? dialogContext = _navigatorKey.currentContext;
    // No navigator yet means nothing is on screen to exit from.
    if (dialogContext == null) return;
    final bool confirmed = await showExitConfirmation(dialogContext, _strings);
    if (!confirmed) {
      _sessions?.recordActivity();
      return;
    }
    await _endSession(SessionEndReason.exit, nextView: ShellView.home);
  }

  Future<void> _endSession(SessionEndReason reason, {required ShellView nextView}) async {
    final SessionManager? sessions = _sessions;

    // A session that never started still has to let the patient leave. Returning early
    // here stranded them on whatever screen they were on, with a button that did nothing.
    final WipeReport? report = await sessions?.end(reason);
    if (!mounted) return;

    setState(() {
      _view = nextView;
      _languageTag = 'en';
      _pendingLanguageTag = null;
      _a11y = const AccessibilitySettings();
      // Belt and braces with _toggleAudioGuidance: the next patient's first press must
      // speak, whatever screen the last one left behind.
      _lastAnnounced = null;
    });

    // A wipe that did not fully succeed is an operational fault, not a patient-facing
    // one. The patient sees the normal screen; the fault is visible to staff through the
    // banner and, because `wiped: true` was withheld, in the server's open-session sweep.
    if (report != null && !report.isComplete) {
      debugPrint('MediKiosk: incomplete wipe — ${report.failed.join(', ')}');
    }
  }

  /// Turns spoken guidance on or off.
  ///
  /// Both directions do more than flip the flag. Switching OFF stops mid-sentence, because
  /// a patient who turns the voice off wants it to stop rather than finish. Switching ON
  /// clears the last-announced key, because the current screen is exactly what they have
  /// just asked to hear.
  ///
  /// Clearing the key is also what makes the feature work for the SECOND patient of the
  /// day. The key used to survive the session wipe, so whoever pressed Audio Guidance on
  /// the home screen after somebody else had already done so got silence, and no way from
  /// inside the kiosk to fix it.
  void _toggleAudioGuidance() {
    final bool enabling = !_a11y.audioGuidance;
    setState(() {
      _a11y = _a11y.copyWith(audioGuidance: enabling);
      _lastAnnounced = null;
    });
    if (!enabling) unawaited(widget.audio.stop());
  }

  /// Reads the current screen's heading aloud when Audio Guidance is on.
  ///
  /// Before this, the Audio Guidance button set a flag and nothing else: the only screen
  /// that ever spoke was the consent notice, behind its own "Listen" control. A patient
  /// who cannot read turned on a feature named Audio Guidance and got silence for the
  /// whole journey.
  ///
  /// What is spoken is SHELL text — the screen title and its instruction. Clinical
  /// content is not read from here: the consent notice has its own control, which labels
  /// device speech as synthetic rather than passing it off as the approved recording, and
  /// questionnaire wording is governed content that a reviewer has to approve per
  /// language before it is spoken at all.
  void _announceScreen() {
    if (!_a11y.audioGuidance) return;

    final String key = '${_view.name}/$_languageTag';
    if (key == _lastAnnounced) return;
    _lastAnnounced = key;

    final String? text = _headingFor(_view);
    if (text == null) {
      // A screen with nothing to announce must still silence the one before it. Speaking
      // flushes the engine on its own, so this is the only path where the previous
      // screen's prompt would otherwise carry on over the new one.
      unawaited(widget.audio.stop());
      return;
    }

    // Fire and forget is right here and only here: nothing downstream depends on the
    // result, the engine flushes the previous utterance itself, and a patient must never
    // wait on a screen for a voice to finish.
    unawaited(widget.audio.speak(text: text, languageTag: _languageTag));
  }

  /// The shell heading for a screen, in the patient's language.
  ///
  /// Returns null for screens whose entire content is a value rather than a sentence —
  /// reading "Question" aloud with no question is worse than saying nothing.
  String? _headingFor(ShellView view) {
    switch (view) {
      case ShellView.startup:
        return _strings['startup.title'];
      case ShellView.home:
        return '${_strings['app.title']}. ${_strings['app.tagline']}. '
            '${_strings['home.touchToBegin']}';
      case ShellView.language:
        return _strings['language.title'];
      case ShellView.consent:
      case ShellView.consentFullNotice:
        // The notice itself is spoken only through its own labelled control.
        return _strings['consent.listen'];
      case ShellView.consentDeclined:
        return _strings['consent.declined.title'];
      case ShellView.consentUnavailable:
        return _strings['consent.unavailable.title'];
      case ShellView.scanQr:
        return '${_strings['arrival.scan.title']}. ${_strings['arrival.scan.subtitle']}';
      case ShellView.confirmVisit:
        return _strings['arrival.confirm.title'];
      case ShellView.changedSince:
        return _strings['arrival.changed.title'];
      case ShellView.qrRejected:
        return '${_strings['arrival.rejected.title']}. ${_strings['arrival.rejected.body']}';
      case ShellView.identityMethod:
        return _strings['identity.existingPatient.title'];
      case ShellView.identityMobile:
        return '${_strings['identity.mobile.title']}. ${_strings['identity.mobile.subtitle']}';
      case ShellView.identityOtp:
        return _strings['identity.otp.title'];
      case ShellView.identityUhid:
        return '${_strings['identity.uhid.title']}. ${_strings['identity.uhid.subtitle']}';
      case ShellView.identityConfirm:
        return _strings['identity.confirm.title'];
      case ShellView.identityNotConfirmed:
      case ShellView.identityCounterOnly:
        return '${_strings['identity.notConfirmed.title']}. '
            '${_strings['identity.notConfirmed.body']}';
      case ShellView.demographics:
        return _strings['demographics.title'];
      case ShellView.department:
        return '${_strings['department.title']}. ${_strings['department.subtitle']}';
      case ShellView.ayush:
        return '${_strings['ayush.title']}. ${_strings['ayush.subtitle']}';
      case ShellView.addDocuments:
        return '${_strings['documents.title']}. ${_strings['documents.subtitle']}';
      case ShellView.documentType:
        return _strings['documents.whatIsThis'];
      case ShellView.imageQuality:
        return _strings['documents.qualityTitle'];
      case ShellView.review:
        return '${_strings['review.title']}. ${_strings['review.subtitle']}';
      case ShellView.token:
        return _strings['token.title'];
      case ShellView.tokenPending:
        return '${_strings['token.pending.title']}. ${_strings['token.pending.body']}';
      case ShellView.expired:
        return '${_strings['expired.title']}. ${_strings['expired.body']}';
      case ShellView.error:
        return '${_strings['error.title']}. ${_strings['error.body']}';
      case ShellView.offline:
        return '${_strings['offline.title']}. ${_strings['offline.body']}';
      case ShellView.question:
      case ShellView.ocrStatus:
        // Content-only screens: the question text is governed content and is not read by
        // the shell, and OCR status is a progress indicator with nothing to announce.
        return null;
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
    // After the frame, not during it: speaking is a side effect and build must stay pure.
    WidgetsBinding.instance.addPostFrameCallback((_) => _announceScreen());

    return AccessibilityScope(
      settings: _a11y,
      child: MaterialApp(
        title: 'MediKiosk',
        navigatorKey: _navigatorKey,
        debugShowCheckedModeBanner: false,
        theme: MkTheme.build(highContrast: _a11y.highContrast, textScale: _a11y.textScale),
        // Urdu, Kashmiri and Sindhi read right to left, and that is a LAYOUT property, not
        // just a text one. Without this the words render correctly and everything around
        // them — the primary action, the back control, the order of a row of options —
        // stays mirrored the wrong way, which is harder to use than plain English would be.
        builder: (BuildContext context, Widget? child) => Directionality(
          textDirection: _textDirection,
          child: child ?? const SizedBox.shrink(),
        ),
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
          onNewRegistration: () => unawaited(_startJourney(JourneyKind.newRegistration)),
          onExistingPatientCheckIn: () => unawaited(_startJourney(JourneyKind.existingPatient)),
          onSelectLanguage: () => unawaited(_startSessionAndSelectLanguage()),
          onToggleAudioGuidance: _toggleAudioGuidance,
        );

      case ShellView.language:
        return LanguageScreen(
          strings: _strings,
          languages: _config?.languages ?? const <LanguageOption>[],
          selectedTag: _pendingLanguageTag,
          onSelect: (String tag) => setState(() => _pendingLanguageTag = tag),
          onContinue: () => unawaited(_confirmLanguage()),
          onExit: () => unawaited(_requestExit()),
          onToggleAudioGuidance: _toggleAudioGuidance,
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
          departmentName: _departmentName,
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
          onExit: () => unawaited(_endSession(SessionEndReason.exit, nextView: ShellView.home)),
        );

      case ShellView.identityMethod:
        return _journey == JourneyKind.newRegistration
            ? NewRegistrationMethodScreen(
                strings: _strings,
                abhaEnabled: _config?.features.abha ?? false,
                onMobileOtp: () => setState(() {
                  _mobileDigits = '';
                  _view = ShellView.identityMobile;
                }),
                onExit: () => unawaited(_requestExit()),
              )
            : ExistingPatientMethodScreen(
                strings: _strings,
                // Appointment-QR check-in is the mobile-QR journey by another name, so it
                // rejoins that path rather than duplicating it.
                onScanAppointmentQr: () => unawaited(_startMobileQrCheckIn()),
                onEnterUhid: () => setState(() {
                  _uhidController.clear();
                  _view = ShellView.identityUhid;
                }),
                // A mobile number is offered because the specification lists it, but a
                // one-time code proves possession of a handset and not identity, so it
                // cannot release an existing record — see MINIMUM_RELEASE_STRENGTH. The
                // patient is told that here rather than after entering ten digits and a
                // code, which is the same refusal delivered two screens later.
                onEnterMobile: () => setState(
                  () => _view = ShellView.identityCounterOnly,
                ),
                onExit: () => unawaited(_requestExit()),
              );

      case ShellView.identityMobile:
        return MobileEntryScreen(
          strings: _strings,
          value: _mobileDigits,
          busy: _busy,
          onDigit: (String digit) => setState(() {
            if (_mobileDigits.length < 10) _mobileDigits += digit;
          }),
          onBackspace: () => setState(() {
            if (_mobileDigits.isNotEmpty) {
              _mobileDigits = _mobileDigits.substring(0, _mobileDigits.length - 1);
            }
          }),
          onClear: () => setState(() => _mobileDigits = ''),
          onSubmit: () => unawaited(_sendOtp()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.identityOtp:
        return OtpEntryScreen(
          strings: _strings,
          maskedMobile: _maskedMobile ?? '',
          value: _otpDigits,
          busy: _busy,
          attemptsRemaining: _otpAttemptsRemaining,
          onDigit: (String digit) => setState(() {
            if (_otpDigits.length < 6) _otpDigits += digit;
          }),
          onBackspace: () => setState(() {
            if (_otpDigits.isNotEmpty) {
              _otpDigits = _otpDigits.substring(0, _otpDigits.length - 1);
            }
          }),
          onClear: () => setState(() => _otpDigits = ''),
          onSubmit: () => unawaited(_verifyOtp()),
          onResend: () => unawaited(_sendOtp()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.identityUhid:
        return UhidEntryScreen(
          strings: _strings,
          controller: _uhidController,
          busy: _busy,
          onSubmit: () => unawaited(_resolveByUhid()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.identityConfirm:
        return IdentityConfirmationScreen(
          strings: _strings,
          maskedName: _identityMaskedName ?? '',
          maskedMobile: _maskedMobile ?? '',
          maskedUhid: _identityMaskedUhid,
          busy: _busy,
          onConfirm: () => unawaited(_confirmIdentity()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.identityNotConfirmed:
        return IdentityNotConfirmedScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.identityCounterOnly:
        // Deliberately the same wording as a failed match. A patient learns nothing about
        // whether the hospital holds a record for that number, and neither does anyone
        // else standing at the kiosk trying numbers.
        return IdentityNotConfirmedScreen(
          strings: _strings,
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.demographics:
        return DemographicsScreen(
          strings: _strings,
          maskedMobile: _maskedMobile ?? '',
          busy: _busy,
          onSubmit: (Demographics details) => unawaited(_submitDemographics(details)),
          onBack: () => setState(() => _view = ShellView.identityMobile),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.department:
        return DepartmentScreen(
          strings: _strings,
          departments: _config?.departments ?? const <DepartmentOption>[],
          busy: _busy,
          onSelect: (DepartmentOption department) => unawaited(_openVisit(department)),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.ayush:
        return AyushSelectionScreen(
          strings: _strings,
          available: _ayushAvailable,
          selected: _ayushSelected,
          onSelect: (AyushSystem system) => setState(() => _ayushSelected = system),
          // "I am not sure" is a real answer, not a skip. The doctor decides with them,
          // and the interview continues on the common clinical core either way.
          onNotSure: () => unawaited(_loadNextQuestion()),
          onContinue: () => unawaited(_loadNextQuestion()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.question:
        final Question? question = _question;
        if (question == null) return StartupScreen(strings: _strings);
        return QuestionScreen(
          strings: _strings,
          question: question,
          selectedOptionIds: _selectedOptionIds,
          answeredCount: _answeredCount,
          totalApplicable: _totalApplicable,
          busy: _busy,
          textValue: _textAnswer,
          scaleValue: _scaleAnswer,
          onToggleOption: (String id) => setState(() {
            if (question.isMultiSelect) {
              _selectedOptionIds.contains(id)
                  ? _selectedOptionIds.remove(id)
                  : _selectedOptionIds.add(id);
            } else {
              _selectedOptionIds
                ..clear()
                ..add(id);
            }
          }),
          onTextChanged: (String value) => setState(() => _textAnswer = value),
          onScaleChanged: (int value) => setState(() => _scaleAnswer = value),
          onNonCommittal: (NonCommittal answer) =>
              unawaited(_submitAnswer(nonCommittal: <String>[answer.wire])),
          onContinue: () => unawaited(_submitAnswer()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.addDocuments:
        return AddDocumentsScreen(
          strings: _strings,
          attached: _documents,
          cameraAvailable: _documentCaptureAvailable,
          onCapture: (CaptureMethod method) => unawaited(_captureDocument(method)),
          // Declaring "I have no documents" and continuing lead to the same next screen.
          // They differ in what the patient is saying, not in where they end up.
          onNoDocuments: () => unawaited(_loadReview()),
          onContinue: () => unawaited(_loadReview()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.documentType:
        return DocumentTypeScreen(
          strings: _strings,
          onSelect: (DocumentKind kind) => unawaited(_uploadDocument(kind)),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.imageQuality:
        return ImageQualityScreen(
          strings: _strings,
          problems: _qualityProblems,
          onUseAnyway: () => setState(() => _view = ShellView.documentType),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.ocrStatus:
        return OcrStatusScreen(
          strings: _strings,
          attached: _documents,
          onContinue: () => unawaited(_loadReview()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.review:
        return ReviewScreen(
          strings: _strings,
          items: _reviewItems,
          documents: _reviewDocuments,
          submitting: _busy,
          onEdit: (String questionId) => unawaited(_editAnswer(questionId)),
          onSubmit: () => unawaited(_submitIntake()),
          onExit: () => unawaited(_requestExit()),
        );

      case ShellView.token:
        return TokenScreen(
          strings: _strings,
          token: _token ?? '',
          departmentName: _departmentName,
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
          // The screen says "This session has been cleared". It has to be true before the
          // patient reads it, and it was not: this used to change the view and nothing
          // else. The failed session stayed live with the previous patient's consent and
          // identity context, and whatever they touched next was refused by the server as
          // an illegal transition — straight back here, with no way out but the timeout.
          onStartAgain: () =>
              unawaited(_endSession(SessionEndReason.error, nextView: ShellView.home)),
        );

      case ShellView.offline:
        return NetworkUnavailableScreen(
          strings: _strings,
          correlationId: _lastCorrelationId,
          onRetry: () {
            // Same reasoning as Start again. The network may have dropped mid-journey, so
            // the session on the device is of unknown standing to the server; the honest
            // move is to end it and boot clean rather than resume against it.
            setState(() => _view = ShellView.startup);
            unawaited(() async {
              await _endSession(SessionEndReason.error, nextView: ShellView.startup);
              await _boot();
            }());
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
