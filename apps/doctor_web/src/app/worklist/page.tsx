'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiBaseUrl, ApiError, clearToken, readToken, type WorklistEntry } from '@/lib/api';
import { TopBar } from '@/components/top-bar';

export default function WorklistPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<WorklistEntry[]>([]);
  const [search, setSearch] = useState('');
  // Read by the stream handler without making it a dependency: re-subscribing on every
  // keystroke would tear the connection down and build it up again as the doctor types.
  const searchRef = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (term?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.worklist(term);
        setEntries(result.entries);
      } catch (caught) {
        if (caught instanceof ApiError && caught.needsSignIn) {
          clearToken();
          router.replace('/');
          return;
        }
        setError(
          caught instanceof ApiError && caught.needsBreakGlass
            ? 'Your role does not have a clinical worklist.'
            : 'Could not load the worklist.',
        );
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!readToken()) {
      router.replace('/');
      return;
    }
    void load();
  }, [load, router]);

  // Live updates.
  //
  // The stream carries no patient data — only "your worklist changed" — and this re-fetches
  // through the same authenticated, department-scoped endpoint as the first load. One place
  // decides who sees which patient, and it is not this component.
  //
  // fetch with a reader rather than EventSource, which cannot set headers: the alternative
  // is the session token in a query string, where it lands in every proxy and access log
  // between here and the API. A staff token opens patient records.
  useEffect(() => {
    const token = readToken();
    if (!token) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/v1/doctor/worklist/stream`, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line. Keep the tail: a chunk boundary can fall
          // anywhere, including the middle of one.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            if (frame.includes('event: worklist')) void load(searchRef.current || undefined);
          }
        }
      } catch {
        // An aborted or dropped stream is not something a clinician needs told. The list
        // they are looking at is still the list as of the last fetch.
      }
    })();

    return () => controller.abort();
  }, [load]);

  return (
    <>
      <TopBar />
      <main>
        <h1>Today</h1>
        <p className="muted">
          Your department only. Names are shortened — the full record opens when you do.
        </p>

        <form
          className="row"
          style={{ margin: '16px 0' }}
          onSubmit={(e) => {
            e.preventDefault();
            void load(search);
          }}
        >
          <input
            aria-label="Search by token or UHID"
            placeholder="Token or UHID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              searchRef.current = e.target.value;
            }}
            style={{ maxWidth: 260 }}
          />
          <button type="submit">Search</button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                searchRef.current = '';
                void load();
              }}
            >
              Clear
            </button>
          )}
        </form>
        {/* Not searchable by name, deliberately: that would make the worklist a way to
            check whether a particular person attended, which department scoping exists
            to prevent. */}

        {error && (
          <div className="card error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No patients are waiting in your department.
            </p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Patient</th>
                <th>Department</th>
                <th>Intake</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.encounterId}
                  className="clickable"
                  onClick={() => router.push(`/encounters/${entry.encounterId}`)}
                >
                  <td>
                    <strong>{entry.token ?? '—'}</strong>
                  </td>
                  <td>{entry.maskedName}</td>
                  <td>{entry.departmentName}</td>
                  <td className="muted">
                    {entry.hasDraft ? 'Draft ready' : 'No intake'}
                    {entry.documentCount > 0 && ` · ${entry.documentCount} document(s)`}
                  </td>
                  <td>
                    <span className={`label${entry.verified ? ' verified' : ''}`}>
                      {entry.verified ? 'Confirmed' : 'Awaiting review'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
