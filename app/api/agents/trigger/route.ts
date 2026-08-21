import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Thin, auth-checked proxy in front of agent-server's generic POST /jobs/:type — lets the
 *  dashboard (chat's "new task: X" command, and any future real trigger button) enqueue a
 *  real pg-boss job without the browser ever knowing the tenant id or agent-server's URL.
 *  tenantId is resolved server-side from the session, never trusted from the request body. */
const ALLOWED_TYPES = ["keyword", "writer", "social", "seo"];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const agentServerUrl = process.env.AGENT_SERVER_URL;
  if (!agentServerUrl) return NextResponse.json({ ok: false, error: "Agent server not configured." }, { status: 503 });

  const { type, ...rest } = await req.json().catch(() => ({}));
  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: `Unsupported agent type. Use one of: ${ALLOWED_TYPES.join(", ")}` }, { status: 400 });
  }

  try {
    const res = await fetch(`${agentServerUrl}/jobs/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, ...rest }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ ok: false, error: data.error ?? "Agent server rejected the job." }, { status: res.status });
    return NextResponse.json({ ok: true, jobId: data.jobId });
  } catch (e: any) {
    console.error("[agents/trigger] failed:", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
