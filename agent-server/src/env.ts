import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  REDIS_URL: required("REDIS_URL"),
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:3000",
  DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN || "",
  DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD || "",
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || "",
};
