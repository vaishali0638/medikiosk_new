# Languages and spoken guidance

An OPD queue in a government hospital is not monolingual, and the people least able to
read a screen are the people a kiosk most needs to reach. This describes what the platform
now does about that, and — as importantly — what it still does not.

## "All Indian regional languages" is a checkable claim, so it is checked

The registry is the twenty-two languages of the Eighth Schedule to the Constitution, plus
English: `packages/terminology/src/languages.ts`. That set was chosen over "every language
spoken in India" because it is enumerated in law and closed, which makes the claim
falsifiable. Three tests fail if an edit drops one — one in Dart, one in the tools package,
one against the database.

India has several hundred other languages, some with more speakers than the smaller
Schedule entries. A hospital serving one adds it to the registry with the same evidence any
other language needs: an endonym, a script, a direction and a reviewer.

Each entry carries the language's name **in its own script**. This is not decoration. A
patient who reads only Odia cannot find "Odia" in a list written in the Latin alphabet, so
the endonym is the label and the English name appears only on staff screens, in logs and in
runbooks. It comes from the registry rather than from `hospital_language.label`, because a
hospital administrator will sooner or later type the Latin name into a config table and
that must not be what a patient sees.

## Four gates, deliberately separate

Being in the registry grants nothing. A patient can use the kiosk in a language only when
all of these hold, and they are tracked apart because they fail apart:

| Gate                                                       | Where it lives                   | Who satisfies it             |
| ---------------------------------------------------------- | -------------------------------- | ---------------------------- |
| **Registered** — name, script, reading direction           | `languages.ts`, table `language` | the platform                 |
| **Shell translated** — buttons, titles, errors             | `infra/i18n/kiosk/<tag>.json`    | a translator                 |
| **Shell reviewed** — a speaker has read them               | `infra/i18n/kiosk/REVIEW.json`   | a named reviewer             |
| **Clinically approved** — consent notice and questionnaire | governance registry              | a practitioner, per hospital |

`npm run lang:coverage` prints the state of the first three and says plainly that it cannot
answer the fourth. Its report ends with the gates it does not cover, in the output rather
than in a comment, so nobody reads a green line as readiness.

Current state: **23 registered, 14 with a complete shell translation, 0 reviewed by a
speaker of the language.**

The fourteen — Assamese, Bengali, English, Gujarati, Hindi, Kannada, Malayalam, Marathi,
Nepali, Odia, Punjabi, Tamil, Telugu, Urdu — are complete at all 198 keys and correct to the
best of the author's knowledge, and **none has been read by a native speaker**. That is
recorded as `unreviewed` in `REVIEW.json`, a test asserts no language claims review without
a named person and a date, and the coverage loader downgrades a `reviewed` status with a
null reviewer rather than trusting it. A tick box with nobody behind it is how unchecked
wording reaches a patient.

The remaining nine (Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri, Sanskrit, Santali,
Sindhi) are registered and untranslated. They fall back to English, which is readable rather
than blank, and they are named in the coverage report so the gap is a work item.

### Shell text is not clinical text

Everything above concerns navigation and system wording. Consent notices, questions, answer
options and red-flag phrasing are governed content: authored, approved by a qualified
practitioner **per language**, versioned and published through the governance registry.
They are not in these files and never will be. A shell label can be corrected by a
developer; a clinical string cannot.

`KioskStrings.clinicalVocabularyKeys` lists the handful of shell keys whose wording is
nonetheless clinical vocabulary — the "what has changed?" picker names categories a patient
reports against. They are declared rather than banned, because the guard's purpose is to
stop clinical wording arriving _unnoticed_, and a test fails if a translation introduces
clinical language outside that list.

## Right to left is a layout property

Urdu, Kashmiri and Sindhi are written in Perso-Arabic. Rendering their text correctly while
laying the screen out left to right is worse than showing English: the primary action, the
back control and the order of a row of options all end up mirrored. `MaterialApp.builder`
now wraps the app in a `Directionality` taken from the registry entry for the language in
use.

## Two scripts have no font on a stock device

Meetei Mayek (Manipuri) and Ol Chiki (Santali) are absent from Android's default font set.
Without a bundled font they render as rows of empty boxes — which is worse than a missing
language, because the patient cannot even tell what they are looking at. Until a font ships
with the build, the selection screen appends the English name for those two, so the button
reads `▯▯▯▯ (Manipuri)` rather than `▯▯▯▯`. `SCRIPTS_NEEDING_BUNDLED_FONT` is the single
place that list lives.

## The kiosk can now speak, which it could not before

`AudioGuidance` has existed since Phase 3 with a well-shaped interface — it distinguishes an
approved recording from device text-to-speech, because reading governed clinical wording
aloud in a synthetic voice is a different artefact from the one a reviewer approved.

Nothing on the Android side ever answered it. The channel `org.medikiosk/audio_guidance` was
never registered, so every call raised `MissingPluginException`, the Dart code caught it and
reported `unavailable`, and the kiosk degraded silently and correctly into a device that
could not speak at all. **Audio Guidance was a button that did nothing, on every device the
app has ever run on.**

Two things were missing and both are now built.

`AudioGuidanceHandler.kt` implements the channel against Android's `TextToSpeech`:

