'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { api, ApiError } from '@/lib/api';
import { readJourney } from '@/lib/journey';

export default function QrPage() {
  const router = useRouter();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preCheckinId = readJourney().preCheckinId;

  const issue = useCallback(async (): Promise<void> => {
    if (!preCheckinId) return;
    setBusy(true);
    setError(null);
    try {
      const qr = await api.issueQr(preCheckinId);
      // Rendered locally. The payload never goes to a third-party QR service — it is a
      // signed credential for this patient's visit.
      setDataUrl(await QRCode.toDataURL(qr.payload, { errorCorrectionLevel: 'M', margin: 2 }));
      setExpiresAt(new Date(qr.expiresAt));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.patientMessage : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [preCheckinId]);

  useEffect(() => {
    if (!preCheckinId) {
      router.replace('/');
      return;
    }
    void issue();
  }, [preCheckinId, router, issue]);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = (): void =>
      setSecondsLeft(Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const expired = expiresAt !== null && secondsLeft <= 0;

  return (
    <>
      <h1>Pre-check-in completed</h1>
      <p>Scan this QR at the hospital kiosk to receive your final token.</p>

      {error && <p className="error">{error}</p>}

      {dataUrl && !expired && (
        <>
          {/* A plain img, not next/image: the source is a locally generated data URL,
              so there is nothing for an image optimiser to fetch or resize. */}
          <img className="qr" src={dataUrl} alt="Your check-in QR code" />
          <p className="muted" style={{ textAlign: 'center' }}>
            This code expires in {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, '0')}
          </p>
        </>
      )}

      {expired && (
        <p className="error">
          This code has expired. Codes are short-lived so they cannot be used by anyone else. Show a
          new one when you reach the hospital.
        </p>
      )}

      {/* Re-issuing is offered HERE, on the patient's own phone, because this is the only
          place it can safely happen: the kiosk cannot issue codes, which is why its
          rejection screen deliberately offers no equivalent. */}
      <button className="primary" disabled={busy} onClick={() => void issue()}>
        {busy ? 'Preparing…' : 'Show a new code'}
      </button>

      <p className="muted">
        Your token is issued by the hospital when you scan this at the kiosk — not by this app.
      </p>
    </>
  );
}
