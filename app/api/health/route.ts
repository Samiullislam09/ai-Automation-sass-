import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Deployment self-check.
 *
 *  PUBLIC: only `{ "ok": true }` — enough for an uptime monitor, nothing an attacker can aim at.
 *  DETAILED: the same booleans as before (which env vars are present, whether the agent server answers, the deployed commit) are returned
 *  only when the request carries the shared secret in the `x-agent-token` header (AGENT_SERVER_TOKEN). Never a value, never a key.
 *  Why it exists: "Agent server not configured." on a deployed site is indistinguishable from "the var was added but the deployment was
 *  never rebuilt"; hit /api/health with the header and you know. (Website audit, 2026-11-16: the detailed answer was public.) */
export async function GET(req: Request) {
  const secret = process.env.AGENT_SERVER_TOKEN;
  const trusted = !!secret && req.headers.get("x-agent-token") === secret;
  if (!trusted) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

  const agentServerUrl = process.env.AGENT_SERVER_URL;

  let agentServer: { configured: boolean; reachable: boolean; error: string | null } = {
    configured: !!agentServerUrl,
    reachable: false,
    error: agentServerUrl ? null : "AGENT_SERVER_URL is not set in this deployment.",
  };

  if (agentServerUrl) {
    try {
      const res = await fetch(`${agentServerUrl.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      agentServer.reachable = res.ok;
      if (!res.ok) agentServer.error = `Agent server answered ${res.status}.`;
    } catch (e: any) {
      agentServer.error = e?.message ?? "Could not reach the agent server.";
    }
  }

  return NextResponse.json(
    {
      ok: true,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      env: {
        supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        supabaseServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        nvidiaApiKey: !!process.env.NVIDIA_API_KEY,
        agentServerUrl: !!agentServerUrl,
      },
      agentServer,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
