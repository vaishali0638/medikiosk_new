import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Outcome of a scan attempt.
@immutable
class ScanResult {
  const ScanResult.found(this.payload)
      : cancelled = false,
        cameraUnavailable = false;
  const ScanResult.cancelled()
      : payload = null,
        cancelled = true,
        cameraUnavailable = false;
  const ScanResult.cameraUnavailable()
      : payload = null,
        cancelled = false,
        cameraUnavailable = true;

  /// The raw scanned text. Opaque to the kiosk — only the server can judge it.
  final String? payload;
  final bool cancelled;
  final bool cameraUnavailable;
}

/// Reads a QR code from the kiosk camera.
///
/// Abstract for the same reason as [KioskLock]: the shell has to be exercisable without
/// hardware, and a desktop build used for design review must not pretend it has a camera.
///
/// The scanner never inspects what it read. A QR payload is a signed token that only the
/// backend can verify, and a client that tried to pre-judge it would either duplicate the
/// validation badly or leak which codes are plausible.
abstract interface class QrScanner {
  Future<ScanResult> scan();

  /// Releases the camera. Called on every screen exit and on session wipe, so no preview
  /// buffer from one patient survives into the next session.
  Future<void> stop();

  Future<bool> isAvailable();
}

/// Platform-channel scanner backed by the Android camera.
class PlatformQrScanner implements QrScanner {
  const PlatformQrScanner([this._channel = _defaultChannel]);

  static const MethodChannel _defaultChannel = MethodChannel('org.medikiosk/qr_scanner');
  final MethodChannel _channel;

  @override
  Future<ScanResult> scan() async {
    try {
      final String? payload = await _channel.invokeMethod<String>('scan');
      if (payload == null || payload.isEmpty) return const ScanResult.cancelled();
      return ScanResult.found(payload);
    } on PlatformException {
      return const ScanResult.cameraUnavailable();
    } on MissingPluginException {
      return const ScanResult.cameraUnavailable();
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _channel.invokeMethod<void>('stop');
    } on PlatformException {
      // Camera already released.
    } on MissingPluginException {
      // Channel not registered on this platform.
    }
  }

  @override
  Future<bool> isAvailable() async {
    try {
      return await _channel.invokeMethod<bool>('isAvailable') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// Scanner for builds with no camera.
///
/// Reports unavailable rather than returning a fabricated payload. A fake that produced
/// a plausible-looking token would let the arrival flow appear to work on a machine that
/// cannot actually scan anything.
class UnavailableQrScanner implements QrScanner {
  const UnavailableQrScanner();

  @override
  Future<ScanResult> scan() async => const ScanResult.cameraUnavailable();

  @override
  Future<void> stop() async {}

  @override
  Future<bool> isAvailable() async => false;
}

/// Development scanner that takes a payload supplied by the harness.
///
/// Used by widget tests and by desktop builds during design review, where the QR is
/// pasted rather than scanned. Never wired into an Android build.
@visibleForTesting
class ScriptedQrScanner implements QrScanner {
  ScriptedQrScanner(this.payload);

  String? payload;
  int stopCount = 0;

  @override
  Future<ScanResult> scan() async {
    final String? value = payload;
    return value == null ? const ScanResult.cancelled() : ScanResult.found(value);
  }

  @override
  Future<void> stop() async => stopCount += 1;

  @override
  Future<bool> isAvailable() async => true;
}
