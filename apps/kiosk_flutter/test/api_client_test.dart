import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/api/api_client.dart';
import 'package:medikiosk_kiosk/api/api_exception.dart';

import 'support/fake_api.dart';

void main() {
  group('correlation ids', () {
    test('are well-formed v4 UUIDs', () {
      final String id = generateCorrelationId();
      expect(
        id,
        matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
      );
    });

    test('are not repeated', () {
      final Set<String> ids = <String>{
        for (int i = 0; i < 500; i++) generateCorrelationId(),
      };
      expect(ids.length, 500);
    });
  });

  group('headers', () {
    test('every request carries the device code and a correlation id', () async {
      final FakeApi api = FakeApi();
      api.onJson('/v1/kiosk/config', kioskConfigJson());

      await api.build(deviceCode: 'MK-OPD-07').get('/v1/kiosk/config');

      final RecordedRequest request = api.requests.single;
      expect(request.headers[kKioskDeviceHeader], 'MK-OPD-07');
      expect(request.headers[kCorrelationIdHeader], isNotEmpty);
    });

    test('a fresh correlation id per request', () async {
      final FakeApi api = FakeApi();
      api.onJson('/v1/kiosk/config', kioskConfigJson());
      final ApiClient client = api.build();

      await client.get('/v1/kiosk/config');
      await client.get('/v1/kiosk/config');

      expect(
        api.requests[0].headers[kCorrelationIdHeader],
        isNot(api.requests[1].headers[kCorrelationIdHeader]),
      );
    });
  });

  group('errors', () {
    test('surfaces the server neutral message rather than composing its own', () async {
      final FakeApi api = FakeApi();
      api.onJson(
        '/v1/kiosk/sessions',
        <String, dynamic>{
          'code': 'SESSION_EXPIRED',
          'patientMessage': 'This session has ended. Please start again.',
          'correlationId': 'cid-1',
        },
        status: 410,
      );

      await expectLater(
        api.build().post('/v1/kiosk/sessions'),
        throwsA(
          isA<ApiException>()
              .having((ApiException e) => e.code, 'code', 'SESSION_EXPIRED')
              .having(
                (ApiException e) => e.patientMessage,
                'patientMessage',
                'This session has ended. Please start again.',
              )
              .having((ApiException e) => e.isSessionExpired, 'isSessionExpired', isTrue),
        ),
      );
    });

    test('reports an unreachable server as a network failure', () async {
      final FakeApi api = FakeApi();
      api.failNetwork('/v1/kiosk/config');

      await expectLater(
        api.build().get('/v1/kiosk/config'),
        throwsA(
          isA<ApiException>().having((ApiException e) => e.isNetworkFailure, 'network', isTrue),
        ),
      );
    });

    test('a malformed error body still yields a patient-safe message', () async {
      final FakeApi api = FakeApi();
      api.on('/v1/kiosk/config', (_) => throw const FormatException('bad'));

      await expectLater(
        api.build().get('/v1/kiosk/config'),
        throwsA(isA<ApiException>()),
      );
    });

    test('an error carries a correlation id staff can quote', () async {
      final FakeApi api = FakeApi();
      api.onJson('/v1/kiosk/config', <String, dynamic>{'code': 'INTERNAL_ERROR'}, status: 500);

      try {
        await api.build().get('/v1/kiosk/config');
        fail('expected a throw');
      } on ApiException catch (error) {
        expect(error.correlationId, isNotNull);
      }
    });
  });

  test('sends the request body as JSON', () async {
    final FakeApi api = FakeApi();
    api.onJson('/language', sessionJson(state: 'LANGUAGE_SELECTED'), status: 201);

    await api.build().post('/v1/kiosk/sessions/abc/language', <String, dynamic>{'language': 'hi'});

    expect(api.requests.single.body, <String, dynamic>{'language': 'hi'});
  });
}
