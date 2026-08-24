import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Deployment self-check. Deliberately public and deliberately boring: it reports only
 *  BOOLEANS (is this env var present?) plus the commit the running build came from — never a
 *  value, never a key. Reason it exists: "Agent server not configured." on a deployed site is
 *  indistinguishable from "the var was added but the deployment was never rebuilt", and
 *  guessing at that from screenshots wasted a whole round trip. Hit /api/health and you know. */
export async function GET() {
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

  return NextResponse.json({
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
  });
}
