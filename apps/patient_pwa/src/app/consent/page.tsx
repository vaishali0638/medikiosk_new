'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type ConsentNotice } from '@/lib/api';
import { readJourney, updateJourney } from '@/lib/journey';

export default function ConsentPage() {
  const router = useRouter();
  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const language = readJourney().language;

  useEffect(() => {
    if (!language) {
      router.replace('/');
      return;
    }
    api
      .notice(language)
      .then(setNotice)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.patientMessage : 'Something went wrong.'),
      );
  }, [language, router]);

  const decide = async (decision: 'GRANTED' | 'DECLINED'): Promise<void> => {
    if (!language) return;
    setBusy(true);
    try {
      const result = await api.consent(language, decision);
      if (decision === 'DECLINED') {
        setDeclined(true);
        return;
      }
      updateJourney({ consentId: result.consentId, noticeVersion: result.noticeVersion });
      router.push('/details');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.patientMessage : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (declined) {
    return (
      <>
        <h1>You have chosen not to provide digital consent</h1>
        <p>
          This pre-check-in will not continue. You can still be seen at the hospital counter in the
          usual way.
        </p>
      </>
    );
  }

  if (error) return <p className="error">{error}</p>;
  if (!notice) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>{notice.title}</h1>

      <div className="notice">
        <p>We will collect:</p>
        <ul>
          {notice.collectedItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="muted">Purpose</p>
        <p>{notice.purpose}</p>
      </div>

      <button onClick={() => setShowFull((v) => !v)}>
        {showFull ? 'Hide full notice' : 'Read full notice'}
      </button>

      {showFull && (
        <div className="notice">
          <p style={{ whiteSpace: 'pre-wrap' }}>{notice.fullText}</p>
          <p className="muted">
            Notice version: {notice.version}
            {notice.approvedBy.length > 0 && ` · Approved by: ${notice.approvedBy.join(', ')}`}
          </p>
        </div>
      )}

      {/* Agree and decline are the same size, for the same reason as on the kiosk:
          a quieter decline is a nudge, and consent that has been nudged is not freely given. */}
      <button className="primary" disabled={busy} onClick={() => void decide('GRANTED')}>
        Agree and continue
      </button>
      <button disabled={busy} onClick={() => void decide('DECLINED')}>
        Do not agree
      </button>

      <p className="muted">Notice version: {notice.version}</p>
    </>
  );
}
