import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Device lock-down state as reported by the platform.
@immutable
class KioskLockState {
  const KioskLockState({
    required this.lockTaskActive,
    required this.isDeviceOwner,
    required this.screenshotsBlocked,
  });

  /// Android lock-task (dedicated-device) mode is engaged: the patient cannot reach
  /// the launcher, the recents list, notifications or Settings.
  final bool lockTaskActive;

  /// The app is provisioned as device owner via Android Enterprise/MDM. Without this,
  /// lock-task mode is best-effort and a determined user may be able to leave the app.
  final bool isDeviceOwner;

  /// FLAG_SECURE is set, so the screen cannot be captured or shown on a recents thumbnail.
  final bool screenshotsBlocked;

  /// True only when the device is genuinely locked down for unattended public use.
  bool get isFullyLockedDown => lockTaskActive && isDeviceOwner && screenshotsBlocked;

  @override
  String toString() =>
      'KioskLockState(lockTask: $lockTaskActive, deviceOwner: $isDeviceOwner, '
      'screenshotsBlocked: $screenshotsBlocked)';
}

/// Device lock-down control.
///
/// Abstract so the shell can be exercised in widget tests without a device, and so the
/// iOS/desktop debug builds used for design review do not pretend to be locked down.
abstract interface class KioskLock {
  /// Engages lock-task mode and FLAG_SECURE. Safe to call more than once.
  Future<KioskLockState> engage();

  /// Current state. Polled after resume, because an MDM policy change or a crash-restart
  /// can drop lock-task mode without the app noticing.
  Future<KioskLockState> currentState();
}

/// Talks to the Android host over a method channel.
class AndroidKioskLock implements KioskLock {
  const AndroidKioskLock([this._channel = _defaultChannel]);

  static const MethodChannel _defaultChannel = MethodChannel('org.medikiosk/kiosk_lock');
  final MethodChannel _channel;

  @override
  Future<KioskLockState> engage() => _invoke('engage');

  @override
  Future<KioskLockState> currentState() => _invoke('state');

  Future<KioskLockState> _invoke(String method) async {
    try {
      final Map<Object?, Object?>? result =
          await _channel.invokeMapMethod<Object?, Object?>(method);
      return KioskLockState(
        lockTaskActive: result?['lockTaskActive'] == true,
        isDeviceOwner: result?['isDeviceOwner'] == true,
        screenshotsBlocked: result?['screenshotsBlocked'] == true,
      );
    } on PlatformException {
      // Report "not locked down" rather than throwing. The caller surfaces this as an
      // operational warning; a lock-down failure must not stop a patient from checking in,
      // but it must never be silently reported as success either.
      return const KioskLockState(
        lockTaskActive: false,
        isDeviceOwner: false,
        screenshotsBlocked: false,
      );
    } on MissingPluginException {
      return const KioskLockState(
        lockTaskActive: false,
        isDeviceOwner: false,
        screenshotsBlocked: false,
      );
    }
  }
}

/// No-op lock for tests and for non-Android debug builds.
///
/// Deliberately reports `false` for every flag. A stub that claimed to be locked down
/// would let an unlocked build pass a check the real device has to earn.
class UnlockedKioskLock implements KioskLock {
  const UnlockedKioskLock();

  static const KioskLockState _unlocked = KioskLockState(
    lockTaskActive: false,
    isDeviceOwner: false,
    screenshotsBlocked: false,
  );

  @override
  Future<KioskLockState> engage() async => _unlocked;

  @override
  Future<KioskLockState> currentState() async => _unlocked;
}
