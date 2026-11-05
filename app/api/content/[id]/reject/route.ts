import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { settleChildren } from "@/lib/content-children";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { error } = await supabase
    .from("content_items")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("status", "awaiting_approval"); // don't silently "reject" something already published/failed

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Rejecting an article rejects the pictures and story that were made for it.
  const kids = await settleChildren(supabase, tenantId, id, "rejected");
  return NextResponse.json({ ok: true, children: kids });
}
