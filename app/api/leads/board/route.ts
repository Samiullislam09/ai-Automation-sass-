import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** /api/leads/board — everything the redesigned Leads page needs in ONE round trip: the leads,
 *  each enriched with its outreach status, plus the KPI totals.
 *
 *  THE NUMBERS ARE REAL. The reference mockup shows 1,284 / 654 / 231; this computes the same
 *  KPIs from the tenant's actual rows, never a placeholder. Where the product has no concept the
 *  mockup assumes, it is derived honestly rather than invented:
 *
 *   · "AI Agent messaged" = a lead with an outgoing message whose answered_by is 'brain'.
 *   · "Employee messaged" = an outgoing message the human sent (answered_by 'human' or null).
 *     There is one human (the owner) today, not a roster — so "employee" means "you", and the
 *     board does not pretend there are several.
 *   · "Converted / Client" = stage 'won'.
 *   · "Not messaged" = no outgoing message of either kind. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Approval gate inverted (owner decision 2026-10-01): every lead arrives approved; the human
  // rejects, not approves. New discoveries land as "approved" at the source (agents/leads.ts) —
  // this sweep retires the rows written under the old policy so none stay stuck in "needs
  // review". Idempotent, matches zero rows once the backlog is gone.
  await supabase
    .from("leads")
    .update({ stage: "approved", approved_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("stage", "pending_approval");

  const [{ data: leads, error: le }, { data: msgs, error: me }, { data: genRows }, { data: meetingRows }] = await Promise.all([
    supabase.from("leads").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000),
    supabase
      .from("outreach_messages")
      .select("lead_id, direction, answered_by, body, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(4000),
    // The lead-discovery job's own trail, so the page can show "searching now" / "last found X
    // ago" instead of leaving the user guessing whether Mr. Lead is working.
    supabase
      .from("jobs_log")
      .select("status, action, detail, created_at")
      .eq("tenant_id", tenantId)
      .eq("agent", "leads")
      .order("created_at", { ascending: false })
      .limit(5),
    // Scheduled/offered meetings so the drawer can show the booked time + Meet link (§29.6 P7/P9).
    // Tolerant: a database without migration 037 just yields no meetings.
    supabase
      .from("lead_meetings")
      .select("id, lead_id, status, start_at, meet_link")
      .eq("tenant_id", tenantId)
      .in("status", ["offered", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (le && /column .* does not exist|relation .* does not exist/i.test(le.message)) {
    return NextResponse.json({ ok: false, error: "The CRM tables are not set up yet (migration 028)." }, { status: 409 });
  }
  if (le) return NextResponse.json({ ok: false, error: le.message }, { status: 500 });
  const messages = me ? [] : msgs ?? [];

  // Fold the messages into a per-lead summary: did AI message, did the human message, the last
  // outgoing, and the last inbound (their reply).
  type Sum = { ai: boolean; human: boolean; lastOut?: string; lastOutBody?: string; lastIn?: string; lastInBody?: string };
  const byLead = new Map<string, Sum>();
  for (const m of messages) {
    if (!m.lead_id) continue;
    const s = byLead.get(m.lead_id) ?? { ai: false, human: false };
    if (m.direction === "out") {
      if (m.answered_by === "brain") s.ai = true;
      else s.human = true; // 'human' or null → a person (you) sent it
      if (!s.lastOut) { s.lastOut = m.created_at; s.lastOutBody = m.body; }
    } else if (m.direction === "in") {
      if (!s.lastIn) { s.lastIn = m.created_at; s.lastInBody = m.body; }
    }
    byLead.set(m.lead_id, s);
  }

  // Latest scheduled/offered meeting per lead (rows already come newest-first).
  const meetingByLead = new Map<string, any>();
  for (const m of (meetingRows ?? []) as any[]) {
    if (m.lead_id && !meetingByLead.has(m.lead_id)) meetingByLead.set(m.lead_id, { id: m.id, status: m.status, start_at: m.start_at, meet_link: m.meet_link });
  }

  const CONVO = ["contacted", "delivered", "read", "replied", "in_conversation", "interested"];
  const enriched = (leads ?? []).map((l: any) => {
    const s = byLead.get(l.id) ?? { ai: false, human: false };
    const messaged = s.ai || s.human || l.contacted_at != null || CONVO.includes(l.stage);
    return {
      ...l,
      ai_messaged: s.ai,
      human_messaged: s.human,
      messaged,
      converted: l.stage === "won",
      is_client: l.stage === "won",
      last_out_at: s.lastOut ?? l.contacted_at ?? null,
      last_out_body: s.lastOutBody ?? null,
      last_in_at: s.lastIn ?? l.replied_at ?? null,
      last_in_body: s.lastInBody ?? null,
      meeting: meetingByLead.get(l.id) ?? null,
    };
  });

  const count = (fn: (l: any) => boolean) => enriched.filter(fn).length;
  const kpis = {
    total: enriched.length,
    messaged: count((l) => l.messaged),
    converted: count((l) => l.converted),
    ai_messaged: count((l) => l.ai_messaged),
    employee_messaged: count((l) => l.human_messaged),
    not_messaged: count((l) => !l.messaged),
    // tab counts. "New" means freshly added (last 24h) now that nothing waits in review.
    new: count((l) => Date.now() - new Date(l.created_at).getTime() < 86_400_000),
    engaged: count((l) => ["replied", "in_conversation", "interested"].includes(l.stage)),
    client: count((l) => l.stage === "won"),
  };

  const gRows = (genRows ?? []) as { status: string; action: string; detail: any; created_at: string }[];
  const runningRow = gRows.find((r) => r.status === "queued" || r.status === "running");
  const running = runningRow != null;
  const lastDone = gRows.find((r) => r.status === "success" || r.status === "error");
  const d = (lastDone?.detail ?? {}) as any;
  // The running job's live progress (agent writes detail.progress every few seconds). Leads
  // batch-save only at the end, so the DB row count can't show mid-run growth — this is the live
  // "found so far" the Leads page shows instead.
  const rp = (runningRow?.detail as any)?.progress ?? {};
  const gen = {
    running,
    running_found: typeof rp.found === "number" ? rp.found : null,
    running_label: typeof rp.label === "string" ? rp.label : null,
    running_done: typeof rp.done === "number" ? rp.done : null,
    running_total: typeof rp.total === "number" ? rp.total : null,
    // When the live run started — the Leads page counts rows newer than this as "found so far".
    running_since: runningRow?.created_at ?? null,
    last_run_at: lastDone?.created_at ?? null,
    last_status: lastDone?.status ?? null,
    // How many the last finished run added, if the agent recorded it (agent returns `found`).
    last_found: typeof d.count === "number" ? d.count : typeof d.found === "number" ? d.found : null,
    last_saved: typeof d.saved === "number" ? d.saved : null,
    last_note: typeof d.note === "string" ? d.note : typeof d.reason === "string" ? d.reason : null,
    // So the Live panel can show WHY a run found nothing — e.g. the buyer profile isn't confirmed.
    last_needs: Array.isArray(d.needs) ? d.needs : [],
    last_question: typeof d.question === "string" ? d.question : null,
  };

  return NextResponse.json({ ok: true, leads: enriched, kpis, gen });
}
