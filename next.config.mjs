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
  experimental: { outputFileTracingRoot: __dirname },
};
export default nextConfig;
