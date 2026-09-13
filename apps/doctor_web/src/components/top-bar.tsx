'use client';

import { useRouter } from 'next/navigation';
import { api, clearToken } from '@/lib/api';

export function TopBar(): React.ReactElement {
  const router = useRouter();

  async function signOut(): Promise<void> {
    // Revoke server-side first, then clear locally. The other order leaves a live session
    // on the server that the browser has simply forgotten about — which on a shared
    // consulting-room machine is the whole problem.
    try {
      await api.signOut();
    } finally {
      clearToken();
      router.replace('/');
    }
  }

  return (
    <div className="topbar">
      <strong style={{ color: 'var(--mk-dark-blue)' }}>MediKiosk</strong>
      <span className="spacer" />
      <button type="button" onClick={() => router.push('/worklist')}>
        Worklist
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
