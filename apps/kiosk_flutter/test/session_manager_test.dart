import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/api/api_client.dart';
import 'package:medikiosk_kiosk/config/kiosk_config.dart';
import 'package:medikiosk_kiosk/session/secure_wipe.dart';
import 'package:medikiosk_kiosk/session/session_manager.dart';
import 'package:medikiosk_kiosk/session/session_state.dart';

import 'support/fake_api.dart';

const SessionTiming _timing = SessionTiming(
  warning: Duration(seconds: 90),
  wipe: Duration(seconds: 30),
);

({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) build({
  List<String> wipeFailures = const <String>[],
}) {
  final FakeApi api = FakeApi();
  api.onJson('/v1/kiosk/sessions', sessionJson(), status: 201);
  api.onJson('/activity', sessionJson(), status: 201);
  api.onJson('/language', sessionJson(state: 'LANGUAGE_SELECTED'), status: 201);
  api.onJson('/end', <String, dynamic>{'sessionId': 'x', 'state': 'EXITED'}, status: 201);

  final FakeSecureWipe wipe = FakeSecureWipe(failing: wipeFailures);
  final ApiClient client = api.build();
  return (
    manager: SessionManager(api: client, wipe: wipe, timing: _timing),
    api: api,
    wipe: wipe,
  );
}

void main() {
  group('starting a session', () {
    test('records the session id and moves to active', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
      await t.manager.start();

      expect(t.manager.hasActiveSession, isTrue);
      expect(t.manager.phase, SessionPhase.active);
      expect(t.manager.state, KioskSessionState.created);
      t.manager.dispose();
    });

    test('ends and wipes an unfinished session before starting a new patient', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
      await t.manager.start();
      await t.manager.start();

      // The previous patient's session must not survive into the next one.
      expect(t.wipe.callCount, 1);
      expect(t.api.countOf('/end'), 1);
      t.manager.dispose();
    });
  });

  group('inactivity', () {
    test('warns after the warning window', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 89));
        expect(t.manager.phase, SessionPhase.active);

        async.elapse(const Duration(seconds: 2));
        expect(t.manager.phase, SessionPhase.warning);
        t.manager.dispose();
      });
    });

    test('wipes after the full window and reports a timeout', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 121));
        async.flushMicrotasks();

        expect(t.wipe.callCount, 1);
        expect(t.manager.hasActiveSession, isFalse);
        expect(t.api.lastTo('/end')?.body?['reason'], 'TIMEOUT');
        t.manager.dispose();
      });
    });

    test('gives the patient the full warning window before wiping', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 95));
        expect(t.manager.phase, SessionPhase.warning);
        // Warning shown at 90s; nothing is cleared until 120s.
        expect(t.wipe.callCount, 0);
        t.manager.dispose();
      });
    });

    test('activity resets the window and clears the warning', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 95));
        expect(t.manager.phase, SessionPhase.warning);

        t.manager.recordActivity();
        expect(t.manager.phase, SessionPhase.active);

        async.elapse(const Duration(seconds: 89));
        expect(t.manager.phase, SessionPhase.active);
        expect(t.wipe.callCount, 0);
        t.manager.dispose();
      });
    });

    test('debounces the activity heartbeat so a keyboard does not flood the network', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();

        for (int i = 0; i < 20; i++) {
          t.manager.recordActivity();
          async.elapse(const Duration(milliseconds: 100));
        }
        async.flushMicrotasks();

        expect(t.api.countOf('/activity'), 1);
        t.manager.dispose();
      });
    });

    test('does nothing on activity once the session has ended', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();
        t.manager.end(SessionEndReason.exit);
        async.flushMicrotasks();

        final int before = t.api.countOf('/activity');
        t.manager.recordActivity();
        async.flushMicrotasks();
        expect(t.api.countOf('/activity'), before);
        t.manager.dispose();
      });
    });

    test('no timer survives a session ending', () {
      fakeAsync((FakeAsync async) {
        final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
        t.manager.start();
        async.flushMicrotasks();
        t.manager.end(SessionEndReason.exit);
        async.flushMicrotasks();

        async.elapse(const Duration(minutes: 10));
        // Exactly one wipe: the explicit exit. A leaked timer would fire a second.
        expect(t.wipe.callCount, 1);
        t.manager.dispose();
      });
    });
  });

  group('ending a session', () {
    test('wipes the device before telling the server', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
      await t.manager.start();
      await t.manager.end(SessionEndReason.exit);

      expect(t.wipe.callCount, 1);
      expect(t.api.lastTo('/end')?.body, <String, dynamic>{'reason': 'EXIT', 'wiped': true});
      t.manager.dispose();
    });

    test('withholds the wipe attestation when the wipe was incomplete', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t =
          build(wipeFailures: <String>['temporary-files']);
      await t.manager.start();
      final WipeReport report = await t.manager.end(SessionEndReason.exit);

      expect(report.isComplete, isFalse);
      // A session recorded as cleanly closed while data remains on the device is worse
      // than one left open in the audit log, so nothing is reported.
      expect(t.api.countOf('/end'), 0);
      t.manager.dispose();
    });

    test('still wipes locally when the server is unreachable', () async {
      final FakeApi api = FakeApi();
      api.onJson('/v1/kiosk/sessions', sessionJson(), status: 201);
      api.failNetwork('/end');
      final FakeSecureWipe wipe = FakeSecureWipe();
      final SessionManager manager =
          SessionManager(api: api.build(), wipe: wipe, timing: _timing);

      await manager.start();
      await manager.end(SessionEndReason.exit);

      expect(wipe.callCount, 1);
      expect(manager.hasActiveSession, isFalse);
      manager.dispose();
    });

    test('is safe to call twice', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
      await t.manager.start();
      await t.manager.end(SessionEndReason.timeout);
      await t.manager.end(SessionEndReason.exit);

      expect(t.api.countOf('/end'), 1);
      t.manager.dispose();
    });

    test('forgets the language along with everything else', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
      await t.manager.start();
      await t.manager.selectLanguage('hi');
      expect(t.manager.language, 'hi');

      await t.manager.end(SessionEndReason.exit);
      expect(t.manager.language, isNull);
      expect(t.manager.sessionId, isNull);
      t.manager.dispose();
    });

    test('records a timeout as expired and an exit as exited', () async {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) a = build();
      await a.manager.start();
      await a.manager.end(SessionEndReason.timeout);
      expect(a.manager.state, KioskSessionState.expired);
      a.manager.dispose();

      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) b = build();
      await b.manager.start();
      await b.manager.end(SessionEndReason.exit);
      expect(b.manager.state, KioskSessionState.exited);
      b.manager.dispose();
    });
  });

  test('applies hospital-configured timings', () {
    fakeAsync((FakeAsync async) {
      final ({SessionManager manager, FakeApi api, FakeSecureWipe wipe}) t = build();
      t.manager.applyTiming(
        const SessionTiming(warning: Duration(seconds: 10), wipe: Duration(seconds: 5)),
      );
      t.manager.start();
      async.flushMicrotasks();

      async.elapse(const Duration(seconds: 11));
      expect(t.manager.phase, SessionPhase.warning);
      t.manager.dispose();
    });
  });
}
