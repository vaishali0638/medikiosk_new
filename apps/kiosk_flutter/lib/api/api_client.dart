import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'api_exception.dart';

/// Header names, mirroring @medikiosk/api-contracts.
const String kCorrelationIdHeader = 'x-correlation-id';
const String kKioskDeviceHeader = 'x-kiosk-device';
const String kIdempotencyKeyHeader = 'idempotency-key';

/// Generates a v4 UUID for correlation ids.
///
/// Uses [Random.secure] rather than the default generator: a predictable correlation id
/// would let anyone who can read one guess others and stitch journeys together in logs.
String generateCorrelationId() {
  final Random rng = Random.secure();
  final List<int> bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  String hex(int start, int end) =>
      bytes.sublist(start, end).map((int b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}

/// Typed HTTP client for the core API.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.kioskDeviceCode,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 10),
  }) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final String kioskDeviceCode;
  final http.Client _http;
  final Duration timeout;

  Future<Map<String, dynamic>> get(String path) => _send('GET', path, null);

  Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<Map<String, dynamic>> _send(
    String method,
    String path,
    Map<String, dynamic>? body,
  ) async {
    final String correlationId = generateCorrelationId();
    final Uri uri = Uri.parse('$baseUrl$path');
    final Map<String, String> headers = <String, String>{
      'content-type': 'application/json',
      kCorrelationIdHeader: correlationId,
      kKioskDeviceHeader: kioskDeviceCode,
    };

    http.Response response;
    try {
      final http.Request request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) request.body = jsonEncode(body);
      response = await http.Response.fromStream(await _http.send(request)).timeout(timeout);
    } on SocketException {
      throw ApiException.network(correlationId);
    } on HttpException {
      throw ApiException.network(correlationId);
    } on FormatException {
      throw ApiException.network(correlationId);
    } catch (_) {
      // Includes TimeoutException. Every transport failure looks the same to a patient.
      throw ApiException.network(correlationId);
    }

    Map<String, dynamic> decoded;
    try {
      // Decode the BYTES as UTF-8 rather than reading `response.body`, which falls back
      // to latin1 when the server omits a charset from its content-type. Consent notices
      // and language labels are Devanagari and Tamil; latin1 would mangle them, or throw.
      decoded = response.bodyBytes.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } on FormatException {
      throw ApiException(
        code: 'INTERNAL_ERROR',
        patientMessage: 'Something went wrong. Please start again.',
        correlationId: correlationId,
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;

    // The server already produced patient-safe text; the kiosk renders it rather than
    // composing its own, so one neutral wording is used everywhere.
    throw ApiException(
      code: (decoded['code'] as String?) ?? 'INTERNAL_ERROR',
      patientMessage:
          (decoded['patientMessage'] as String?) ?? 'Something went wrong. Please start again.',
      correlationId: (decoded['correlationId'] as String?) ?? correlationId,
      statusCode: response.statusCode,
    );
  }

  void close() => _http.close();
}
