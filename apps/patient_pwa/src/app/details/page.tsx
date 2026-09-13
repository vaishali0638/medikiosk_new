'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readJourney, updateJourney } from '@/lib/journey';

export default function DetailsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [sex, setSex] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [mobile, setMobile] = useState('');
  const [visitType, setVisitType] = useState<'NEW_COMPLAINT' | 'REGULAR_FOLLOW_UP'>(
    'NEW_COMPLAINT',
  );

  useEffect(() => {
    const journey = readJourney();
    if (!journey.consentId) {
      // No consent, no collection. Reaching this page directly must not work.
      router.replace('/');
      return;
    }
    setName(journey.name ?? '');
    setSex(journey.sex ?? '');
    setDateOfBirth(journey.dateOfBirth ?? '');
    setMobile(journey.mobile ?? '');
    setReady(true);
  }, [router]);

  const mobileValid = /^[6-9]\d{9}$/.test(mobile);
  const complete = name.trim().length > 0 && sex !== '' && dateOfBirth !== '' && mobileValid;

  if (!ready) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Your details</h1>
      <p className="muted">These go to the doctor you see. Nothing else is shared.</p>

      <label htmlFor="name">Full name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />

      <label htmlFor="sex">Sex</label>
      <select id="sex" value={sex} onChange={(e) => setSex(e.target.value)}>
        <option value="">Please choose</option>
        <option value="FEMALE">Female</option>
        <option value="MALE">Male</option>
        <option value="OTHER">Other</option>
        <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
      </select>

      <label htmlFor="dob">Date of birth</label>
      <input
        id="dob"
        type="date"
        value={dateOfBirth}
        onChange={(e) => setDateOfBirth(e.target.value)}
      />

      <label htmlFor="mobile">Mobile number</label>
      <input
        id="mobile"
        inputMode="numeric"
        value={mobile}
        maxLength={10}
        onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
        autoComplete="tel-national"
      />
      {mobile.length > 0 && !mobileValid && (
        <p className="muted">Please enter the 10 digits of your mobile number.</p>
      )}

      <label htmlFor="visit">Is this a new problem or a follow-up?</label>
      <select
        id="visit"
        value={visitType}
        onChange={(e) => setVisitType(e.target.value as typeof visitType)}
      >
        <option value="NEW_COMPLAINT">A new problem</option>
        <option value="REGULAR_FOLLOW_UP">A regular follow-up</option>
      </select>

      <button
        className="primary"
        disabled={!complete}
        onClick={() => {
          updateJourney({ name, sex, dateOfBirth, mobile, visitType });
          router.push('/review');
        }}
      >
        Continue
      </button>
    </>
  );
}
