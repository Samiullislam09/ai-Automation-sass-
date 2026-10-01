import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callAgentServer } from "@/lib/agent-jobs";

/** The buyer-profile screen's back-end (high-quality-leads plan, Phase 1).
 *
 *  A thin, auth-checked proxy in front of agent-server's /buyer-profile/:tenantId routes — the
 *  drafter and the LLM live there, so drafting cannot happen in the browser or here. tenantId and
 *  the signed-in user's id are resolved server-side from the session, never trusted from the body.
 *
 *    GET                      → { hasSiteBrain, buyerProfile, ready }
 *    POST { action:"draft" }  → draft from the Site Brain
 *    POST { action:"save",    buyerProfile } → save edits (stays unconfirmed)
 *    POST { action:"confirm", buyerProfile? } → confirm; lead generation may then run
 */

async function tenant(): Promise<{ tenantId: string; userId: string | null } | null> {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return null;
  const { data } = await supabase.auth.getUser();
  return { tenantId, userId: data?.user?.id ?? null };
}

export async function GET() {
  const t = await tenant();
  if (!t) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await callAgentServer("GET", `/buyer-profile/${t.tenantId}`);
  return NextResponse.json(r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status });
}

export async function POST(req: NextRequest) {
  const t = await tenant();
  if (!t) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const action = body?.action;

  if (action === "draft") {
    const r = await callAgentServer("POST", `/buyer-profile/${t.tenantId}/draft`);
    return NextResponse.json(r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status });
  }
  if (action === "save") {
    const r = await callAgentServer("POST", `/buyer-profile/${t.tenantId}/save`, { buyerProfile: body?.buyerProfile, userId: t.userId });
    return NextResponse.json(r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status });
  }
  if (action === "confirm") {
    const r = await callAgentServer("POST", `/buyer-profile/${t.tenantId}/confirm`, { buyerProfile: body?.buyerProfile, userId: t.userId });
    return NextResponse.json(r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status });
  }

  return NextResponse.json({ ok: false, error: "action must be one of: draft, save, confirm" }, { status: 400 });
}
