# Kiosk device setup and lock-down

How a MediKiosk Android device is provisioned so a patient cannot leave the app, cannot
reach Android settings, and cannot see the previous patient's screen.

## Why three separate controls

These are frequently conflated. Only the combination is a locked-down kiosk, which is why
the app reports all three separately and the shell shows a staff warning banner unless all
three hold.

| Control        | Stops                                                | Does not stop                                   |
| -------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Immersive mode | The status and navigation bars being visible         | A swipe from the edge bringing them back        |
| Lock-task mode | Leaving the app                                      | Being dismissed, unless the app is device owner |
| Device owner   | Lock-task being dismissed with Back + Overview       | Anything on its own                             |
| `FLAG_SECURE`  | Screenshots, screen recording, the recents thumbnail | Someone photographing the screen                |

`FLAG_SECURE` matters more than it first appears: without it, Android itself will show the
previous patient's screen as a recents thumbnail.

## Build

Requires Flutter 3.27 or newer. `android/` is committed — do not run `flutter create`
here, as it would overwrite the lock-task activity, the device-admin receiver, the `HOME`
intent filter and the backup rules with its defaults.

```bash
cd apps/kiosk_flutter
flutter pub get
flutter build apk --release \
  --dart-define=MEDIKIOSK_API_BASE_URL=https://medikiosk.hospital.internal \
  --dart-define=MEDIKIOSK_DEVICE_CODE=MK-OPD-03
```

The backend URL and device code are build-time values. Neither is ever hard-coded in
source, and each kiosk gets its own device code matching a row in `kiosk_device`.

## Provisioning as device owner

Device-owner status **must** be set on a factory-reset device with no accounts configured.
It cannot be granted later. Two routes:

**Android Enterprise QR enrolment (production).** Register the app with the hospital's EMM,
then tap six times on the setup wizard's welcome screen and scan the enrolment QR.

**ADB (pilot and lab devices only).**

```bash
adb install -r build/app/outputs/flutter-apk/app-release.apk
adb shell dpm set-device-owner org.medikiosk.kiosk/.KioskDeviceAdminReceiver
```

Verify:

```bash
adb shell dumpsys device_policy | grep -i "device owner"
```

If the app is not device owner, the shell displays a red **DEVICE NOT LOCKED DOWN** banner.
That banner is for hospital IT, not the patient — but a kiosk showing it must not be put
into public service.

## Reboot behaviour

`MainActivity` declares both `LAUNCHER` and `HOME` intent filters, so MediKiosk is the
device home app. A reboot, a crash-restart or a stray home press lands on the kiosk home
screen rather than the Android launcher. Set MediKiosk as the default home app once, at
provisioning time, so the "Complete action using" chooser never appears.

Verify: `adb reboot`, then confirm the kiosk home screen appears without any interaction.

## MDM policy checklist

| Setting                      | Value                         | Why                                          |
| ---------------------------- | ----------------------------- | -------------------------------------------- |
| Dedicated device (COSU) mode | On                            | Lock-task without dismissal                  |
| Kiosk app                    | `org.medikiosk.kiosk`         | The only allowed app                         |
| Safe mode                    | Blocked                       | Safe mode bypasses lock-task                 |
| Factory reset                | Blocked for users             | Prevents provisioning being cleared          |
| USB file transfer            | Blocked                       | No data export over USB                      |
| USB debugging                | Off in production             | ADB access defeats every control here        |
| Screen capture               | Blocked                       | Backs up `FLAG_SECURE` at policy level       |
| Backup                       | Off                           | Also enforced by `data_extraction_rules.xml` |
| Play Store                   | Removed                       | No unrelated apps                            |
| System update                | Windowed, outside OPD hours   | An update mid-consultation loses the queue   |
| Wi-Fi config                 | Locked, hospital network only | The kiosk talks to nothing else              |

## Session wipe

Wiping happens on **every** exit path: patient Exit, inactivity timeout, completion and
error termination.

```
Exit / timeout / completion / error
  -> clear shell UI state (language, accessibility, pending selections)
  -> clear the Flutter image cache (decoded camera frames, cached images)
  -> clear the platform clipboard
  -> delete temporary files
  -> report `wiped: true` to the server, ONLY if every step succeeded
  -> return to the home screen
```

Two properties worth understanding:

**The local wipe is unconditional.** It runs before the server is contacted and regardless
of whether that call succeeds. A network failure must never leave the previous patient's
data on the device.

**An incomplete wipe is not reported as clean.** If any step fails, the client withholds
the attestation entirely. The server then never marks the session closed, and the row is
picked up by the abandoned-session sweep — so a silently failing wipe becomes visible in
monitoring instead of being recorded as a tidy exit. The database enforces the same rule
from the other side: `kiosk_session_ended_is_wiped` rejects a terminal state without a
`wiped_at`.

## Verifying lock-down before service

| Check                                           | Expected                                  |
| ----------------------------------------------- | ----------------------------------------- |
| Swipe from every screen edge                    | No navigation or status bar reachable     |
| Press and hold Back + Overview                  | Stays in MediKiosk                        |
| Attempt a screenshot (power + volume down)      | Refused                                   |
| Open recents                                    | No MediKiosk thumbnail content            |
| Reboot                                          | Kiosk home screen, no launcher            |
| Plug in USB and browse from a host              | No filesystem access                      |
| Leave a session idle                            | Warning at 90s, wipe at 120s, home screen |
| Exit mid-session, then inspect the next session | No prior data                             |
| Confirm the staff banner                        | Absent                                    |

The last one is the summary check: the banner is absent only when lock-task, device owner
and `FLAG_SECURE` all hold.
