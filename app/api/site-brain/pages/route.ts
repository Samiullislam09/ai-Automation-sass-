import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The list behind Site Brain's "156 pages" count — title + url only, nothing the crawler
 *  stored beyond that (no page text, no embeddings). A separate route, and only ever fetched
 *  when the customer actually opens the list, on purpose: /api/site-brain's own GET is polled
 *  every few seconds by both Site Brain and Memory, and this can be hundreds of rows — the
 *  exact shape of leak docs/EGRESS_AUDIT.md was written to stop happening again. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("site_pages")
    .select("title, url")
    .eq("tenant_id", tenantId)
    .order("url", { ascending: true })
    .limit(500);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, pages: (data ?? []).map((p) => ({ title: p.title || p.url, url: p.url })) });
}
