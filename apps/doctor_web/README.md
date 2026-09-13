# doctor_web

Clinician dashboard: worklist, case review, correction, confirmation and EMR export.
Renders the endpoints built in Phase 13.

```bash
npm run dev -w @medikiosk/doctor-web    # http://localhost:3002
```

Needs `core_api` running with `STAFF_IDP=sandbox`, and a `staff_user` row whose subject you
sign in as (`sandbox:<subject>`).

## What this surface is careful about

**The draft is never mistakable for a record.** An amber left border, an uppercase banner
and a per-statement provenance label — three signals, because a doctor skimming between
patients can miss any one. When the record is confirmed the same block turns green and the
banner changes; nothing else about the layout moves, so the difference is the colour and the
words rather than a rearrangement that has to be re-read.

**Confidence is shown here and nowhere the patient can see it.** A clinician verifying an
extraction is exactly the person a confidence number helps.

**Correcting writes a new record.** The draft is kept as it was, so what the clinician was
shown when they signed survives.

**The session lives in `sessionStorage`, not a cookie.** A cookie is attached to every
request the page makes, which is what makes CSRF possible; and closing the tab on a shared
consulting-room machine ends the session.
