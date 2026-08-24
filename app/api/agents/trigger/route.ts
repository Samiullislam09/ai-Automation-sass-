import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { AGENT_JOB_TYPES, enqueueAgentJob, type AgentJobType } from "@/lib/agent-jobs";

/** Thin, auth-checked proxy in front of agent-server's generic POST /jobs/:type — lets the
 *  dashboard ("Run the team", and chat's "write me an article") enqueue a real pg-boss job
 *  without the browser ever knowing the tenant id or agent-server's URL. tenantId is resolved
 *  server-side from the session, never trusted from the request body.
 *  "boss" is the orchestrator (agent-server/src/agents/boss.ts): it plans topics from the
 *  tenant's own niche/crawled pages and starts the keyword -> writer chain itself. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { type, ...rest } = await req.json().catch(() => ({}));
  if (!AGENT_JOB_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: `Unsupported agent type. Use one of: ${AGENT_JOB_TYPES.join(", ")}` }, { status: 400 });
  }

  const result = await enqueueAgentJob(type as AgentJobType, tenantId, rest);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 502 });
  return NextResponse.json({ ok: true, jobId: result.jobId });
}
