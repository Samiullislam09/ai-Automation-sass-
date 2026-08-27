import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { normalizeLabel } from "@/lib/eval/intent-labels";

/** /api/eval — the intent evaluation set for the current tenant (lib/eval/README.md).
 *
 *  GET  ?status=auto|reviewed|skipped|all  &intent=<intent|all>   → { ok, rows, total, reviewed }
 *  PATCH { id, human_label?, status }                             → { ok, row }
 *
 *  RLS does the tenant check on the read; the tenant_id filter on the update is belt and
 *  braces. Members cannot touch the auto columns (trigger in 018_intent_eval.sql).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status") || "all";
  const intent = req.nextUrl.searchParams.get("intent") || "all";

  let q = supabase
    .from("intent_eval")
    .select("id, text, prior_assistant, auto_label, auto_model, human_label, status, reviewed_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (status !== "all") q = q.eq("status", status);
  if (intent !== "all") q = q.eq("auto_label->>intent", intent);

  const [{ data, error }, totals] = await Promise.all([
    q,
    supabase.from("intent_eval").select("status").eq("tenant_id", tenantId).limit(5000),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const all = totals.data ?? [];
  return NextResponse.json({
    ok: true,
    rows: data ?? [],
    total: all.length,
    reviewed: all.filter((r) => r.status === "reviewed").length,
    skipped: all.filter((r) => r.status === "skipped").length,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const status = String(body?.status ?? "");
  if (!id || !["auto", "reviewed", "skipped"].includes(status)) {
    return NextResponse.json({ ok: false, error: "id and a valid status are required." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { status };
  if (status === "reviewed") {
    const label = normalizeLabel(body?.human_label);
    if (!label) return NextResponse.json({ ok: false, error: "human_label is not a valid label." }, { status: 400 });
    patch.human_label = label;
  }
  if (status !== "auto") {
    const { data: u } = await supabase.auth.getUser();
    patch.reviewed_by = u.user?.id ?? null;
    patch.reviewed_at = new Date().toISOString();
  } else {
    patch.human_label = null;
    patch.reviewed_by = null;
    patch.reviewed_at = null;
  }

  const { data, error } = await supabase
    .from("intent_eval")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id, human_label, status, reviewed_at")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Row not found." }, { status: 404 });
  return NextResponse.json({ ok: true, row: data });
}
