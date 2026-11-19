import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Without this, Next.js walks up from this folder looking for a single lockfile to infer the
  // "workspace root" — and D:\Trip_traveling_guide_auto_dashboard has several sibling projects
  // each with their own lockfile, so it gave up and fell back to watching all of D:\ (including
  // system folders like "System Volume Information"). That's what was making every dev-server
  // request take 5-30s and eventually corrupting the webpack cache. Pinning the root to this
  // project folder stops the climb. (Next 14.2.x still nests this under `experimental` — it's a
  // top-level option in newer versions.)
  // staleTimes.dynamic: a dashboard page you opened in the last 30 s comes back from the browser's own cache the instant you click it (a page whose data is read on the server
  // otherwise waits for that request); the page still refreshes its numbers behind the scenes.
  experimental: { outputFileTracingRoot: __dirname, staleTimes: { dynamic: 30, static: 180 } },
  // The old /app/** area was retired in favour of /dashboard/**. Old bookmarks and links already
  // stored in chat messages / emails keep working through these redirects (temporary, 307).
  poweredByHeader: false,
  // Security headers on every response (website audit, 2026-11-16: only HSTS was set, and the login page could be framed by any site).
  //  - frame-ancestors 'none' + X-Frame-Options: nothing may embed this app in a frame (clickjacking). The app embeds no iframes of its own.
  //  - script-src keeps 'unsafe-inline' because Next.js writes inline bootstrap scripts; a nonce-based CSP is the next step.
  //  - connect-src is https:/wss: because the dashboard talks to Supabase, the agent server (Socket.io) and Google.
  //  - microphone=(self) is kept for the voice input in the chat.
  async headers() {
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: wss: http://localhost:* ws://localhost:*",
      "frame-src 'self' https: blob: data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/app", destination: "/dashboard", permanent: false },
      { source: "/app/billing", destination: "/dashboard/account", permanent: false },
      { source: "/app/:path*", destination: "/dashboard/:path*", permanent: false },
    ];
  },
};
export default nextConfig;
