import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { enqueueAgentJob } from "@/lib/agent-jobs";

/** Manually (re-)triggers the full background site crawl (agent-server's "crawler" agent)
 *  for the signed-in user's tenant — for tenants who onboarded before this existed, and as
 *  a general "re-analyze my site" action (e.g. a future Memory-page button) going forward. */
export async function POST() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Through enqueueAgentJob rather than a bare fetch: agent-server's /jobs is behind
  // AGENT_SERVER_TOKEN now, and this route was still calling it without the header — so it had
  // been answering 401 to every "re-analyze my site" since the gate went on.
  const result = await enqueueAgentJob("crawler", tenantId, { taskLabel: "Reading your site" });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 502 });

  return NextResponse.json({ ok: true, jobId: result.jobId });
}
