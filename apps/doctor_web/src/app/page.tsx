'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, clearToken, readToken, storeToken } from '@/lib/api';

/**
 * Sign-in.
 *
 * MediKiosk holds no staff password. What this collects is a credential the hospital's
 * identity provider understands, which is passed straight through — in a real deployment
 * this page is replaced by a redirect to the hospital's OIDC endpoint, and the box below
 * exists because the sandbox provider is what runs today.
 */
export default function SignInPage() {
  const router = useRouter();
  const [credential, setCredential] = useState('sandbox:');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (readToken()) router.replace('/worklist');
  }, [router]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.signIn(credential.trim());
      storeToken(result.token);
      router.push('/worklist');
    } catch (caught) {
      clearToken();
      // The server answers identically whether the credential was wrong or the person has
      // no staff record here, so there is nothing more specific to say and saying more
      // would be inventing it.
      setError(
        caught instanceof ApiError && caught.code === 'RATE_LIMITED'
          ? 'Too many attempts. Wait a few minutes before trying again.'
          : 'That sign-in was not accepted.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, paddingTop: 64 }}>
      <h1>MediKiosk</h1>
      <p className="muted">Clinician sign-in</p>

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
        <p className="muted" style={{ marginTop: 8 }}>
          Development build: use <code>sandbox:&lt;your subject&gt;</code>. A real deployment
          redirects to the hospital identity provider instead.
        </p>
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
