/** The assistant's decision log (migration 044) — the answer to "why did it say that, or why did it say nothing?".
 *
 *  Everything here is BEST EFFORT and fire-and-forget: a log line must never delay, fail or change a reply. Without the
 *  migration the insert is rejected, that is mentioned once in the server log, and nothing else is affected.
 *
 *  `listLog` merges these decisions with the messages themselves into one newest-first stream — customer said / assistant
 *  replied / a person replied / what the assistant decided — which is the "live log" on the Activity page. */
import { supabase } from "../../supabase.js";

export type EventKind = "sent" | "skipped" | "flagged" | "meeting" | "system" | "error" | "alert";

let warnedMissing = false;

export async function logEvent(tenantId: string, leadId: string | null, kind: EventKind, summary: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    const { error } = await supabase.from("wa_events").insert({ tenant_id: tenantId, lead_id: leadId, kind, summary: String(summary).slice(0, 500), detail });
    if (error && !warnedMissing) {
      warnedMissing = true;
      console.warn(`[wa-events] cannot write the decision log (apply migration 044?): ${error.message}`);
    }
  } catch {
    /* a log line is never worth a failure */
  }
}

export type LogItem = {
  id: string;
  at: string;
  lead_id: string | null;
  name: string;
  /** customer / assistant / person = a message; the rest are decisions. */
  kind: "customer" | "assistant" | "person" | EventKind;
  text: string;
  /** Extra facts for a decision: intent, notes, latency… */
  detail?: Record<string, unknown>;
};

const nameOf = (l?: any) => l?.company || l?.name || l?.phone || l?.whatsapp || "A customer";

/** The newest `limit` things that happened, messages and decisions together. `leadId` narrows it to one customer. */
export async function listLog(tenantId: string, opts: { limit?: number; leadId?: string | null; before?: string | null; kind?: string | null } = {}): Promise<LogItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 80, 10), 200);
  const before = opts.before && !isNaN(Date.parse(opts.before)) ? opts.before : null;

  // `kind` narrows the log to decisions of one kind (the Team view asks for "alert"): then the messages are not read at all.
  const onlyKind = opts.kind && /^[a-z_]{2,20}$/.test(opts.kind) ? opts.kind : null;
  let mq = supabase.from("outreach_messages").select("id, lead_id, direction, body, answered_by, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
  let eq = supabase.from("wa_events").select("id, lead_id, kind, summary, detail, at").eq("tenant_id", tenantId).order("at", { ascending: false }).limit(limit);
  if (opts.leadId) { mq = mq.eq("lead_id", opts.leadId); eq = eq.eq("lead_id", opts.leadId); }
  if (before) { mq = mq.lt("created_at", before); eq = eq.lt("at", before); }

  if (onlyKind) eq = eq.eq("kind", onlyKind);
  const [{ data: msgs }, { data: evs }] = await Promise.all([onlyKind ? Promise.resolve({ data: [] as any[] }) : mq, eq]);
  const items: LogItem[] = [];
  for (const m of (msgs ?? []) as any[]) {
    items.push({
      id: `m:${m.id}`, at: m.created_at, lead_id: m.lead_id, name: "",
      kind: m.direction === "in" ? "customer" : m.answered_by === "brain" ? "assistant" : "person",
      text: String(m.body ?? ""),
    });
  }
  for (const e of (evs ?? []) as any[]) items.push({ id: `e:${e.id}`, at: e.at, lead_id: e.lead_id, name: "", kind: e.kind, text: String(e.summary ?? ""), detail: e.detail ?? {} });

  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const top = items.slice(0, limit);

  const ids = [...new Set(top.map((i) => i.lead_id).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: ls } = await supabase.from("leads").select("id, company, name, phone, whatsapp").eq("tenant_id", tenantId).in("id", ids);
    const byId = new Map(((ls ?? []) as any[]).map((l) => [l.id, l]));
    for (const i of top) i.name = i.lead_id ? nameOf(byId.get(i.lead_id)) : "";
  }
  return top;
}

/** The log is a log, not a record: nothing older than three weeks is kept. */
export async function pruneEvents(now = Date.now()): Promise<void> {
  try {
    await supabase.from("wa_events").delete().lt("at", new Date(now - 21 * 86_400_000).toISOString());
  } catch { /* ignore */ }
}