- Every language is checked with `isLanguageAvailable` before use. `LANG_MISSING_DATA` — the
  engine knows the language but the voice is not installed, which is the normal state of a
  freshly imaged kiosk — counts as **unsupported**, because from where the patient stands it
  is the same as unsupported.
- There is **no fallback to another language**. A Malayalam prompt read out in Hindi sounds
  authoritative and is not understood; silence is safer.
- Every utterance flushes the previous one, so a patient who moves on does not hear the last
  screen finishing underneath the new one.
- Indian voices are published per region, so tags are resolved to `ta-IN`, `bn-IN`, `ur-IN`
  and so on. A tag that already carries a region is honoured as given.
- The engine is shut down in `onDestroy`, so audio from one patient's session cannot
  outlive it.

And the toggle now produces audio. Previously the only thing that ever spoke was the consent
notice, behind its own "Listen" control; the Audio Guidance switch set a flag that nothing
else consulted. `_announceScreen` reads each screen's heading in the patient's language when
the toggle is on — shell text only, once per screen, never repeated on a rebuild. Governed
clinical content is still spoken only through the consent screen's own labelled control,
which says that device speech is synthetic rather than passing it off as the approved
recording.

`AudioGuidance.supportedLanguages` asks the engine which of the hospital's configured
languages the device can actually produce. The point is to stop `audio_available` being a
promise typed into a config table and make it something measured on the device that has to
keep it.

## An unknown language tag is now impossible to configure

`hospital_language.language_tag` was `text CHECK (length BETWEEN 2 AND 16)`. That accepts
`tamil`, `TA`, `ta-IN`, `tm` and a typo as four distinct languages, each of which would then
be looked up for a notice, a translation and a voice, and quietly find nothing. The failure
surfaces as a language that appears on the kiosk and does nothing when a patient touches it.

Migration 0024 adds the `language` table, seeded from the canonical registry, and a foreign
key from `hospital_language`. `test/schema-parity.int-spec.ts` fails if the table and
`languages.ts` drift apart, so the second copy cannot rot.

## What is still not done

- **No shell translation has been reviewed by a speaker of the language.** Fourteen
  languages need a reviewer each; that is the largest item here and it is not a
  code change.
- **Nine languages are untranslated**, listed above and in the coverage report.
- **No clinical content exists in any language**, including English — consent notices and
  questionnaires still ship as `0.1.0-placeholder`, which is Phase 17's and Phase 18's
  unchanged largest blocker. Translating a placeholder would be worse than leaving it.
- **No fonts are bundled**, so Manipuri and Santali cannot render on a stock device even
  once translated.
- **No approved recordings exist.** Every spoken prompt is device text-to-speech and is
  labelled as such.
- **Voice availability is asked for but not yet reported to the server**, so
  `hospital_language.audio_available` remains a hospital's claim rather than a measurement.
- **The Android TTS path has not been heard.** The Kotlin compiles — `flutter build apk
--debug` succeeds with the handler registered — and the Dart side is tested against a
  fake that records what would be spoken. Nobody has run it on a device with an Indian
  voice installed, so which of the fourteen a real kiosk can actually pronounce is
  unmeasured. `docs/runbooks/kiosk-device-setup.md` is where installing the voices belongs.

- **The dev seed publishes placeholder consent notices in all fourteen languages**, so the
  selection screen can be exercised end to end. They are translations OF A PLACEHOLDER: each
  `fullText` opens with the not-approved warning in English and again in the target language,
  and the approval record still reads `NOT_A_REAL_APPROVAL`. `clinically_reviewed` is set
  true by the seed for development only; a hospital sets it after a practitioner approves the
  content in that language, which is why the flag is separate from the language being
  configured at all. Sanskrit is seeded configured-but-unreviewed so the gate stays
  exercised: it is in the config table and must not appear on the kiosk.

## Hearing it during development

macOS has its own handler, `macos/Runner/AudioGuidanceHandler.swift`, over
`AVSpeechSynthesizer`. It exists because a text-to-speech path nobody can listen to is
exactly how the Android channel went fifteen phases unimplemented. It holds to the same three
rules as the Android side — probe the voice before using it, never substitute another
language, flush the previous utterance — because those are correctness rules, not platform
details.

Registering it took four entries in `macos/Runner.xcodeproj/project.pbxproj`: `PBXBuildFile`,
`PBXFileReference`, the Runner group and the Sources build phase. Xcode compiles the files its
project lists, not the files in the directory. Gradle needs none of that, which is why the
Android handler worked the moment it was written and this one failed to compile until the
project knew about it.

On the development Mac this was built on, `AVSpeechSynthesisVoice` resolves for six of the
fourteen — Bengali (Piya), English (Rishi), Hindi (Lekha), Kannada (Soumya), Tamil (Vani),
Telugu (Geeta) — and returns nil for the other eight. That is the honest state of a machine
nobody has provisioned voices on, and it is exactly what an unprovisioned kiosk looks like:
the eight stay silent rather than being read out in a language the patient did not choose.
Voices are added on macOS under System Settings → Accessibility → Spoken Content → System
Voice → Manage Voices, and on Android under Settings → System → Languages → Text-to-speech.
