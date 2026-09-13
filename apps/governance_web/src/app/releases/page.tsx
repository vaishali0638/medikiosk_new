'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, clearToken, readToken, type Missing, type Release } from '@/lib/api';
import { TopBar } from '@/components/top-bar';

const STATE_ORDER = ['CANARY', 'PUBLISHED', 'APPROVED', 'IN_REVIEW', 'DRAFT'];

export default function ReleasesPage(): React.ReactElement {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, gaps] = await Promise.all([api.releases(), api.unversioned()]);
      setReleases(list.releases);
      setMissing(gaps.missing);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.needsSignIn) {
        clearToken();
        router.replace('/');
        return;
      }
      setError('Could not load releases.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!readToken()) {
      router.replace('/');
      return;
    }
    void load();
  }, [load, router]);

  const live = releases.filter((r) => r.state === 'PUBLISHED' || r.state === 'CANARY');
  const working = releases.filter(
    (r) => !['PUBLISHED', 'CANARY', 'RETIRED', 'ROLLED_BACK'].includes(r.state),
  );
  const past = releases.filter((r) => ['RETIRED', 'ROLLED_BACK'].includes(r.state));

  return (
    <>
      <TopBar />
      <main>
        <div className="row">
          <h1>Clinical content</h1>
          <span className="spacer" />
          <button className="primary" type="button" onClick={() => router.push('/releases/new')}>
            New draft
          </button>
        </div>

        {error && (
          <div className="card error" role="alert">
            {error}
          </div>
        )}

        {/* First, because a hospital cannot run an intake without this content and the
            list is the answer to "is the kiosk usable yet". Reported per language: a
            hospital offering Hindi with no Hindi notice is not partly ready. */}
        {missing.length > 0 && (
          <section className="card draft">
            <span className="banner">Not yet publishable</span>
            <p style={{ marginTop: 0 }}>
              These kiosks cannot run an intake until this content is approved and published.
            </p>
            {missing.map((gap) => (
              <div className="statement" key={`${gap.kind}:${gap.key}`}>
                <span className="text">
                  <strong>{gap.key}</strong> <span className="muted">— {gap.why}</span>
                </span>
                <span className="label">{gap.kind}</span>
              </div>
            ))}
          </section>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <Group title="Live" releases={live} onOpen={(id) => router.push(`/releases/${id}`)} />
            <Group
              title="In progress"
              releases={working}
              onOpen={(id) => router.push(`/releases/${id}`)}
            />
            <Group title="Past" releases={past} onOpen={(id) => router.push(`/releases/${id}`)} />
          </>
        )}
      </main>
    </>
  );
}

function Group({
  title,
  releases,
  onOpen,
}: {
  title: string;
  releases: Release[];
  onOpen: (id: string) => void;
}): React.ReactElement | null {
  if (releases.length === 0) return null;

  const sorted = [...releases].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
  );

  return (
    <>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Content</th>
            <th>Version</th>
            <th>State</th>
            <th>Approvals</th>
            <th>Published by</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((release) => (
            <tr key={release.id} className="clickable" onClick={() => onOpen(release.id)}>
              <td>
                <strong>{release.contentKey}</strong>
                <div className="muted">{release.contentKind}</div>
              </td>
              <td>{release.semver}</td>
              <td>
                <span
                  className={`label${release.state === 'PUBLISHED' ? ' verified' : release.state === 'CANARY' ? ' ocr' : ''}`}
                >
                  {release.state}
                </span>
                {release.state === 'CANARY' && (
                  <div className="muted">{release.canaryKioskCodes.join(', ')}</div>
                )}
              </td>
              <td className="muted">{release.approvals?.length ?? 0}</td>
              <td className="muted">
                {release.publishedBy ? release.publishedBy.slice(0, 8) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
