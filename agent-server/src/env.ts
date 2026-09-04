import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  // Postgres connection string for the job queue (pg-boss) — Supabase project's
  // "Connection string" (Project Settings -> Database), not the service-role API key.
  DATABASE_URL: required("DATABASE_URL"),
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:3000",
  DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN || "",
  DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD || "",
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || "",
  // Comma-separated pool of NVIDIA keys reserved for THIS server's background/bulk work
  // (crawler, keyword, writer, seo, analyst) — never shared with the Next.js app's live chat
  // or article-revise keys (NVIDIA_API_KEYS_CHAT, lib/ai/nvidiaKeys.ts), so a heavy crawl or
  // backfill can never starve a human waiting on chat. Falls back to the single NVIDIA_API_KEY
  // when unset, so nothing breaks before this pool is configured. See src/lib/nvidia.ts.
  NVIDIA_API_KEYS_BG: process.env.NVIDIA_API_KEYS_BG || "",
  // Requests per minute PER KEY in the pool above. build.nvidia.com shows the account's
  // ceiling ("Up to 40 rpm" on the free tier per key) and the API returns no quota headers, so
  // the limit has to be respected on our side. Default 35 — a small safety margin under 40 for
  // send/receive timing skew, not headroom-for-chat (that's now a structurally separate pool,
  // not a shared budget). Raise it to match a paid tier. See src/lib/nvidia.ts.
  NVIDIA_RPM: process.env.NVIDIA_RPM || "",
  // Cloudflare Workers AI — Mr. Image's primary image generator (MASTER_PLAN §19.4).
  // One account gives 10,000 free neurons a day, and one FLUX image costs 172.8 of them
  // (measured 2026-09-05), so a single account is ~57 images/day for the whole SaaS. Hence a
  // POOL: when one account's daily quota is gone the next one takes over, and they all come
  // back at 00:00 UTC. Same shape as NVIDIA_API_KEYS_BG above, except a Cloudflare credential
  // is a PAIR — the token only works with its own account id:
  //
  //   CLOUDFLARE_ACCOUNTS="accountid1:token1,accountid2:token2,accountid3:token3"
  //
  // The single-account pair below still works on its own (and is used as the first account in
  // the pool when CLOUDFLARE_ACCOUNTS is empty), so nothing breaks before the pool is filled.
  CLOUDFLARE_ACCOUNTS: process.env.CLOUDFLARE_ACCOUNTS || "",
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || "",
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "",
  // Stock photos, for the "a real photo, not an AI one" cases (restaurant, clinic). Optional:
  // without them the ladder in lib/media/providers.ts simply skips that rung.
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || "",
  PEXELS_API_KEY: process.env.PEXELS_API_KEY || "",

  // Shared secret between the Next.js app and this server. Optional so an existing deploy
  // does not break the moment this ships, but /jobs/:type is a public URL that spends real
  // LLM + DataForSEO credits: set it in BOTH Railway and Vercel and the endpoint locks.
  AGENT_SERVER_TOKEN: process.env.AGENT_SERVER_TOKEN || "",
  // Base URL of the Next.js app (e.g. https://yourapp.vercel.app). Used to ask it to refresh
  // Google Search Console / GA4 data before planning — the Google refresh token is encrypted
  // with a key that only the web side has, so this server never touches it directly.
  // Needs AGENT_SERVER_TOKEN set on both sides; without both, the refresh is simply skipped.
  WEB_APP_URL: process.env.WEB_APP_URL || "",
};
