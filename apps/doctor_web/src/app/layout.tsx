import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediKiosk — clinician',
  description: 'Worklist, case review, confirmation and EMR export.',
  // A consulting-room screen is often visible from the corridor. Nothing about this
  // application should end up in a search index or a browser's shared history sync.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
