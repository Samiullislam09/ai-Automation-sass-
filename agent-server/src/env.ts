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
  // Shared secret between the Next.js app and this server. Optional so an existing deploy
  // does not break the moment this ships, but /jobs/:type is a public URL that spends real
  // LLM + DataForSEO credits: set it in BOTH Railway and Vercel and the endpoint locks.
  AGENT_SERVER_TOKEN: process.env.AGENT_SERVER_TOKEN || "",
};
