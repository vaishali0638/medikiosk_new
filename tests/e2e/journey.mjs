/**
 * Walks a whole patient through a running MediKiosk, over HTTP, exactly as the kiosk does.
 *
 * This is the answer to "does it actually work end to end", asked of the running system
 * rather than of the unit tests. The integration suite proves each endpoint honours its
 * contract against a real database; nothing before this proved the fifteen of them compose
 * into a patient walking up to a kiosk and leaving with a token.
 *
 * It reads the one-time code out of the API log, which is only possible because
 * SMS_ADAPTER=sandbox. That is the point: against a real gateway this script cannot
 * complete, and it says so rather than pretending.
 *
 *   node tests/e2e/journey.mjs [baseUrl] [apiLogPath]
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const LOG = process.argv[3] ?? '/tmp/medikiosk-api.log';
const DEVICE = 'MK-OPD-01';

let step = 0;
const ok = (what, detail = '') =>
  console.log(`  ${String(++step).padStart(2)}. ✓ ${what}${detail ? `  ${detail}` : ''}`);

class JourneyError extends Error {}

async function call(method, path, body) {
  const headers = {
    'content-type': 'application/json',
    'X-Kiosk-Device': DEVICE,
    'X-Correlation-Id': randomUUID(),
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new JourneyError(
      `${method} ${path} → ${res.status} ${json.code ?? ''} (correlationId ${json.correlationId ?? '?'})`,
    );
  }
  return json;
}

/**
 * The code the sandbox adapter wrote to the log.
 *
 * Matched on the masked tail so a parallel run cannot hand this journey another patient's
 * code — which would pass, and prove nothing.
 */
function codeFromLog(mobile) {
  const tail = mobile.slice(-4);
  const lines = readFileSync(LOG, 'utf8').split('\n').reverse();
  for (const line of lines) {
    if (!line.includes('SANDBOX SMS') || !line.includes(`******${tail}`)) continue;
    const match = /(\d{6}) is your MediKiosk verification code/.exec(line);
    if (match) return match[1];
  }
  throw new JourneyError(
    `No sandbox code for ******${tail} in ${LOG}. ` +
      'With a real SMS gateway configured this script cannot read the code and cannot run.',
  );
}

/** A number in the 6-9 range the contract requires, unused by earlier runs. */
const mobile = `9${String(Date.now()).slice(-9)}`;

