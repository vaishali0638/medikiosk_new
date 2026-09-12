/// Kiosk session states. Mirrors `kiosk_session_state` in the database and
/// `KIOSK_SESSION_STATES` in @medikiosk/api-contracts.
enum KioskSessionState {
  created('CREATED'),
  languageSelected('LANGUAGE_SELECTED'),
  consentPending('CONSENT_PENDING'),
  consentGranted('CONSENT_GRANTED'),
  identityPending('IDENTITY_PENDING'),
  identityConfirmed('IDENTITY_CONFIRMED'),
  intakeInProgress('INTAKE_IN_PROGRESS'),
  reviewPending('REVIEW_PENDING'),
  submitted('SUBMITTED'),
  tokenPending('TOKEN_PENDING'),
  tokenIssued('TOKEN_ISSUED'),
  exited('EXITED'),
  expired('EXPIRED'),
  error('ERROR');

  const KioskSessionState(this.wire);

  /// The value exchanged with the server.
  final String wire;

  static KioskSessionState fromWire(String value) {
    return KioskSessionState.values.firstWhere(
      (KioskSessionState state) => state.wire == value,
      orElse: () => KioskSessionState.error,
    );
  }

  bool get isTerminal =>
      this == KioskSessionState.exited ||
      this == KioskSessionState.expired;
}

/// Why a session ended. Every reason wipes; the distinction is for monitoring.
enum SessionEndReason {
  exit('EXIT'),
  timeout('TIMEOUT'),
  completed('COMPLETED'),
  error('ERROR');

  const SessionEndReason(this.wire);

  final String wire;
}
