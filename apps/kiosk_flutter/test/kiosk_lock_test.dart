import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/platform/kiosk_lock.dart';

void main() {
  group('KioskLockState', () {
    test('is fully locked down only when all three protections hold', () {
      expect(
        const KioskLockState(
          lockTaskActive: true,
          isDeviceOwner: true,
          screenshotsBlocked: true,
        ).isFullyLockedDown,
        isTrue,
      );
    });

    test('lock-task without device owner is not enough', () {
      // Without device-owner provisioning Android shows a "screen pinned" state the user
      // can leave by holding Back and Overview.
      expect(
        const KioskLockState(
          lockTaskActive: true,
          isDeviceOwner: false,
          screenshotsBlocked: true,
        ).isFullyLockedDown,
        isFalse,
      );
    });

    test('unblocked screenshots are not enough', () {
      // Without FLAG_SECURE the recents thumbnail can show the previous patient's screen.
      expect(
        const KioskLockState(
          lockTaskActive: true,
          isDeviceOwner: true,
          screenshotsBlocked: false,
        ).isFullyLockedDown,
        isFalse,
      );
    });
  });

  group('UnlockedKioskLock', () {
    test('never claims to be locked down', () async {
      const UnlockedKioskLock lock = UnlockedKioskLock();
      // A stub that reported success would let an unlocked build pass a check the real
      // device has to earn.
      expect((await lock.engage()).isFullyLockedDown, isFalse);
      expect((await lock.currentState()).lockTaskActive, isFalse);
      expect((await lock.currentState()).isDeviceOwner, isFalse);
      expect((await lock.currentState()).screenshotsBlocked, isFalse);
    });
  });
}
