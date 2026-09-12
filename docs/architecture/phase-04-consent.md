# Phase 4 — Language, accessibility and consent

## Objective

The multilingual and consent foundation, before any clinical data is collected.

## What was built

### Backend

| Endpoint                            | Purpose                                               |
| ----------------------------------- | ----------------------------------------------------- |
| `GET /v1/consents/notice?language=` | The published notice for one language                 |
| `POST /v1/consents`                 | Record a grant or decline against that notice         |
| `GET /v1/consents/{id}`             | Read an artefact back, scoped to the calling hospital |
| `POST /v1/consents/{id}/revoke`     | Withdraw a granted consent                            |

Plus `ConsentNoticeService`, `ConsentService` with the `requireActiveConsent` gate, and
migration `0007`.

### Flutter

Consent screen, full-notice screen, declined screen, an `AudioGuidance` interface with a
silent default, and the language → notice → decision flow wired into the shell.

### Governed content

Consent notices are published per language as `governance_version` rows of kind
`CONSENT_NOTICE`, with `content_key` = `consent-notice/<language>`. English and Hindi
placeholders are seeded.

## Test results

| Suite                                 |        Count | Status                          |
| ------------------------------------- | -----------: | ------------------------------- |
| Backend unit                          |           67 | Passing                         |
| Backend integration (real PostgreSQL) |          117 | Passing                         |
| Flutter widget and unit               | ~120 written | **Not run** — SDK not installed |

Walked end to end against PostgreSQL: config offers `en, hi`; the Hindi notice returns in
Devanagari; Tamil is refused; a grant moves the session to `CONSENT_GRANTED` and creates a
provisional patient with no demographics; a decline records the artefact and ends and wipes
the session.

## Decisions and trade-offs

**No cross-language fallback for a consent notice.** A language with no published notice
is refused outright. Serving English wording to a patient who chose Hindi would be asking
them to agree to something they cannot read, which is not consent in any meaningful sense.
The same rule propagates upward: `GET /v1/kiosk/config` now offers a language only if it is
both clinically reviewed _and_ has a published notice, because reviewed labels with no
notice would walk a patient to the consent screen and strand them.

**Purpose, categories and notice version come from the server.** The client sends only the
language and the decision. A kiosk running a stale build could otherwise record agreement
to a superseded version, and the artefact would then misstate what the patient saw.

**Agree and decline are the same size.** Making decline quieter would be a nudge, and
consent that has been nudged is not freely given. The declined screen offers Exit and
nothing else — re-asking someone who has just said no is pressure.

**Declining does not read as being refused care.** The screen says the patient can still be
seen at the counter in the usual way.

**`requireActiveConsent` throws rather than returning a boolean.** A caller who forgets to
check a returned flag is a silent authorisation bypass, and this is the one place where
that mistake means processing health data without a legal basis.

**Recorded audio and device TTS are distinguished, never conflated.** Reading approved
wording in a synthetic voice is a different artefact from the one a reviewer signed off —
pronunciation of a drug name or a negation can change the meaning. When no voice is
available the screen says so, rather than leaving a patient waiting on a silent button.

**The seeded notice announces that it is a placeholder** in its own first line, in both
languages, and its approval is recorded as `SEED-PLACEHOLDER / NOT_A_REAL_APPROVAL` so it
cannot be mistaken for a sign-off.

## A design correction the flow forced

The specified order is language → consent → identity, so a patient consents **before** they
are identified. But `patient` required `full_name`, `sex` and an age or date of birth, so
the provisional row a consent artefact must reference could not be created at all. The
`provisional` flag already existed; the constraints simply did not respect it.

Migration `0007` makes them conditional: a _confirmed_ patient still needs all of them, a
provisional one needs none. The guarantee is preserved exactly where it matters, since a
patient cannot leave provisional state without the demographics.

## A defect the tests caught

`requireActiveConsent` reported `CONSENT_REQUIRED` for a consent that had lapsed but not
yet been swept — telling an operator the patient was never asked, when in fact they
consented and it ran out. Both outcomes refuse, so it was never an authorisation hole, but
the audit trail would have been wrong. It now reports `CONSENT_EXPIRED`.

## Known limitations

- **The Flutter code has still never been compiled or run.** Roughly 120 widget and unit
  tests are written and unverified across Phases 3 and 4.
- **The seeded consent notices are placeholders** and are not lawful to show a real
  patient. They require hospital legal and clinical approval through the governance
  console, which is Phase 14.
- **No audio recordings exist**, and the Android TTS channel has no native implementation
  yet — `PlatformAudioGuidance` will report unavailable on a device until it does. The
  interface and the honest fallback are in place; the engine is not.
- **Consent validity is a fixed 24 hours**, not hospital-configurable.
- **No expiry scheduler.** `expireLapsed()` is implemented and tested, but nothing runs it
  periodically; the gate checks validity on every call, so this is a tidiness gap rather
  than a correctness one.
- **Only English and Hindi.** Both notices are developer-written placeholders; neither has
  been through translation review.
- **Withdrawal is API-only.** There is no patient-facing withdrawal screen — a patient
  withdraws by asking staff, as the notice says.

## Exit criteria

| Criterion                                                      | Status                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Every supported language has reviewed labels                   | Verified — config offers only reviewed languages that also have a published notice                                         |
| Consent cannot be bypassed                                     | Verified — the session cannot reach clinical intake without `CONSENT_GRANTED`, and `requireActiveConsent` throws           |
| Decline stops clinical intake                                  | Verified — the artefact is kept, the session is ended and wiped                                                            |
| Consent artefact is stored and auditable                       | Verified — artefact plus audit event in one transaction                                                                    |
| No unapproved machine translation is shown as clinical content | Verified — notices are governed content; unreviewed languages are withheld; TTS is labelled, never presented as the notice |
