'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { TopBar } from '@/components/top-bar';

const KINDS = [
  'QUESTIONNAIRE',
  'AYUSH_MODULE',
  'COMPLAINT_BRANCH',
  'CONSENT_NOTICE',
  'RED_FLAG_RULE',
  'TERMINOLOGY',
];

export default function NewDraftPage(): React.ReactElement {
  const router = useRouter();
  const [contentKind, setContentKind] = useState('QUESTIONNAIRE');
  const [contentKey, setContentKey] = useState('common-core/en');
  const [semver, setSemver] = useState('1.0.0');
  const [payload, setPayload] = useState('{\n  \n}');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(payload);
      const result = await api.createDraft({ contentKind, contentKey, semver, payload: parsed });
      router.push(`/releases/${result.releaseId}`);
    } catch (caught) {
      // The server validates the content itself — schema, duplicate ids, branching on a
      // question asked later — and says which. Showing its message rather than a generic
      // one is the whole reason validation happens at authoring.
      setError(
        caught instanceof SyntaxError
          ? 'That is not valid JSON.'
          : caught instanceof ApiError
            ? caught.message
            : 'The draft was not accepted.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <main style={{ maxWidth: 720 }}>
        <h1>New draft</h1>
        <p className="muted">
          Checked when you save, not three reviews later. A version number is what a clinical record
          cites, so it cannot be reused.
        </p>

        <form className="card" onSubmit={submit}>
          <label htmlFor="kind">Content kind</label>
          <select
            id="kind"
            value={contentKind}
            onChange={(e) => setContentKind(e.target.value)}
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--mk-border)',
              font: 'inherit',
            }}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>

          <label htmlFor="key" style={{ marginTop: 12 }}>
            Content key
          </label>
          <input id="key" value={contentKey} onChange={(e) => setContentKey(e.target.value)} />

          <label htmlFor="semver" style={{ marginTop: 12 }}>
            Version
          </label>
          <input id="semver" value={semver} onChange={(e) => setSemver(e.target.value)} />
          <p className="muted">
            A pre-release version (<code>1.0.0-draft</code>) can be authored but cannot be published
            as live content.
          </p>

          <label htmlFor="payload" style={{ marginTop: 12 }}>
            Content
          </label>
          <textarea
            id="payload"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            style={{ minHeight: 280 }}
          />

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save as draft'}
            </button>
            <button type="button" onClick={() => router.push('/releases')}>
              Cancel
            </button>
          </div>
        </form>

        {error && (
          <div className="card error" role="alert">
            {error}
          </div>
        )}
      </main>
    </>
  );
}
