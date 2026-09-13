'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  apiBaseUrl,
  clearToken,
  readToken,
  type CaseView,
  type DeltaItem,
  type DraftSection,
} from '@/lib/api';
import { TopBar } from '@/components/top-bar';

export default function CasePage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}): React.ReactElement {
  const { encounterId } = use(params);
  const router = useRouter();

  const [view, setView] = useState<CaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [exportState, setExportState] = useState<string | null>(null);

  const load = useCallback(
    async (breakGlassReason?: string) => {
      setError(null);
      try {
        const result = await api.case(encounterId, breakGlassReason);
        setView(result);
        setNeedsReason(false);
        setEdited(
          JSON.stringify(
            { narrative: result.draft?.narrative ?? '', sections: result.draft?.sections ?? [] },
            null,
            2,
          ),
        );
      } catch (caught) {
        if (caught instanceof ApiError && caught.needsSignIn) {
          clearToken();
          router.replace('/');
          return;
        }
        if (caught instanceof ApiError && caught.needsBreakGlass) {
          // The same refusal covers "another department", "another hospital" and "no such
          // record", because telling them apart would let a clinician enumerate ids. So the
          // page offers break-glass and lets the server decide again; if the record truly
          // does not exist, the reason changes nothing.
          setNeedsReason(true);
          return;
        }
        setError('Could not open this record.');
      }
    },
    [encounterId, router],
  );

  useEffect(() => {
    if (!readToken()) {
      router.replace('/');
      return;
    }
    void load();
  }, [load, router]);

  async function confirm(): Promise<void> {
    if (!edited) return;
    setBusy(true);
    setError(null);
    try {
      const record: unknown = JSON.parse(edited);
      await api.confirm(encounterId, record, reason || undefined);
      await load(reason || undefined);
    } catch (caught) {
      setError(
        caught instanceof SyntaxError
          ? 'The edited record is not valid JSON.'
          : 'The record was not accepted.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportRecord(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.export(encounterId);
      setExportState(
        result.state === 'ACKNOWLEDGED'
          ? `Sent to the EMR (${result.hisRecordRef}).`
          : result.state === 'RECONCILIATION_REQUIRED'
            ? 'The EMR did not confirm. This has been queued for reconciliation — do not resend.'
            : 'The EMR refused the record. See the operations queue.',
      );
    } catch {
      setError('Export failed.');
    } finally {
      setBusy(false);
    }
  }

  if (needsReason) {
    return (
      <>
        <TopBar />
        <main style={{ maxWidth: 560 }}>
          <h1>This record is outside your department</h1>
          <p className="muted">
            You can open it, and the access is recorded against your name with the reason you give.
            Somebody will read that reason.
          </p>
          <div className="card">
            <label htmlFor="reason">Why do you need this record?</label>
            <input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Covering the evening clinic for Dr…"
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="primary"
                type="button"
                disabled={reason.trim().length < 10}
                onClick={() => void load(reason)}
              >
                Open the record
              </button>
              <button type="button" onClick={() => router.push('/worklist')}>
                Back to the worklist
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (!view) {
    return (
      <>
        <TopBar />
        <main>
          {error ? <div className="card error">{error}</div> : <p className="muted">Loading…</p>}
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main>
        <h1>Case</h1>
        <p className="muted">
          {view.verified
            ? `Confirmed ${new Date(view.verifiedAt as string).toLocaleString()}`
            : 'Not yet confirmed by a clinician.'}
        </p>

        {error && (
          <div className="card error" role="alert">
            {error}
          </div>
        )}

        {view.followUp && <FollowUp delta={view.followUp} />}

        {view.draft ? (
          <section className={`card ${view.verified ? 'verified-card' : 'draft'}`}>
            <span className={`banner${view.verified ? ' verified' : ''}`}>
              {view.verified ? 'Clinician-verified record' : view.draft.banner}
            </span>

            <p style={{ marginTop: 0 }}>{view.draft.narrative}</p>

            {view.draft.sections.map((section) => (
              <Section key={section.key} section={section} />
            ))}
          </section>
        ) : (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No intake was completed for this visit.
            </p>
          </div>
        )}

        <Documents documents={view.documents} />

        {!view.verified && view.draft && (
          <section className="card">
            <h2>Correct and confirm</h2>
            <p className="muted">
              Anything you change here is what gets signed. The draft above is kept as it was —
              confirming writes a new record rather than overwriting what you were shown.
            </p>
            <textarea
              aria-label="The record to confirm"
              value={edited ?? ''}
              onChange={(e) => setEdited(e.target.value)}
              spellCheck={false}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="primary"
                type="button"
                onClick={() => void confirm()}
                disabled={busy}
              >
                {busy ? 'Confirming…' : 'Confirm this record'}
              </button>
              <span className="muted">Your name and the time are recorded against it.</span>
            </div>
          </section>
        )}

        {view.verified && (
          <section className="card">
            <h2>Send to the EMR</h2>
            {exportState ? (
              <p>{exportState}</p>
            ) : (
              <div className="row">
                <button
                  className="primary"
                  type="button"
                  onClick={() => void exportRecord()}
                  disabled={busy}
                >
                  {busy ? 'Sending…' : 'Send to the EMR'}
                </button>
                <span className="muted">Safe to press twice; it will not file two copies.</span>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}

function Section({ section }: { section: DraftSection }): React.ReactElement {
  return (
    <div style={{ marginTop: 12 }}>
      <h3>{section.heading}</h3>
      {section.statements.map((statement, index) => (
        <div className="statement" key={`${statement.sourceRef}-${index}`}>
          <span className="text">{statement.text}</span>
          {/* The label travels with the statement, always. A clinician reading quickly must
              never have to work out where a line came from. */}
          <span className={`label${statement.provenance.includes('OCR') ? ' ocr' : ''}`}>
            {statement.provenance}
          </span>
        </div>
      ))}
    </div>
  );
}

function Documents({ documents }: { documents: CaseView['documents'] }): React.ReactElement | null {
  if (documents.length === 0) return null;

  return (
    <section className="card">
      <h2>Documents the patient brought</h2>
      {documents.map((document) => (
        <div className="statement" key={document.documentId}>
          <span className="text">
            {document.documentType.replace(/_/g, ' ').toLowerCase()}
            {document.state !== 'STORED' && <span className="muted"> — not accepted</span>}
          </span>

          {document.reviewState === 'AWAITING_CLINICIAN_REVIEW' && (
            <span className="label ocr">
              OCR-EXTRACTED — VERIFY
              {/* Confidence is shown HERE and nowhere the patient can see it. A clinician
                  verifying an extraction is exactly who a confidence number helps. */}
              {document.overallConfidence !== null &&
                ` (${Math.round(document.overallConfidence * 100)}%)`}
            </span>
          )}

          {document.link ? (
            <a href={`${apiBaseUrl}${document.link.url}`} target="_blank" rel="noreferrer">
              Open the original
            </a>
          ) : (
            <span className="muted">no file</span>
          )}
        </div>
      ))}
      <p className="muted" style={{ marginBottom: 0 }}>
        Links expire after two minutes and only work for you.
      </p>
    </section>
  );
}

function FollowUp({ delta }: { delta: NonNullable<CaseView['followUp']> }): React.ReactElement {
  return (
    <section className="card">
      <h2>Since the last confirmed visit</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {new Date(delta.previousVerifiedAt).toLocaleDateString()} · {delta.previousDepartment}
      </p>

      {/* Three groups, never merged. "The hypertension is stable" and "nobody asked about
          the hypertension" are different consultations, and a single list cannot tell them
          apart. Not-confirmed is first because it is the part that needs resolving in the
          room. */}
      <Group title="Not confirmed" items={delta.notConfirmed} emphasis />
      <Group title="Changed" items={delta.changed} />
      <Group title="Unchanged" items={delta.unchanged} />
    </section>
  );
}

function Group({
  title,
  items,
  emphasis = false,
}: {
  title: string;
  items: DeltaItem[];
  emphasis?: boolean;
}): React.ReactElement | null {
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <h3 style={emphasis ? { color: 'var(--mk-unverified)' } : undefined}>{title}</h3>
      {items.map((item, index) => (
        <div className="statement" key={`${item.kind}-${index}`}>
          <span className="text">
            {item.label}
            {typeof item.detail['patientSaid'] === 'string' && (
              <span className="muted"> — {item.detail['patientSaid'] as string}</span>
            )}
          </span>
          <span className="label">{item.source.replace(/_/g, '-')}</span>
        </div>
      ))}
    </div>
  );
}
