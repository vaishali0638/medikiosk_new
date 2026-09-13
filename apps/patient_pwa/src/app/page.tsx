'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type HospitalInfo } from '@/lib/api';
import { clearJourney, updateJourney } from '@/lib/journey';

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  bn: 'বাংলা',
  mr: 'मराठी',
};

export default function LanguagePage() {
  const router = useRouter();
  const [hospital, setHospital] = useState<HospitalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A fresh visit starts clean: a half-finished journey from a previous session on a
    // shared phone must not be resumed by whoever opens the page next.
    clearJourney();
    api
      .hospital()
      .then(setHospital)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.patientMessage : 'Something went wrong.'),
      );
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!hospital) return <p className="muted">Loading…</p>;

  // The server returns only languages with a published consent notice, so every option
  // here can carry the patient all the way through.
  const languages = hospital.languages;

  return (
    <>
      <h1>{hospital.hospitalName}</h1>
      <p className="muted">Choose your language to prepare your visit.</p>

      {languages.length === 0 ? (
        <p className="error">
          Online pre-check-in is not available at this hospital yet. Please check in at the counter
          as usual.
        </p>
      ) : (
        languages.map((tag) => (
          <button
            key={tag}
            className="primary"
            onClick={() => {
              updateJourney({ language: tag, hospitalName: hospital.hospitalName });
              router.push('/consent');
            }}
          >
            {LANGUAGE_LABELS[tag] ?? tag}
          </button>
        ))
      )}
    </>
  );
}
