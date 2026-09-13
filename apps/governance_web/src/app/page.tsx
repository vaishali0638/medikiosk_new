'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, clearToken, readToken, storeToken } from '@/lib/api';

export default function SignInPage(): React.ReactElement {
  const router = useRouter();
  const [credential, setCredential] = useState('sandbox:');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (readToken()) router.replace('/releases');
  }, [router]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.signIn(credential.trim());
      if (result.role !== 'GOVERNANCE_REVIEWER') {
        // Checked again on every endpoint. Refusing here is a courtesy so somebody with the
        // wrong role finds out now rather than after loading a console that does nothing.
        clearToken();
        setError('This console is for governance reviewers.');
        return;
      }
      storeToken(result.token);
      router.push('/releases');
    } catch (caught) {
      clearToken();
      setError(
        caught instanceof ApiError && caught.code === 'RATE_LIMITED'
          ? 'Too many attempts. Wait a few minutes.'
          : 'That sign-in was not accepted.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, paddingTop: 64 }}>
      <h1>Clinical governance</h1>
      <p className="muted">Content authoring, review and release</p>

      <form className="card" onSubmit={submit} style={{ marginTop: 24 }}>
        <label htmlFor="credential">Hospital identity credential</label>
        <input
          id="credential"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {error && (
        <div className="card error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
