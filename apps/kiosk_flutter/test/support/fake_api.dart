import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:medikiosk_kiosk/api/api_client.dart';

/// A recorded request, for asserting on headers and bodies.
class RecordedRequest {
  RecordedRequest(this.method, this.path, this.headers, this.body);

  final String method;
  final String path;
  final Map<String, String> headers;
  final Map<String, dynamic>? body;
}

/// Builds an [ApiClient] backed by a scripted HTTP client.
class FakeApi {
  FakeApi();

  final List<RecordedRequest> requests = <RecordedRequest>[];

  final Map<String, http.Response Function(RecordedRequest)> _routes =
      <String, http.Response Function(RecordedRequest)>{};

  final Set<String> _networkFailures = <String>{};

  void on(String pathSuffix, http.Response Function(RecordedRequest) handler) {
    _routes[pathSuffix] = handler;
  }

  /// Responds with a body computed per call, for an endpoint whose answer changes —
  /// `next question`, for instance, which must eventually say the interview is complete.
  void onRequest(
    String pathSuffix,
    Map<String, dynamic> Function(RecordedRequest) build, {
    int status = 200,
  }) {
    on(
      pathSuffix,
      (RecordedRequest request) => http.Response(
        jsonEncode(build(request)),
        status,
        headers: <String, String>{'content-type': 'application/json; charset=utf-8'},
      ),
    );
  }

  void onJson(String pathSuffix, Map<String, dynamic> body, {int status = 200}) {
    // The charset matters: http.Response defaults to latin1 without it, which cannot
    // encode the Devanagari and Tamil this API actually returns. A real Nest server sends
    // `application/json; charset=utf-8`, so the fake does too.
    on(
      pathSuffix,
      (_) => http.Response(
        jsonEncode(body),
        status,
        headers: <String, String>{'content-type': 'application/json; charset=utf-8'},
      ),
    );
  }

  void failNetwork(String pathSuffix) => _networkFailures.add(pathSuffix);

  int countOf(String pathSuffix) =>
      requests.where((RecordedRequest r) => r.path.endsWith(pathSuffix)).length;

  RecordedRequest? lastTo(String pathSuffix) {
    for (final RecordedRequest r in requests.reversed) {
      if (r.path.endsWith(pathSuffix)) return r;
    }
    return null;
  }

  ApiClient build({String deviceCode = 'MK-OPD-01'}) {
    final MockClient mock = MockClient((http.Request request) async {
      final RecordedRequest recorded = RecordedRequest(
        request.method,
        request.url.path,
        request.headers,
        request.body.isEmpty ? null : jsonDecode(request.body) as Map<String, dynamic>,
      );
      requests.add(recorded);

      for (final String suffix in _networkFailures) {
        if (recorded.path.endsWith(suffix)) {
          throw http.ClientException('connection refused');
        }
      }
      for (final MapEntry<String, http.Response Function(RecordedRequest)> entry
          in _routes.entries) {
        if (recorded.path.endsWith(entry.key)) return entry.value(recorded);
      }
      return http.Response(
        jsonEncode(<String, dynamic>{'code': 'INTERNAL_ERROR'}),
        500,
        headers: <String, String>{'content-type': 'application/json; charset=utf-8'},
      );
    });

    return ApiClient(
      baseUrl: 'http://kiosk.test',
      kioskDeviceCode: deviceCode,
      httpClient: mock,
    );
  }
}

/// A representative `GET /v1/kiosk/config` payload.
Map<String, dynamic> kioskConfigJson({
  int warningSeconds = 90,
  int wipeSeconds = 30,
  List<Map<String, dynamic>>? languages,
  String consentNotice = 'v1.0',
}) {
  return <String, dynamic>{
    'hospitalId': 'HOSP-001',
    'hospitalName': 'Government AYUSH Hospital',
    'branchId': 'MAIN',
    'kioskId': 'MK-OPD-01',
    'languages': languages ??
        <Map<String, dynamic>>[
          <String, dynamic>{
            'tag': 'en',
            'label': 'English',
            'clinicallyReviewed': true,
            'audioAvailable': true,
          },
          <String, dynamic>{
            'tag': 'hi',
            'label': 'हिन्दी',
            'clinicallyReviewed': true,
            'audioAvailable': true,
          },
        ],
    'departments': <Map<String, dynamic>>[
      <String, dynamic>{'departmentId': 'AYU-OPD', 'name': 'Ayurveda OPD'},
    ],
    'ayushSystems': <String>['AYURVEDA'],
    'features': <String, dynamic>{
      'abha': false,
      'aiSummary': false,
      'ocr': false,
      'redFlags': false,
      'voiceIntake': false,
    },
    'contentVersions': <String, dynamic>{
      'questionnaire': '0.0.0',
      'translations': '0.0.0',
      'consentNotice': consentNotice,
    },
    'session': <String, dynamic>{
      'inactivityWarningSeconds': warningSeconds,
      'inactivityWipeSeconds': wipeSeconds,
    },
  };
}

Map<String, dynamic> sessionJson({String state = 'CREATED'}) => <String, dynamic>{
      'sessionId': '11111111-1111-4111-8111-111111111111',
      'state': state,
      'startedAt': '2026-09-12T10:00:00.000Z',
      'warnAt': '2026-09-12T10:01:30.000Z',
      'expiresAt': '2026-09-12T10:02:00.000Z',
    };
