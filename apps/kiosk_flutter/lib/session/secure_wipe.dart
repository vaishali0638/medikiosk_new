import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// What a wipe actually cleared, and what it failed to clear.
@immutable
class WipeReport {
  const WipeReport({required this.cleared, required this.failed});

  final List<String> cleared;
  final List<String> failed;

  /// A wipe is only complete when nothing failed. Partial success is failure here: one
  /// uncleared buffer is one patient's data left in front of the next patient.
  bool get isComplete => failed.isEmpty;

  @override
  String toString() => 'WipeReport(cleared: $cleared, failed: $failed)';
}

/// Clears every trace of the current patient's session from the device.
abstract interface class SecureWipe {
  Future<WipeReport> wipe();
}

/// Real device wipe.
///
/// Ordered from most to least sensitive, and each step is independent: a failure in one
/// does not abandon the rest, because clearing four of five buffers is strictly better
/// than clearing none. Every failure is named in the report so the caller can refuse to
/// tell the server the session was wiped.
class DeviceSecureWipe implements SecureWipe {
  DeviceSecureWipe({
    required List<VoidCallback> uiStateClearers,
    Future<Directory> Function()? temporaryDirectory,
  })  : _uiStateClearers = uiStateClearers,
        _temporaryDirectory = temporaryDirectory ?? Directory.systemTemp.createTemp;

  final List<VoidCallback> _uiStateClearers;
  final Future<Directory> Function() _temporaryDirectory;

  @override
  Future<WipeReport> wipe() async {
    final List<String> cleared = <String>[];
    final List<String> failed = <String>[];

    Future<void> step(String name, FutureOr<void> Function() action) async {
      try {
        await action();
        cleared.add(name);
      } catch (_) {
        failed.add(name);
      }
    }

    await step('ui-state', () {
      for (final VoidCallback clear in _uiStateClearers) {
        clear();
      }
    });

    // Any image the camera decoded during document capture, plus every cached network
    // image, lives here until evicted.
    await step('image-cache', () {
      PaintingBinding.instance.imageCache
        ..clear()
        ..clearLiveImages();
    });

    // Text the patient typed can persist in the platform clipboard after the session.
    await step('clipboard', () async {
      await Clipboard.setData(const ClipboardData(text: ''));
    });

    await step('temporary-files', () async {
      final Directory dir = await _temporaryDirectory();
      if (!dir.existsSync()) return;
      for (final FileSystemEntity entity in dir.listSync()) {
        entity.deleteSync(recursive: true);
      }
    });

    return WipeReport(cleared: cleared, failed: failed);
  }
}

/// Test double that records how many times it ran and can be made to fail.
@visibleForTesting
class FakeSecureWipe implements SecureWipe {
  FakeSecureWipe({this.failing = const <String>[]});

  final List<String> failing;
  int callCount = 0;

  @override
  Future<WipeReport> wipe() async {
    callCount += 1;
    return WipeReport(cleared: const <String>['ui-state'], failed: failing);
  }
}
