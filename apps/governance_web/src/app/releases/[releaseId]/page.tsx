'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  APPROVAL_ROLES,
  clearToken,
  NEXT_STATES,
  readToken,
  type Release,
  type Transition,
} from '@/lib/api';
import { TopBar } from '@/components/top-bar';

export default function ReleasePage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}): React.ReactElement {
  const { releaseId } = use(params);
  const router = useRouter();

  const [release, setRelease] = useState<Release | null>(null);
  const [history, setHistory] = useState<Transition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, transitions] = await Promise.all([api.releases(), api.history(releaseId)]);
      setRelease(list.releases.find((r) => r.id === releaseId) ?? null);
      setHistory(transitions.transitions);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.needsSignIn) {
        clearToken();
        router.replace('/');
        return;
      }
      setError('Could not load this release.');
    }
  }, [releaseId, router]);

  useEffect(() => {
    if (!readToken()) {
      router.replace('/');
      return;
    }
    void load();
  }, [load, router]);

  async function move(to: string, extra: Record<string, unknown> = {}): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.transition(releaseId, { to, ...extra });
      await load();
    } catch (caught) {
      // The server lists everything wrong at once — missing roles, no distinct second
      // approver, no qualification, a pre-release version. Showing that verbatim is the
      // point: an author fixing one thing per review cycle abandons the process.
      setError(caught instanceof ApiError ? caught.message : 'That change was refused.');
    } finally {
      setBusy(false);
    }
  }

  if (!release) {
    return (
      <>
        <TopBar />
        <main>
          {error ? <div className="card error">{error}</div> : <p className="muted">Loading…</p>}
        </main>
      </>
    );
  }

  const nextStates = NEXT_STATES[release.state] ?? [];

  return (
    <>
      <TopBar />
      <main style={{ maxWidth: 820 }}>
        <h1>{release.contentKey}</h1>
        <p className="muted">
          {release.contentKind} · version {release.semver} ·{' '}
          <span
            className={`label${release.state === 'PUBLISHED' ? ' verified' : release.state === 'CANARY' ? ' ocr' : ''}`}
          >
            {release.state}
          </span>
        </p>

        {error && (
          <div className="card error" role="alert">
            {error}
          </div>
        )}

        {release.state === 'ROLLED_BACK' && release.rollbackReason && (
          <div className="card draft">
            <span className="banner">Rolled back</span>
            <p style={{ margin: 0 }}>{release.rollbackReason}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              This version cannot return to circulation. The number is what a clinical record cites,
              so it keeps meaning one thing.
            </p>
          </div>
        )}

        <Approvals release={release} onDone={load} onError={setError} />

        <section className="card">
          <h2>Move this release</h2>
          {nextStates.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              This release is finished. Nothing further can happen to it.
            </p>
          ) : (
            <div className="row">
              {nextStates.map((state) => (
                <MoveButton key={state} state={state} busy={busy} onMove={move} />
              ))}
            </div>
          )}
          {/* Only the moves the machine permits are offered — there is no button that goes
              from a draft to published, because there is no such edge. */}
        </section>

        <section className="card">
          <h2>History</h2>
          <table>
            <tbody>
              {history.map((step, index) => (
                <tr key={index}>
                  <td className="muted" style={{ width: 180 }}>
                    {new Date(step.occurred_at).toLocaleString()}
                  </td>
                  <td>
                    {step.from_state ?? '—'} → <strong>{step.to_state}</strong>
                  </td>
                  <td className="muted">{step.actor_user_id.slice(0, 8)}</td>
                  <td className="muted">{step.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}

function MoveButton({
  state,
  busy,
  onMove,
}: {
  state: string;
  busy: boolean;
  onMove: (to: string, extra?: Record<string, unknown>) => Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  // Two moves need something typed before they can happen, and both refusals come from
  // the server too — this only saves a round trip.
  const needsKiosks = state === 'CANARY';
  const needsReason = state === 'ROLLED_BACK';

  if (!needsKiosks && !needsReason) {
    return (
      <button
        type="button"
        className={state === 'PUBLISHED' ? 'primary' : undefined}
        disabled={busy}
        onClick={() => void onMove(state)}
      >
        {label(state)}
      </button>
    );
  }

  if (!open) {
    return (
      <button type="button" disabled={busy} onClick={() => setOpen(true)}>
        {label(state)}
      </button>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <label htmlFor={`arg-${state}`}>
        {needsKiosks
          ? 'Which kiosks should receive it? (comma separated codes)'
          : 'Why is this being rolled back?'}
      </label>
      <input
        id={`arg-${state}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={needsKiosks ? 'MK-OPD-01' : 'The Hindi translation of question four is wrong'}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="primary"
          disabled={busy || value.trim().length < (needsKiosks ? 1 : 10)}
          onClick={() =>
            void onMove(
              state,
              needsKiosks
                ? {
                    canaryKioskCodes: value
                      .split(',')
                      .map((c) => c.trim())
                      .filter(Boolean),
                  }
                : { rollbackReason: value.trim() },
            )
          }
        >
          {label(state)}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {needsReason && (
        <p className="muted">
          Rolling back restores the version this one replaced, so no kiosk is left without content.
        </p>
      )}
    </div>
  );
}

function label(state: string): string {
  switch (state) {
    case 'IN_REVIEW':
      return 'Send for review';
    case 'DRAFT':
      return 'Send back to the author';
    case 'APPROVED':
      return 'Mark approved';
    case 'CANARY':
      return 'Release to a few kiosks';
    case 'PUBLISHED':
      return 'Publish to every kiosk';
    case 'ROLLED_BACK':
      return 'Roll back';
    case 'RETIRED':
      return 'Retire';
    default:
      return state;
  }
}

function Approvals({
  release,
  onDone,
  onError,
}: {
  release: Release;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}): React.ReactElement {
  const [role, setRole] = useState<string>(APPROVAL_ROLES[0]);
  const [by, setBy] = useState('');
  const [qualification, setQualification] = useState('');
  const [busy, setBusy] = useState(false);

  const recorded = release.approvals ?? [];
  const distinct = new Set(recorded.map((a) => a.by.trim().toLowerCase())).size;

  async function add(): Promise<void> {
    setBusy(true);
    try {
      await api.approve(release.id, {
        role,
        by: by.trim(),
        ...(qualification.trim() ? { qualification: qualification.trim() } : {}),
        at: new Date().toISOString(),
      });
      setBy('');
      setQualification('');
      await onDone();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'That approval was not recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Approvals</h2>

      {recorded.length === 0 ? (
        <p className="muted">Nobody has approved this yet.</p>
      ) : (
        recorded.map((approval, index) => (
          <div className="statement" key={`${approval.role}-${index}`}>
            <span className="text">
              <strong>{approval.by}</strong>
              {approval.qualification && <span className="muted"> — {approval.qualification}</span>}
            </span>
            <span className="label">{approval.role}</span>
          </div>
        ))
      )}

      {/* The count that matters. One person holding four roles is not four checks, and
          seeing the distinct number is how a reviewer notices before the server refuses. */}
      <p className="muted">
        {recorded.length} approval(s) from {distinct} distinct{' '}
        {distinct === 1 ? 'person' : 'people'}.
      </p>

      {release.state === 'IN_REVIEW' && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--mk-border)', paddingTop: 12 }}>
          <label htmlFor="role">Role</label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--mk-border)',
              font: 'inherit',
            }}
          >
            {APPROVAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <label htmlFor="by" style={{ marginTop: 12 }}>
            Approved by
          </label>
          <input
            id="by"
            value={by}
            onChange={(e) => setBy(e.target.value)}
            placeholder="Dr A Sharma"
          />

          <label htmlFor="qualification" style={{ marginTop: 12 }}>
            Qualification
          </label>
          <input
            id="qualification"
            value={qualification}
            onChange={(e) => setQualification(e.target.value)}
            placeholder="BAMS, MD (Ayurveda)"
          />
          <p className="muted">
            Required for the author and clinical reviewer of clinical content. &ldquo;Reviewed by a
            practitioner&rdquo; means nothing without saying a practitioner of what.
          </p>

          <button
            type="button"
            disabled={busy || by.trim().length === 0}
            onClick={() => void add()}
          >
            Record this approval
          </button>
        </div>
      )}
    </section>
  );
}
