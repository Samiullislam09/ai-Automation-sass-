import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { listPending, listRecent, cancelOrder } from "@/lib/scheduled-orders";
import { cancelTask } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A short, human line for a brain-booked task ("write_article", "find_keywords", …) — the same
 *  small action set lib/chat-brain-intent.ts's ACTION_LABEL and components/dashboard/
 *  LiveRunPanel.tsx's STEP_LABEL already carry, phrased here as a full sentence with the
 *  subject folded in the way this page's own `what` switch does for a legacy order. */
const BRAIN_ORDER_LABEL: Record<string, (subject: string | null) => string> = {
  crawl_site: () => "Read the whole site again",
  build_site_profile: () => "Re-analyze the site",
  plan_topics: () => "Pick this week's topics",
  pick_topic: () => "Choose the next topic",
  find_keywords: (s) => `Research keywords${s ? ` for "${s}"` : ""}`,
  write_article: (s) => `Write an article${s ? ` about "${s}"` : ""}`,
  research_brief: (s) => `Research${s ? ` "${s}"` : ""}`,
  check_seo: () => "Run an SEO check",
  make_images: () => "Create images",
  make_image: () => "Create an image",
  make_story: () => "Create a Web Story",
  publish_article: () => "Publish the article",
  audit_site: () => "Run a site audit",
  draft_social: () => "Draft social posts",
  find_leads: () => "Find leads",
};

/** Every order booked with a time in it — whether it went through the old direct-write path
 *  (`scheduled_orders`, kind = publish/research/plan/write) or through the brain (`tasks`,
 *  kind = the manifest action id, `status = 'scheduled'`) — belongs on this one page. Before
 *  this merge, a "likho is pe article 3 din baad" order (routed to the brain because it names
 *  an action, not a bare "publish") saved for real, ran for real, and showed on the Dashboard —
 *  but never here, because this page only ever asked `scheduled_orders`. The owner saw that
 *  live 2026-09-07: the Dashboard showed a booked task while this tab said "Nothing booked
 *  right now" for the exact same order. Normalized into the same shape the UI already renders
 *  (`id, kind: "brain", topic: null, run_at, status: "pending", request: null, auto_publish`)
 *  so the page's existing row markup needs only the one extra branch on `kind === "brain"`. */
async function listBrainScheduled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, kind, params, delivery, run_at, error")
    .eq("tenant_id", tenantId)
    .eq("status", "scheduled")
    .order("run_at", { ascending: true })
    .limit(20);
  // Same rule listPending follows: a missing/RLS-blocked table is an empty list, not an outage.
  if (error || !data) return [];
  return data.map((t: any) => {
    const subject =
      Object.values(t.params ?? {}).find((v) => typeof v === "string" && v.trim().length > 2) ?? null;
    const label = (BRAIN_ORDER_LABEL[t.kind] ?? (() => String(t.kind).replace(/_/g, " ")))(
      subject as string | null
    );
    return {
      id: t.id,
      kind: "brain",
      label,
      topic: null,
      content_item_id: null,
      auto_publish: t.delivery === "publish",
      run_at: t.run_at,
      status: "pending",
      request: null,
      job_id: null,
      error: t.error ?? null,
      created_at: t.run_at,
      fired_at: null,
    };
  });
}

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

  const [legacyPending, recent, brainPending] = await Promise.all([
    listPending(supabase, tenantId),
    listRecent(supabase, tenantId),
    listBrainScheduled(supabase, tenantId),
  ]);
  const pending = [...legacyPending, ...brainPending].sort(
    (a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime()
  );
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

  // No row at all in scheduled_orders — this id is likely one of listBrainScheduled()'s rows
  // instead, a task the brain (not this table) is holding. Same button, same tenant scoping,
  // the brain's own cancelTask does the rest (agent-server/src/brain/orchestrator.ts:
  // cancelTask only takes a `scheduled` or `awaiting_confirm` row, same "already in flight"
  // rule this endpoint documents above).
  if (!data) {
    const brainRes = await cancelTask(id, tenantId);
    if (brainRes.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { ok: false, error: brainRes.error ?? "That order could not be cancelled." },
      { status: 409 }
    );
  }

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
