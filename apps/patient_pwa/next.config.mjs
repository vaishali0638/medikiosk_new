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
              "script-src 'self' 'unsafe-inline'; connect-src 'self' " +
              (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
