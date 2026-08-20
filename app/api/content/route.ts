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

  const status = req.nextUrl.searchParams.get("status") || "awaiting_approval";
  const { data, error } = await supabase
    .from("content_items")
    .select("id, type, status, title, body, meta, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data });
}
