# patient_pwa

Patient pre-check-in. Runs on the patient's own phone before they travel to the hospital,
and ends by displaying the QR they scan at the kiosk.

**This app never issues a token.** It produces a signed reference that the hospital kiosk
validates; the HIS issues the token on arrival. That separation is the point of the design
— see `docs/architecture/phase-06-precheckin-qr.md`.

## Run

```bash
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 \
NEXT_PUBLIC_HOSPITAL_CODE=HOSP-001 \
NEXT_PUBLIC_DEPARTMENT_ID=AYU-OPD \
npm run dev -w @medikiosk/patient-pwa
```

Then open http://localhost:3001.

## Flow

```
/           language (only languages with a published consent notice)
/consent    the governed notice; agree or decline, equally weighted
/details    demographics and visit type
/review     check before sending — submitting is a separate, deliberate act
/qr         the signed, short-lived, single-use code
```

## What it deliberately does not do

- **No clinical intake.** Symptoms, history and documents arrive with Phases 8 and 10.
- **No token.** Only the hospital HIS issues one, and only after a kiosk scan.
- **No third-party QR rendering.** The code is a signed credential and is drawn locally.
- **No persistence beyond the tab.** State lives in `sessionStorage` so a half-finished
  journey on a shared phone is not resumed by whoever opens the page next.
