import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Real content_items list — Build Guide Step 12. Powers the Approvals page (and, with a
 *  different status filter, could power a future "Content" history page). Replaces the
 *  old demo's s.content client-only array. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // "all" powers the Content page, which used to read a local demo array and therefore said
  // "No content yet" to people whose articles were sitting in the database.
  const status = req.nextUrl.searchParams.get("status") || "awaiting_approval";
  let query = supabase
    .from("content_items")
    .select("id, type, status, title, cluster, meta, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data });
}
