import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../config/kiosk_config.dart';
import 'secure_wipe.dart';
import 'session_state.dart';

/// Where the shell currently is, from the UI's point of view.
enum SessionPhase {
  /// No patient. The home screen is showing.
  idle,

  /// A patient is partway through a journey.
  active,

  /// The inactivity warning is on screen; the patient can still continue.
  warning,

  /// The session ended and was wiped. The shell returns to idle.
  ended,
}

/// Owns the kiosk session lifecycle: start, inactivity, wipe and termination.
///
/// Two rules shape everything here:
///
/// 1. **Wipe before reporting.** The device is cleared first, and only a complete wipe is
///    reported to the server as `wiped: true`. If the wipe fails the server is told
///    nothing and the failure is surfaced, because a session recorded as cleanly closed
///    while data remains on the device is worse than a session left open in the audit log.
///
/// 2. **The wipe always runs.** A network failure while ending a session must not leave
///    the previous patient's data on screen, so the local wipe is never conditional on
///    the server call succeeding.
class SessionManager extends ChangeNotifier {
  SessionManager({
    required ApiClient api,
    required SecureWipe wipe,
    required SessionTiming timing,
  })  : _api = api,
        _wipe = wipe,
        _timing = timing;

  final ApiClient _api;
  final SecureWipe _wipe;
  SessionTiming _timing;

  String? _sessionId;
  KioskSessionState _state = KioskSessionState.exited;
  SessionPhase _phase = SessionPhase.idle;
  String? _language;
  WipeReport? _lastWipeReport;

  Timer? _warningTimer;
  Timer? _wipeTimer;
  Timer? _heartbeatTimer;

  String? get sessionId => _sessionId;
  KioskSessionState get state => _state;
  SessionPhase get phase => _phase;
  String? get language => _language;
  bool get hasActiveSession => _sessionId != null && !_state.isTerminal;

  /// The most recent wipe result. Exposed so the shell can raise an operational warning
  /// when a wipe was incomplete.
  WipeReport? get lastWipeReport => _lastWipeReport;

  /// Applies hospital-configured timings once configuration has loaded.
  void applyTiming(SessionTiming timing) {
    _timing = timing;
    if (_phase == SessionPhase.active) _restartInactivityTimers();
  }

  /// Starts a session for a patient who has just touched the kiosk.
  Future<void> start() async {
    // Never stack sessions: an unfinished one is wiped before a new patient begins.
    if (hasActiveSession) await end(SessionEndReason.exit);

    final Map<String, dynamic> json = await _api.post('/v1/kiosk/sessions');
    _sessionId = json['sessionId'] as String;
    _state = KioskSessionState.fromWire(json['state'] as String);
    _phase = SessionPhase.active;
    _language = null;
    _lastWipeReport = null;
    _restartInactivityTimers();
    notifyListeners();
  }

  /// Records the language chosen for this session.
  Future<void> selectLanguage(String tag) async {
    final String? id = _sessionId;
    if (id == null) return;

    final Map<String, dynamic> json =
        await _api.post('/v1/kiosk/sessions/$id/language', <String, dynamic>{'language': tag});
    _state = KioskSessionState.fromWire(json['state'] as String);
    _language = tag;
    _restartInactivityTimers();
    notifyListeners();
  }

  /// Called on every patient interaction.
  ///
  /// Resets the local timers immediately and tells the server at most once per heartbeat
  /// interval. Debouncing matters: an on-screen keyboard produces an event per keystroke,
  /// and a request each time would flood the network the token request has to share.
  void recordActivity() {
    if (!hasActiveSession) return;

    final bool wasWarning = _phase == SessionPhase.warning;
    _phase = SessionPhase.active;
    _restartInactivityTimers();

    if (_heartbeatTimer == null) {
      _sendHeartbeat();
      _heartbeatTimer = Timer(const Duration(seconds: 15), () => _heartbeatTimer = null);
    }
    if (wasWarning) notifyListeners();
  }

  /// Ends the session: wipe the device, then tell the server.
  ///
  /// Safe to call more than once — a local timeout followed by a patient pressing Exit
  /// is an ordinary sequence, and the second call is a no-op.
  Future<WipeReport> end(SessionEndReason reason) async {
    _cancelTimers();

    final String? id = _sessionId;
    _sessionId = null;
    _language = null;
    _state =
        reason == SessionEndReason.timeout ? KioskSessionState.expired : KioskSessionState.exited;
    _phase = SessionPhase.ended;

    // Local wipe first, and unconditionally. Whatever the network does, this patient's
    // data does not survive on the device.
    final WipeReport report = await _wipe.wipe();
    _lastWipeReport = report;

    if (id != null && report.isComplete) {
      try {
        await _api.post('/v1/kiosk/sessions/$id/end', <String, dynamic>{
          'reason': reason.wire,
          'wiped': true,
        });
      } on ApiException {
        // The server sweeps abandoned sessions on its own timer, so a failure here is
        // recoverable. Nothing is retried in the patient's path.
      }
    }

    _phase = SessionPhase.idle;
    notifyListeners();
    return report;
  }

  void _restartInactivityTimers() {
    _warningTimer?.cancel();
    _wipeTimer?.cancel();

    _warningTimer = Timer(_timing.warning, () {
      if (!hasActiveSession) return;
      _phase = SessionPhase.warning;
      notifyListeners();
    });

    // Fires at warning + wipe from the last activity, so the patient always gets the
    // full warning window before anything is cleared.
    _wipeTimer = Timer(_timing.total, () {
      if (!hasActiveSession) return;
      unawaited(end(SessionEndReason.timeout));
    });
  }

  void _sendHeartbeat() {
    final String? id = _sessionId;
    if (id == null) return;
    // Fire and forget: a dropped heartbeat costs a shorter idle window, not correctness.
    unawaited(
      _api.post('/v1/kiosk/sessions/$id/activity').catchError((Object _) => <String, dynamic>{}),
    );
  }

  void _cancelTimers() {
    _warningTimer?.cancel();
    _wipeTimer?.cancel();
    _heartbeatTimer?.cancel();
    _warningTimer = null;
    _wipeTimer = null;
    _heartbeatTimer = null;
  }

  @override
  void dispose() {
    _cancelTimers();
    super.dispose();
  }
}
