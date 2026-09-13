'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, clearToken, readToken, type WorklistEntry } from '@/lib/api';
import { TopBar } from '@/components/top-bar';

export default function WorklistPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<WorklistEntry[]>([]);
  const [search, setSearch] = useState('');
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
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <button type="submit">Search</button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
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
