import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { countContentItems, listContentItems } from "@/lib/content-list";

/** Real content_items list: powers the Approvals page (and its live search). The query itself
 *  lives in lib/content-list.ts so the page can render with the same data on first paint. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // ?count=1 — only the number (the sidebar badge). No rows are read or sent.
  if (req.nextUrl.searchParams.get("count") === "1") {
    const count = await countContentItems(supabase, tenantId, req.nextUrl.searchParams.get("status") || "awaiting_approval");
    return count == null ? NextResponse.json({ ok: false, error: "Could not count." }, { status: 500 }) : NextResponse.json({ ok: true, count });
  }

  const { items, error } = await listContentItems(supabase, tenantId, {
    status: req.nextUrl.searchParams.get("status") || "awaiting_approval",
    q: req.nextUrl.searchParams.get("q") || "",
  });
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
  return NextResponse.json({ ok: true, items });
}
