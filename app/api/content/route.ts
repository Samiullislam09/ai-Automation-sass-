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
    // `blueprint` is here for the three reviewable parts of one order (MASTER_PLAN §19.4.7):
    // an image_set and a web_story carry `blueprint.parent_article_id`, which is how Approvals
    // groups them under their article and how the "another image" button knows which article
    // to ask about.
    // `parent_article_id:blueprint->>parent_article_id`, not `blueprint`. The blueprint is the
    // article's full outline; the ONE thing this list needs from it is which article an
    // image_set or web_story belongs under (ApprovalsSection reads `c.blueprint
    // ?.parent_article_id`), and the response below is rebuilt into that exact shape so no
    // caller changes. Up to 100 outlines per call, on a list the dashboard shell re-reads
    // every 60 seconds. (2026-09-05 egress audit, finding #5.)
    .select("id, type, status, title, cluster, meta, parent_article_id:blueprint->>parent_article_id, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? []).map(({ parent_article_id, ...row }: any) => ({
    ...row,
    blueprint: parent_article_id ? { parent_article_id } : null,
  }));
  return NextResponse.json({ ok: true, items });
}
