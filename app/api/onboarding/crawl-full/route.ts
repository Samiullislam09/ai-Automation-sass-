import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Manually (re-)triggers the full background site crawl (agent-server's "crawler" agent)
 *  for the signed-in user's tenant — for tenants who onboarded before this existed, and as
 *  a general "re-analyze my site" action (e.g. a future Memory-page button) going forward. */
export async function POST() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const agentServerUrl = process.env.AGENT_SERVER_URL;
  if (!agentServerUrl) return NextResponse.json({ ok: false, error: "AGENT_SERVER_URL not configured." }, { status: 500 });

  const res = await fetch(`${agentServerUrl}/jobs/crawler`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  }).catch((e) => null);

  if (!res || !res.ok) return NextResponse.json({ ok: false, error: "Could not reach the crawl job queue." }, { status: 502 });
  const data = await res.json();
  return NextResponse.json({ ok: true, jobId: data.jobId });
}
