# First Flutter verification (after Phases 3–5)

Phases 3, 4 and 5 wrote roughly 150 Dart tests without a Flutter SDK on the machine. This
records what happened the first time they were actually compiled and run.

**Result:** `flutter analyze` clean, 150/150 tests passing, after fixing 6 issues — 2 that
stopped compilation, and 4 real defects the tests caught.

## Compilation

| Issue                          | Cause                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `PointerSignalEvent` undefined | Lives in `package:flutter/gestures.dart`, which `material.dart` does not re-export |
| `const http.ClientException`   | Not a const constructor                                                            |

## Real defects

**Latin-1 decoding would have mangled every non-Latin script.** `ApiClient` read
`http.Response.body`, which falls back to latin1 when the server omits a charset from its
content-type — so a Devanagari consent notice would arrive corrupted, or throw. Express
happens to send `charset=utf-8`, so this would have survived local testing and surfaced
against some other gateway or proxy. The client now decodes `bodyBytes` as UTF-8 itself.
Caught because the test fixture contained real Hindi text rather than `"foo"`.

**The home screen clipped its own options.** A `Column` inside a `Center` with no scroll
overflowed by 96px whenever the content did not fit — a landscape wall mount, or Large
Text on a portrait one, would have put the bottom options off the glass. Now scrolls only
when it needs to.

**Agree was 4px shorter than Decline.** Primary buttons had no border while secondary ones
had a 2px one. Phase 4 states that agree and decline must be the same size because a
quieter decline is a nudge; the geometry quietly contradicted that. All emphases now carry
a border of the same width, transparent where it should not show.

**Both consent decisions could scroll off-screen.** They sat inside the scrollable summary
rather than pinned below it. On a short screen the patient would have had to scroll to
find either — and had only one been pinned, that would have been the nudge the design
exists to avoid. Both are now pinned, together.

## Project setup corrections

`flutter create --org org.medikiosk --project-name medikiosk_kiosk` produces the
applicationId `org.medikiosk.medikiosk_kiosk`, not `org.medikiosk.kiosk` as the Phase 3
runbook assumed — so the manifest's `.MainActivity` did not resolve to the committed
Kotlin class. The Gradle ids are now `org.medikiosk.kiosk`, matching the package the
sources declare and the provisioning command in the runbook.

`flutter_localizations` also now requires `intl ^0.20.3`, which the pinned `^0.19.0`
blocked.

More importantly: **`android/` is now committed rather than generated.** The previous
create-then-`git checkout` dance was fragile — `flutter create` overwrites the lock-task
activity, the device-admin receiver, the `HOME` intent filter and the backup rules, and a
partial restore would leave a build that looks fine and is not a kiosk. Setup is now
`flutter pub get`.

## What this says about the preceding phases

Everything intricate held: the session manager's inactivity and wipe logic passed all 16
tests first time, including the `fakeAsync` timer cases, and the identity and consent
screens passed unchanged.

What did not hold was everything touching a real runtime — text encoding, layout under
constraint, pixel geometry. Those are not things careful writing catches, which is the
argument for running the suite every phase rather than accumulating unverified work.
