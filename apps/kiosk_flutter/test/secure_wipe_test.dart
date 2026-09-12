import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/session/secure_wipe.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('WipeReport', () {
    test('is complete only when nothing failed', () {
      expect(
        const WipeReport(cleared: <String>['a', 'b'], failed: <String>[]).isComplete,
        isTrue,
      );
      // Partial success is failure: one uncleared buffer is one patient's data left in
      // front of the next patient.
      expect(
        const WipeReport(cleared: <String>['a'], failed: <String>['b']).isComplete,
        isFalse,
      );
    });
  });

  group('DeviceSecureWipe', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('medikiosk_wipe_test');
    });

    tearDown(() async {
      if (tempDir.existsSync()) await tempDir.delete(recursive: true);
    });

    test('runs every UI-state clearer', () async {
      int cleared = 0;
      final DeviceSecureWipe wipe = DeviceSecureWipe(
        uiStateClearers: <VoidCallback>[() => cleared += 1, () => cleared += 1],
        temporaryDirectory: () async => tempDir,
      );

      final WipeReport report = await wipe.wipe();
      expect(cleared, 2);
      expect(report.cleared, contains('ui-state'));
    });

    test('deletes temporary files left by document capture', () async {
      File('${tempDir.path}/scan.jpg').writeAsStringSync('image bytes');
      Directory('${tempDir.path}/nested').createSync();
      File('${tempDir.path}/nested/audio.wav').writeAsStringSync('audio bytes');

      await DeviceSecureWipe(
        uiStateClearers: const <VoidCallback>[],
        temporaryDirectory: () async => tempDir,
      ).wipe();

      expect(tempDir.listSync(), isEmpty);
    });

    test('clears the image cache, which holds decoded camera frames', () async {
      final DeviceSecureWipe wipe = DeviceSecureWipe(
        uiStateClearers: const <VoidCallback>[],
        temporaryDirectory: () async => tempDir,
      );

      final WipeReport report = await wipe.wipe();
      expect(report.cleared, contains('image-cache'));
      expect(PaintingBinding.instance.imageCache.currentSize, 0);
    });

    test('names a failing step instead of reporting overall success', () async {
      final DeviceSecureWipe wipe = DeviceSecureWipe(
        uiStateClearers: <VoidCallback>[() => throw StateError('cannot clear')],
        temporaryDirectory: () async => tempDir,
      );

      final WipeReport report = await wipe.wipe();
      expect(report.failed, contains('ui-state'));
      expect(report.isComplete, isFalse);
    });

    test('a failing step does not abandon the remaining steps', () async {
      File('${tempDir.path}/scan.jpg').writeAsStringSync('image bytes');

      final DeviceSecureWipe wipe = DeviceSecureWipe(
        uiStateClearers: <VoidCallback>[() => throw StateError('cannot clear')],
        temporaryDirectory: () async => tempDir,
      );

      // Clearing four of five buffers is strictly better than clearing none.
      final WipeReport report = await wipe.wipe();
      expect(report.cleared, contains('temporary-files'));
      expect(tempDir.listSync(), isEmpty);
    });

    test('tolerates a temporary directory that does not exist', () async {
      final Directory missing = Directory('${tempDir.path}/gone');
      final WipeReport report = await DeviceSecureWipe(
        uiStateClearers: const <VoidCallback>[],
        temporaryDirectory: () async => missing,
      ).wipe();

      expect(report.failed, isNot(contains('temporary-files')));
    });
  });
}
