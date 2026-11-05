import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { listContentItems } from "@/lib/content-list";

/** Real content_items list: powers the Approvals page (and its live search). The query itself
 *  lives in lib/content-list.ts so the page can render with the same data on first paint. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { items, error } = await listContentItems(supabase, tenantId, {
    status: req.nextUrl.searchParams.get("status") || "awaiting_approval",
    q: req.nextUrl.searchParams.get("q") || "",
  });
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
  return NextResponse.json({ ok: true, items });
}
