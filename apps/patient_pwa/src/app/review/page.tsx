'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { readJourney, updateJourney, type Journey } from '@/lib/journey';

const DEPARTMENT_ID = process.env['NEXT_PUBLIC_DEPARTMENT_ID'] ?? 'AYU-OPD';
const BRANCH_ID = process.env['NEXT_PUBLIC_BRANCH_ID'] ?? 'MAIN';
const HOSPITAL_ID = process.env['NEXT_PUBLIC_HOSPITAL_CODE'] ?? 'HOSP-001';

export default function ReviewPage() {
  const router = useRouter();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = readJourney();
    if (!current.consentId || !current.name) {
      router.replace('/');
      return;
    }
    setJourney(current);
  }, [router]);

  const submit = async (): Promise<void> => {
    if (!journey?.consentId) return;
    setBusy(true);
    setError(null);

    try {
      // The visit window is what the kiosk checks the arrival against. A day-long window
      // is the honest default until appointment scheduling is integrated: narrowing it
      // arbitrarily would turn a late bus into a refused check-in.
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const created = await api.createPreCheckin({
        consentId: journey.consentId,
        visit: {
          hospitalId: HOSPITAL_ID,
          branchId: BRANCH_ID,
          departmentId: DEPARTMENT_ID,
          visitType: journey.visitType ?? 'NEW_COMPLAINT',
          visitWindowStart: start.toISOString(),
          visitWindowEnd: end.toISOString(),
        },
        demographics: {
          name: journey.name,
          sex: journey.sex,
          dateOfBirth: journey.dateOfBirth,
          mobile: journey.mobile,
        },
      });

      await api.submit(created.preCheckinId);
      updateJourney({ preCheckinId: created.preCheckinId });
      router.push('/qr');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.patientMessage : 'Something went wrong.');
      setBusy(false);
    }
  };

  if (!journey) return <p className="muted">Loading…</p>;

  const row = (label: string, value: string | undefined) => (
    <p key={label}>
      <span className="muted">{label}: </span>
      {value ?? '—'}
    </p>
  );

  return (
    <>
      <h1>Check your details</h1>
      <p className="muted">
        This is what will be sent to the hospital. You can go back and change anything.
      </p>

      <div className="notice">
        {row('Hospital', journey.hospitalName)}
        {row('Name', journey.name)}
        {row('Date of birth', journey.dateOfBirth)}
        {row('Mobile', journey.mobile)}
        {row(
          'Visit',
          journey.visitType === 'REGULAR_FOLLOW_UP' ? 'Regular follow-up' : 'A new problem',
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {/* Review is not a formality: submitting is what sends this to the hospital, so it
          has to be a separate, deliberate act from filling the form in. */}
      <button className="primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Sending…' : 'I have checked this — send it'}
      </button>
      <button disabled={busy} onClick={() => router.push('/details')}>
        Go back and change something
      </button>
    </>
  );
}
