import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** "Write about this one instead."
 *
 *  The writer job is already scheduled and will start when the window closes; all this does
 *  is set which keyword it finds when it wakes. That ordering is deliberate — the article
 *  gets written whether or not anyone is at the screen, and this route is the override, not
 *  the trigger.
 *
 *  It only accepts a keyword that was actually offered. A free-text keyword would be research
 *  nobody did: no volume, no competition, no blueprint — exactly the invented data this
 *  product refuses to produce. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { id, keyword } = await request.json().catch(() => ({} as any));
  if (!id || typeof keyword !== "string" || !keyword.trim()) {
    return NextResponse.json({ ok: false, error: "id and keyword are required." }, { status: 400 });
  }

  const { data: choice, error } = await supabase
    .from("keyword_choices")
    .select("id, candidates, recommended, status, expires_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!choice) return NextResponse.json({ ok: false, error: "That choice no longer exists." }, { status: 404 });

  if (choice.status === "used") {
    return NextResponse.json(
      { ok: false, error: "Too late — Mr. Writer already started on the recommended keyword." },
      { status: 409 }
    );
  }

  const offered = new Set(
    [...(Array.isArray(choice.candidates) ? choice.candidates : []).map((c: any) => String(c?.keyword ?? "")), String(choice.recommended)]
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!offered.has(keyword.trim().toLowerCase())) {
    return NextResponse.json({ ok: false, error: "That keyword wasn't one of the researched options." }, { status: 400 });
  }

  const { error: saveErr } = await supabase
    .from("keyword_choices")
    // Still 'pending': the writer marks it 'used' when it actually picks it up. Flipping it
    // here would hide the countdown while the article hasn't started yet.
    .update({ chosen: keyword.trim(), chosen_by: "user" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .neq("status", "used");

  if (saveErr) return NextResponse.json({ ok: false, error: saveErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, chosen: keyword.trim() });
}
