import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediKiosk — Prepare your hospital visit',
  description: 'Complete your hospital pre-check-in before you arrive.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available. Pinch-zoom is how many patients read small text, and disabling
  // it is a common accessibility failure in mobile health apps.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
