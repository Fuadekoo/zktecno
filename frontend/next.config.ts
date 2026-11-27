import os from 'node:os';
import type { NextConfig } from 'next';

const backend = process.env.BACKEND_URL || 'http://localhost:4000';

/**
 * In `next dev`, Next.js blocks page assets requested from an address other than localhost.
 * Allow every IPv4 address of this machine (so http://<your-ip>:3000 works from phones and other PCs),
 * plus anything listed in ALLOWED_DEV_ORIGINS (comma-separated hostnames or IPs).
 */
function localAddresses() {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
  const extra = (process.env.ALLOWED_DEV_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([...ips, ...extra])];
}

/**
 * DESKTOP_BUILD=1 (npm run build:desktop): export plain HTML/JS files to ./out instead of running a
 * Next.js server. The backend serves them on its own port (STATIC_DIR), so /api is the same origin and
 * no proxy is needed. Every page is a client component, so nothing is lost.
 */
const desktop = process.env.DESKTOP_BUILD === '1';

const nextConfig: NextConfig = {
  ...(desktop && { output: 'export' as const, images: { unoptimized: true } }),
  // This folder is the app root (a package-lock.json also exists one level up for the run-both scripts).
  turbopack: { root: process.cwd() },
  allowedDevOrigins: localAddresses(),
  // The browser only talks to Next.js; /api/* is forwarded to the Express backend.
  // Same origin means the httpOnly session cookie just works, and there are no CORS issues.
  ...(!desktop && {
    async rewrites() {
      return [
        { source: '/api/:path*', destination: `${backend}/api/:path*` },
        // Attendance devices pushing here (ADMS "Cloud Server Setting" = this address and port)
        { source: '/iclock/:path*', destination: `${backend}/iclock/:path*` },
      ];
    },
  }),
};

export default nextConfig;
