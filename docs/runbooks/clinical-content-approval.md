# Approving the clinical content

The one thing that blocks a pilot, and the one thing no engineer and no AI can do for you.
This is what it involves, who has to do it, and how long it takes.

## Why it cannot be done for you

`clinically_reviewed` and the `approvals` array are **attestations**. They say a named,
qualified person read this wording and takes responsibility for it. Everything downstream
trusts them: the kiosk offers a language because the flag is true, a patient is asked to
agree to a notice because it is published, a clinician reads a questionnaire's questions
believing a practitioner chose them.

Writing a name into that array without the person having read the content does not speed
the process up. It removes the process and leaves the record asserting something false —
and the record is what a regulator, an ethics committee or a court would read.

So the seeded content says `NOT_A_REAL_APPROVAL` in its own approval field, its version
ends `-placeholder`, and every consent notice opens with **PLACEHOLDER NOTICE — NOT
APPROVED FOR PATIENT USE** in English and in the target language. Those are not
placeholders waiting to be overwritten by a script. They are waiting for a person.

## Who has to sign

| Artefact                     | Who                                             | What they are attesting                                                                |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Consent notice, per language | Hospital legal or DPO, plus clinical governance | The patient can understand what they agree to, and it is lawful under the DPDP Act     |
| Common-core questionnaire    | A registered practitioner                       | The questions are clinically appropriate, safe to ask unsupervised, and cannot mislead |
| Each AYUSH module            | A practitioner **of that system**               | An Ayurveda physician cannot approve the Unani module                                  |
| Red-flag wording             | Clinical governance                             | What it escalates, and what it deliberately does not                                   |
| Each translation             | A speaker of the language, ideally clinical     | The translation says what the English says                                             |

Nobody signs their own work. The approval gate requires two distinct names, and a test
asserts an author cannot be their own approver.

## How, once you have the people

Everything runs through the governance console at `:3003` — nothing is edited in the
database, so every change leaves a transition record naming who and when.

1. **Draft.** Governance console → Releases → New. Paste the reviewed wording, give it a
   real semver (`1.0.0`, not `0.1.0-placeholder`).
2. **Review.** Move it to IN_REVIEW. It is now visible to reviewers and not to patients.
3. **Approve.** Each reviewer adds their own approval with their name, role and
   qualification. The gate returns every missing requirement at once, so a release is fixed
   in one pass rather than five.
4. **Canary, optionally.** Publish to named kiosks first. Same approvals as a full
   release — the difference is blast radius, not scrutiny.
5. **Publish.** Set the effective date. The previous version stops being served; it is not
   deleted, because a stored answer cites the version it was collected under.
6. **Enable the language.** Set `clinically_reviewed` for it. Until then the kiosk will not
   offer it, however good the translation is.

`GET /v1/governance/unversioned` lists every content kind a hospital is serving with
nothing published. That list reaching empty is the exit criterion.

## Translation review, concretely

Fourteen languages have complete shell translations. **None has been read by a speaker.**
They are correct to the best of the author's knowledge and that is not the standard.

A reviewer needs one file: `infra/i18n/kiosk/<tag>.json`, 198 strings, perhaps ninety
minutes. They correct it in place and it goes back as a pull request. Then
`infra/i18n/kiosk/REVIEW.json` records their name and the date — and only then, because
`npm run lang:coverage` downgrades any `reviewed` status with a null reviewer back to
unreviewed rather than trusting the word.

Shell text is navigation and system wording: buttons, titles, timeouts, errors. It is _not_
clinical content, which is why a developer may write it and a speaker may correct it.
`KioskStrings.clinicalVocabularyKeys` lists the handful of shell keys that are nonetheless
clinical vocabulary — the "what has changed?" categories — and those need the same
practitioner sign-off as the questionnaire.

## What "done" looks like

```bash
npm run lang:coverage     # every offered language: translated, and reviewed by a named person
curl .../v1/governance/unversioned   # empty
```

and `tools/src/production-readiness.ts` losing its two largest blockers. It will still
return `ready: false` — it always will, because whether a clinical system may see real
patients is a judgement a hospital makes with a practitioner and a lawyer in the room, not
a function's return value.
