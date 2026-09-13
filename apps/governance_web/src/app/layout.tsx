import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediKiosk — clinical governance',
  description: 'Authoring, approval, canary release, publication and rollback.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
