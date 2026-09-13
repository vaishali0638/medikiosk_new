const isDev = process.env.NODE_ENV !== 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The PWA handles health information. Nothing here should be cached by an intermediary
  // or leak a referrer to a third party.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
              // 'unsafe-eval' in development only. Next's dev server compiles modules with
              // eval for hot reload, and without it the client bundle throws on load, React
              // never hydrates, and every form on the site is silently inert — the page
              // renders correctly and simply does not respond. The production build needs
              // no eval and does not get it.
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}; ` +
              "connect-src 'self' " +
              (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