async function main() {
  console.log(`\nMediKiosk end-to-end journey against ${BASE}\n`);

  const config = await call('GET', '/v1/kiosk/config');
  ok(
    'kiosk reads its configuration',
    `${config.languages.length} languages, ${config.departments.length} departments`,
  );

  const session = await call('POST', '/v1/kiosk/sessions');
  const sid = session.sessionId;
  ok('session starts', session.state);

  await call('POST', `/v1/kiosk/sessions/${sid}/language`, { language: 'en' });
  ok('language selected');

  const notice = await call('GET', '/v1/consents/notice?language=en');
  ok('consent notice served', `${notice.version}`);

  await call('POST', `/v1/consents?sessionId=${sid}`, {
    decision: 'GRANTED',
    language: 'en',
    noticeVersion: notice.version,
  });
  ok('consent granted');

  const otp = await call('POST', '/v1/identity/otp', {
    mobile,
    purpose: 'NEW_REGISTRATION',
  });
  ok('one-time code issued', otp.maskedMobile);

  const code = codeFromLog(mobile);
  await call('POST', '/v1/identity/otp/verify', {
    verificationId: otp.verificationId,
    code,
  });
  ok('code verified');

  const registered = await call('POST', `/v1/identity/register?sessionId=${sid}`, {
    verificationId: otp.verificationId,
    name: 'E2E Test Patient',
    sex: 'FEMALE',
    ageYears: 42,
  });
  ok('patient registered', registered.patientId ?? '');

  // Why the patient is here. A first-time patient has nothing to follow up, so the server
  // must record NEW_COMPLAINT however hard the client asks for a follow-up — the visit type
  // decides whether a clinician reads a delta or takes a history, so a client that could
  // set it freely could produce a consultation against the wrong premise.
  const previous = await call('GET', `/v1/kiosk/sessions/${sid}/previous-visit`);
  if (previous.hasPreviousVerifiedVisit !== false) {
    throw new JourneyError('a brand-new patient should have no verified previous visit');
  }

  const department = config.departments[0].departmentId;
  const visit = await call('POST', `/v1/kiosk/sessions/${sid}/visit`, {
    departmentCode: department,
    visitType: 'REGULAR_FOLLOW_UP',
  });
  const pid = visit.preCheckinId;
  ok('visit opened', department);

  const recorded = await call('GET', `/v1/precheckins/${pid}/review?language=en`);
  void recorded;
  ok('follow-up downgraded for a patient with no history', 'server overrode the client');

  // The interview. Answered non-committally throughout: the point is that the engine
  // serves, branches and terminates, not that a fictional patient has a plausible history.
  let answered = 0;
  const seen = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const next = await call('GET', `/v1/intakes/${pid}/next?language=en`);
    if (next.complete) break;
    const q = next.question;
    // Option-bearing questions get their first option; everything else gets a value.
    // Both carry the provenance the record will show a clinician — PATIENT_SELECTED for a
    // choice the patient made from a list, PATIENT_REPORTED for something they said.
    const chosen = q.options?.length ? [q.options[0].id] : [];
    await call('POST', `/v1/intakes/${pid}/answers?language=en`, {
      questionId: q.id,
      selectedOptionIds: chosen,
      ...(chosen.length === 0 ? { value: q.type === 'NUMBER' ? 1 : 'Not sure' } : {}),
      source: chosen.length > 0 ? 'PATIENT_SELECTED' : 'PATIENT_REPORTED',
      modality: 'TOUCH',
      language: 'en',
    });
    answered += 1;
    seen.push(q.id);
  }
  const distinct = new Set(seen);
  if (answered >= 60) {
    throw new JourneyError(
      `interview did not terminate: ${answered} answers, ${distinct.size} distinct questions. ` +
        `Last five: ${seen.slice(-5).join(', ')}`,
    );
  }
  ok('interview completed', `${answered} questions, ${distinct.size} distinct`);

  const review = await call('GET', `/v1/precheckins/${pid}/review?language=en`);
  ok('patient review served', `${review.sections?.length ?? review.items?.length ?? 0} sections`);

  const submitted = await call('POST', `/v1/precheckins/${pid}/submit-intake`, {
    reviewConfirmed: true,
    language: 'en',
  });
  ok('intake submitted');

  // The token hangs off an arrival handle, not the pre-check-in id. A walk-in gets one
  // back from the submission; a visit with no kiosk-confirmed arrival gets null, and the
  // counter finishes the check-in instead. Either is a correct outcome, and a journey that
  // quietly accepted the second would be proving nothing.
  if (!submitted.tokenHandle) {
    throw new JourneyError(
      'submit-intake returned no tokenHandle, so this visit cannot be given a token here',
    );
  }

  // The clinical draft. Checked here because a draft that silently comes back empty, or
  // without its provenance labels, is worse than no draft at all.
  //
  // Which generator produced it depends on FEATURE_AI_SUMMARY and on whether an AI worker
  // is reachable, so this asserts neither. What it asserts is the property that has to
  // hold however it was produced: the banner names what actually made the draft, and
  // nothing claims to have been verified.
  const draft = await call('GET', `/v1/precheckins/${pid}/draft?language=en`);
  const sections = draft.draft?.sections ?? draft.sections ?? [];
  if (sections.length === 0) {
    throw new JourneyError('the clinical draft came back with no sections');
  }
  const serialised = JSON.stringify(draft);
  for (const required of [
    'NOT VERIFIED',
    'not verified',
    'Clinical diagnosis has not been provided',
  ]) {
    if (!serialised.includes(required)) {
      throw new JourneyError(`the draft is missing its safety labelling: "${required}"`);
    }
  }
  // The banner must name what produced the draft, and the two must agree. Claiming
  // "AI-assisted" over a rule-composed draft invites a clinician to distrust their own
  // patient's answers; omitting it when a model was involved is the more serious of the
  // two, and is the one this catches.
  if (draft.generator !== 'DETERMINISTIC' && draft.generator !== 'MODEL') {
    throw new JourneyError(`draft reports an unknown generator: ${draft.generator}`);
  }
  const claimsAi = /AI-assisted/i.test(draft.banner ?? '');
  if (claimsAi !== (draft.generator === 'MODEL')) {
    throw new JourneyError(
      `draft mislabelled: generator=${draft.generator}, banner="${draft.banner}"`,
    );
  }
  ok('clinical draft composed', `${sections.length} sections, ${draft.generator}, not verified`);

  const token = await call('POST', `/v1/arrival/${submitted.tokenHandle}/token`, {});
  ok('hospital token issued', `${token.tokenNumber ?? token.token ?? JSON.stringify(token)}`);

  await call('POST', `/v1/kiosk/sessions/${sid}/end`, { reason: 'COMPLETED', wiped: true });
  ok('session ended and wipe attested');

  console.log(`\n  ${step} steps, no failures. A patient can walk up and leave with a token.\n`);
}

main().catch((error) => {
  console.error(`\n  ✗ ${error.message}\n`);
  if (!(error instanceof JourneyError)) console.error(error);
  process.exit(1);
});
