import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getAgentDetail } from "@/lib/dashboard-data";
import { AGENTS } from "@/lib/agents-data";

/** GET /api/dashboard/agent/kw — everything one agent has really done: its live state, its
 *  last dozen jobs with what each produced, and (for the writing side) the content rows those
 *  jobs created. Powers the "click a room, watch that one agent" view on the dashboard. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const agent = AGENTS.find((a) => a.id === params.id);
  if (!agent) return NextResponse.json({ ok: false, error: "Unknown agent." }, { status: 404 });

  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const detail = await getAgentDetail(supabase, tenantId, agent.id);

  return NextResponse.json({
    ok: true,
    agent: { id: agent.id, name: agent.name, role: agent.role, ico: agent.ico, color: agent.c, live: agent.live },
    ...detail,
  });
}
