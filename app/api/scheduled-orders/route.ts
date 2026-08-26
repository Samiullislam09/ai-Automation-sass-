import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { listPending, listRecent, cancelOrder } from "@/lib/scheduled-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One-off orders booked in the chat — "30 min baad ek article publish kar do".
 *
 *  A booking the customer cannot see is barely better than the fabricated confirmation this
 *  replaced: both leave them with nothing to check. So everything placed in the chat shows up
 *  on the Schedule page, with the sentence they typed and a way to call it off before it
 *  fires. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const [pending, recent] = await Promise.all([
    listPending(supabase, tenantId),
    listRecent(supabase, tenantId),
  ]);
  return NextResponse.json({ ok: true, pending, recent, serverTime: new Date().toISOString() });
}

/** Cancel one. Only a row that is still `pending` can be cancelled — once the scheduler has
 *  claimed it the work is already in flight, and a button that pretends otherwise is the same
 *  class of bug as the one this whole feature exists to fix. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Which order?" }, { status: 400 });

  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const res = await cancelOrder(supabase, tenantId, id);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });

  // Read it back rather than reporting success from the fact that the UPDATE did not error.
  // "Cancelled" has to mean the row says cancelled, because the alternative is telling someone
  // their article will not be published when it still will be.
  const { data } = await supabase
    .from("scheduled_orders")
    .select("status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (data?.status === "cancelled") return NextResponse.json({ ok: true });
  return NextResponse.json(
    {
      ok: false,
      error:
        data?.status === "running" || data?.status === "done"
          ? "Too late — that one has already started."
          : "That order could not be cancelled.",
    },
    { status: 409 }
  );
}
