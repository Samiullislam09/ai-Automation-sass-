import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { publishContentItem } from "@/lib/publish";

/** "Approve & publish" — Build Guide Step 12, the actual publish action (not the old
 *  demo's fake local-state toggle). Fetches the item (RLS scopes it to this tenant
 *  already), publishes to whichever integration is connected, and records the outcome —
 *  including a real failure, not a silent success.
 *
 *  ONE EXCEPTION: a social draft (`meta.copyOnly`, set by agent-server's social.ts). MASTER_PLAN
 *  §7.7 is explicit that no network can be posted to yet — Meta App Review is a manual step,
 *  weeks away — so a social item has nowhere to publish TO. Routing it through
 *  publishContentItem would try WordPress or the webhook, which is not what a Facebook draft
 *  is for, and fail with a confusing "No connected publishing destination" that has nothing to
 *  do with the actual problem. Approving one instead marks it `approved`: ready to copy, not
 *  live anywhere. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: item, error: fetchErr } = await supabase
    .from("content_items")
    .select("id, tenant_id, type, title, body, status, meta")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (fetchErr || !item) return NextResponse.json({ ok: false, error: "Content item not found." }, { status: 404 });
  if (item.status !== "awaiting_approval") {
    return NextResponse.json({ ok: false, error: `Item is '${item.status}', not awaiting approval.` }, { status: 409 });
  }

  const prevMeta = (item.meta as Record<string, unknown>) ?? {};

  if (item.type === "social" && prevMeta.copyOnly) {
    await supabase.from("content_items").update({ status: "approved" }).eq("id", id);
    return NextResponse.json({ ok: true, copyOnly: true, url: null });
  }

  const result = await publishContentItem(supabase, tenantId, item);

  if (result.ok) {
    await supabase
      .from("content_items")
      .update({ status: "published", meta: { ...prevMeta, publishedUrl: result.url ?? null } })
      .eq("id", id);
    return NextResponse.json({ ok: true, url: result.url ?? null });
  } else {
    await supabase.from("content_items").update({ status: "failed", meta: { ...prevMeta, publishError: result.error } }).eq("id", id);
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
}
