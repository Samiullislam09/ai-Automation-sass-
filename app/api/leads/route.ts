import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Real `leads` table — written by agent-server's Mr. Lead (agents/leads.ts) as a row per
 *  qualified lead, stage "draft": researched, scored and a message written, nothing sent.
 *  This is the page that agent's own comments call "the Leads page's Approve button" — it
 *  never existed until now. `select("*")` rather than a fixed column list because the richer
 *  outreach columns (website, domain, draft, channel, observation, evidence) only exist once
 *  `agents/leads.ts`'s probe has found them on this database — a fixed select would 500 on a
 *  database that hasn't run that migration yet. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const stage = req.nextUrl.searchParams.get("stage") || "all";
  let query = supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (stage !== "all") query = query.eq("stage", stage);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data });
}
