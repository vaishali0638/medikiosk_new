'use client';

import { useRouter } from 'next/navigation';
import { api, clearToken } from '@/lib/api';

export function TopBar(): React.ReactElement {
  const router = useRouter();

  async function signOut(): Promise<void> {
    try {
      await api.signOut();
    } finally {
      clearToken();
      router.replace('/');
    }
  }

  return (
    <div className="topbar">
      <strong style={{ color: 'var(--mk-dark-blue)' }}>MediKiosk governance</strong>
      <span className="spacer" />
      <button type="button" onClick={() => router.push('/releases')}>
        Releases
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
