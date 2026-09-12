import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api/api_client.dart';
import 'app.dart';
import 'platform/kiosk_lock.dart';
import 'session/secure_wipe.dart';

/// Backend base URL and device code come from the build, never from source.
/// Supplied at build time:
///   flutter build apk --dart-define=MEDIKIOSK_API_BASE_URL=https://... \
///                     --dart-define=MEDIKIOSK_DEVICE_CODE=MK-OPD-03
const String _apiBaseUrl = String.fromEnvironment(
  'MEDIKIOSK_API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',
);
const String _deviceCode = String.fromEnvironment(
  'MEDIKIOSK_DEVICE_CODE',
  defaultValue: 'MK-OPD-01',
);

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Kiosks are mounted in a fixed orientation. Locking it stops a knock or a rotation
  // from re-laying out the screen mid-answer.
  unawaited(
    SystemChrome.setPreferredOrientations(<DeviceOrientation>[DeviceOrientation.portraitUp]),
  );

  // Hide the status and navigation bars. This is presentation only — it is not a security
  // control, and it is not what keeps the patient inside the app. Lock-task mode does that.
  unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky));

  runApp(
    KioskApp(
      api: ApiClient(baseUrl: _apiBaseUrl, kioskDeviceCode: _deviceCode),
      // Only Android provides real lock-down. A desktop or iOS debug build used for
      // design review reports itself as unlocked rather than pretending otherwise.
      kioskLock: Platform.isAndroid ? const AndroidKioskLock() : const UnlockedKioskLock(),
      wipeBuilder: (List<VoidCallback> clearers) =>
          DeviceSecureWipe(uiStateClearers: clearers),
    ),
  );
}
