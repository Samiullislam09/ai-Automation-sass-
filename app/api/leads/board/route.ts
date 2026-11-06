import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** /api/leads/board — what the Leads page needs in ONE round trip: the leads, each enriched with
 *  its outreach status, plus the KPI totals and the lead-discovery job's state.
 *
 *  THE NUMBERS ARE REAL. Everything is computed from the tenant's actual rows, never a placeholder.
 *  Where the product has no concept a screen assumes, it is derived honestly rather than invented:
 *
 *   · "AI Agent messaged" = a lead with an outgoing message whose answered_by is 'brain'.
 *   · "Employee messaged" = an outgoing message the human sent (answered_by 'human' or null).
 *     There is one human (the owner) today, not a roster — so "employee" means "you".
 *   · "Converted / Client" = stage 'won'.
 *   · "Not messaged" = no outgoing message of either kind.
 *
 *  SPEED (Phase 2). The list used to ship every column of every lead (drafts, evidence, score
 *  breakdowns, notes — kilobytes a row that no table cell shows). Now:
 *   · the list selects only the columns the table and cards use; the heavy ones are fetched for
 *     ONE lead when its drawer opens (GET /api/leads/[id]);
 *   · message bodies are cut to a snippet before they leave the server;
 *   · the "pending_approval" clean-up only runs when such a row actually exists (it used to be a
 *     write on every single request);
 *   · the response carries an ETag, so an unchanged board comes back as an empty 304;
 *   · ?mode=gen returns only the discovery job's state (one small query) — the page polls that
 *     while a search is running instead of re-downloading every lead every few seconds. */

/** Columns the table / cards / drawer header need. Everything else loads with the drawer. */
const LIST_COLUMNS = [
  "id", "company", "name", "email", "phone", "whatsapp", "website", "city", "country", "source",
  "icp_score", "stage", "created_at", "approved_at", "contacted_at", "replied_at", "reject_reason",
  "needs_attention", "needs_attention_reason", "last_intent", "classification",
].join(", ");

/** Fields only the drawer shows; stripped from list rows (GET /api/leads/[id] serves them). */
const LEAD_HEAVY_FIELDS = ["draft", "evidence", "score_breakdown", "observation", "notes", "reason", "source_segment", "source_query"] as const;

const SNIPPET = 160;
const cut = (s: unknown) => (typeof s === "string" && s.length > SNIPPET ? s.slice(0, SNIPPET) + "…" : (s as string | null) ?? null);

async function genState(supabase: any, tenantId: string) {
  // The lead-discovery job's own trail, so the page can show "searching now" / "last found X
  // ago" instead of leaving the user guessing whether Mr. Lead is working.
  const { data: genRows } = await supabase
    .from("jobs_log")
    .select("status, action, detail, created_at")
    .eq("tenant_id", tenantId)
    .eq("agent", "leads")
    .order("created_at", { ascending: false })
    .limit(5);
  const gRows = (genRows ?? []) as { status: string; action: string; detail: any; created_at: string }[];
  const runningRow = gRows.find((r) => r.status === "queued" || r.status === "running");
  const lastDone = gRows.find((r) => r.status === "success" || r.status === "error");
  const d = (lastDone?.detail ?? {}) as any;
  // The running job's live progress (agent writes detail.progress every few seconds). Leads
  // batch-save only at the end, so the DB row count can't show mid-run growth — this is the live
  // "found so far" the Leads page shows instead.
  const rp = (runningRow?.detail as any)?.progress ?? {};
  return {
    running: runningRow != null,
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
}

/** JSON with an ETag: if the browser already has this exact body, send 304 and no body. */
function jsonWithEtag(req: NextRequest, payload: unknown) {
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Cheap mode for polling while a search runs: just the job state.
  if (req.nextUrl.searchParams.get("mode") === "gen") {
    return jsonWithEtag(req, { ok: true, gen: await genState(supabase, tenantId) });
  }

  const listQuery = (cols: string) =>
    supabase.from("leads").select(cols).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000);

  const [first, { data: msgs, error: me }, gen, { data: meetingRows }] = await Promise.all([
    listQuery(LIST_COLUMNS),
    supabase
      .from("outreach_messages")
      .select("lead_id, direction, answered_by, body, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(4000),
    genState(supabase, tenantId),
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

  let leads: any[] | null = first.data as any[] | null;
  let le = first.error;
  // An older database may lack one of the newer columns: fall back to select("*") and strip the heavy
  // fields in code, so the page still works (just with a bigger read) until the migration is applied.
  if (le && /column .* does not exist/i.test(le.message)) {
    const wide = await listQuery("*");
    leads = (wide.data as any[] | null)?.map((r) => { for (const k of LEAD_HEAVY_FIELDS) delete r[k]; return r; }) ?? null;
    le = wide.error;
  }
  if (le && /relation .* does not exist/i.test(le.message)) {
    return NextResponse.json({ ok: false, error: "The CRM tables are not set up yet (migration 028)." }, { status: 409 });
  }
  if (le) return NextResponse.json({ ok: false, error: le.message }, { status: 500 });

  // Approval gate inverted (owner decision 2026-10-01): every lead arrives approved; the human
  // rejects, not approves. New discoveries land as "approved" at the source (agents/leads.ts) —
  // this retires rows written under the old policy so none stay stuck in "needs review". It only
  // costs a write when such a row exists (idempotent; zero rows once the backlog is gone).
  if ((leads ?? []).some((l: any) => l.stage === "pending_approval")) {
    await supabase.from("leads").update({ stage: "approved", approved_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("stage", "pending_approval");
    for (const l of leads ?? []) if (l.stage === "pending_approval") l.stage = "approved";
  }

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
      if (!s.lastOut) { s.lastOut = m.created_at; s.lastOutBody = cut(m.body) ?? undefined; }
    } else if (m.direction === "in") {
      if (!s.lastIn) { s.lastIn = m.created_at; s.lastInBody = cut(m.body) ?? undefined; }
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

  // One pass for the totals (kept in the response for older callers; the page counts its own).
  const kpis = { total: enriched.length, messaged: 0, converted: 0, ai_messaged: 0, employee_messaged: 0, not_messaged: 0, new: 0, engaged: 0, client: 0 };
  const dayAgo = Date.now() - 86_400_000;
  for (const l of enriched) {
    if (l.messaged) kpis.messaged++; else kpis.not_messaged++;
    if (l.converted) { kpis.converted++; kpis.client++; }
    if (l.ai_messaged) kpis.ai_messaged++;
    if (l.human_messaged) kpis.employee_messaged++;
    if (new Date(l.created_at).getTime() > dayAgo) kpis.new++;
    if (["replied", "in_conversation", "interested"].includes(l.stage)) kpis.engaged++;
  }

  return jsonWithEtag(req, { ok: true, leads: enriched, kpis, gen });
}
