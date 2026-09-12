import 'package:flutter/foundation.dart';

/// A failure the kiosk can render.
///
/// [patientMessage] is the only field that may reach the screen: it comes from the
/// server's neutral message table, or from a local fallback for transport failures.
/// [code] and [correlationId] are for the on-screen support footer and logs.
@immutable
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.patientMessage,
    this.correlationId,
    this.statusCode,
  });

  /// The kiosk could not reach the server at all.
  const ApiException.network(this.correlationId)
      : code = 'NETWORK_UNAVAILABLE',
        patientMessage = 'The hospital system cannot be reached right now.',
        statusCode = null;

  final String code;
  final String patientMessage;
  final String? correlationId;
  final int? statusCode;

  bool get isNetworkFailure => code == 'NETWORK_UNAVAILABLE';
  bool get isSessionExpired => code == 'SESSION_EXPIRED';

  @override
  String toString() => 'ApiException($code, status: $statusCode, cid: $correlationId)';
}
