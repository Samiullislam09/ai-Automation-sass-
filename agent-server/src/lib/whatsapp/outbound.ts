/** §28.8 Lane 2 — the OUTBOUND TIMELINE: the first (cold) WhatsApp message to newly-generated,
 *  approved, WhatsApp-reachable leads, sent ONE AT A TIME on a randomised, carryover timeline.
 *
 *  THE OWNER'S RULES, made mechanical:
 *   · ek saath nahi — each lead gets its own randomised slot (gap_min..gap_max apart), so 7 leads
 *     become 7 different times, not one blast.
 *   · conversation ki priority — while the tenant has ANY active conversation (a recent inbound),
 *     the WHOLE timeline pauses; it resumes once things go quiet.
 *   · carryover + merge — unsent slots live in wa_outbound_queue; a later day's new leads append
 *     AFTER the existing pending ones, so "aaj ka bacha + kal ka naya" share one timeline.
 *   · ban-safe — quiet hours, the shared daily cap + warmup, opt-out, and the single sendText (with
 *     its onWhatsApp check) all still apply; a non-WhatsApp number is skipped, never retried blindly.
 *
 *  This owner-overrides session.ts's old "never autonomous sender" rule, so every rail above is the
 *  price of that override. The dispatcher is driven by scheduler.ts's once-a-minute sweep. */
import { supabase } from "../../supabase.js";
import { getWhatsappSettings } from "../outreach/settings.js";
import { warmupCap, dailyAutoSendCount } from "./autoReply.js";
import { composeOpener } from "./opener.js";
import { leadDialDigits } from "./phone.js";
import { sendText, simulateTyping, senderOnline, checkNumbers, sessionStatus } from "./session.js";
import { recordOutgoing } from "./store.js";

/** How recently an inbound must have arrived for the tenant to count as "in a conversation" and
 *  the whole timeline to pause. Quiet for this long → outbound resumes. */
const ACTIVE_CONVO_WINDOW_MS = 60 * 60 * 1000;
/** At most one cold message per tenant per sweep — belt-and-braces on top of the randomised slots,
 *  so even a backlog of due rows leaves one at a time. */
const SENDS_PER_TENANT_PER_TICK = 1;
/** Give up on a slot after this many failed sends (transient errors), marking it skipped. */
const MAX_ATTEMPTS = 3;

/* ── Pure helpers (no DB, no wall-clock baked in) — the testable core ─────────────────────── */

/** The local hour (0-23) for a UTC ms at a plain UTC offset. Per-tenant IANA TZ arrives in P6. */
export function localHour(ms: number, tzOffset: number): number {
  return ((Math.floor(ms / 3_600_000) + tzOffset) % 24 + 24) % 24;
}

/** Outside the allowed send window = quiet. Handles a normal daytime window (start < end) and a
 *  window that wraps past midnight (start > end, e.g. 20→6). start === end means "always allowed". */
export function isQuietHours(ms: number, tzOffset: number, sendStart: number, sendEnd: number): boolean {
  if (sendStart === sendEnd) return false;
  const h = localHour(ms, tzOffset);
  return sendStart < sendEnd ? (h < sendStart || h >= sendEnd) : (h < sendStart && h >= sendEnd);
}

/** Push a timestamp forward to the next moment inside the allowed window. If it already sits inside
 *  the window it is returned unchanged; otherwise it jumps to the window's start (today or tomorrow). */
export function nextAllowedTime(ms: number, tzOffset: number, sendStart: number, sendEnd: number): number {
  if (!isQuietHours(ms, tzOffset, sendStart, sendEnd)) return ms;
  const h = localHour(ms, tzOffset);
  // hours to wait until we reach sendStart
  const wait = ((sendStart - h) % 24 + 24) % 24;
  // round the current ms down to the hour, then add the wait — good enough (minute precision is
  // not needed for a cold-message slot, and the dispatcher re-checks quiet hours at send time).
  const hourFloor = Math.floor(ms / 3_600_000) * 3_600_000;
  return hourFloor + wait * 3_600_000;
}

/** Lay out `count` slots starting from `fromMs`, each a random gap after the previous, every one
 *  pushed inside the allowed window. `rng` defaults to Math.random but is injectable for tests. */
export function computeSlots(
  count: number,
  fromMs: number,
  gapMinMs: number,
  gapMaxMs: number,
  tzOffset: number,
  sendStart: number,
  sendEnd: number,
  rng: () => number = Math.random,
): number[] {
  const out: number[] = [];
  let cursor = fromMs;
  for (let i = 0; i < count; i++) {
    const gap = gapMinMs + Math.floor(rng() * Math.max(1, gapMaxMs - gapMinMs + 1));
    cursor = nextAllowedTime(cursor + gap, tzOffset, sendStart, sendEnd);
    out.push(cursor);
  }
  return out;
}

/** Slots that fell due long ago (the AI was off, offline, in a conversation, at its limit) must NOT all fire
 *  one per minute the moment it is allowed again: that is a burst, the exact thing the random gaps exist to
 *  prevent. A slot is stale once it is overdue by more than the biggest gap; stale slots are laid out again
 *  from `nowMs`, in their original order, each a random gap after the previous. Returns id -> new time. */
export function respaceStale(
  pending: { id: string; scheduled_at: string }[],
  nowMs: number,
  gapMinMs: number,
  gapMaxMs: number,
  tzOffset: number,
  sendStart: number,
  sendEnd: number,
  rng: () => number = Math.random,
): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = pending.slice().sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  const stale = sorted.filter((p) => nowMs - Date.parse(p.scheduled_at) > Math.max(gapMaxMs, 15 * 60_000));
  if (!stale.length) return out;
  const slots = computeSlots(stale.length, nowMs, gapMinMs, gapMaxMs, tzOffset, sendStart, sendEnd, rng);
  stale.forEach((p, i) => out.set(p.id, slots[i]));
  return out;
}

/** Which approved leads can be WhatsApp'd at all, decided BEFORE anyone is queued. A lead we cannot message must never
 *  take a slot: it only ends up as a "skipped" line, wastes a place in line and, when the number is wrong, risks a
 *  message to a stranger. Pure, so it is a test.
 *   queueNow   known to be on WhatsApp (its own site published a wa.me number, a stored "yes", or it has written to us)
 *   needCheck  a dialable number we have not confirmed: asked of WhatsApp itself, in a batch (digits -> lead ids)
 *   unreachable can never be messaged: no usable number (no country, malformed, a landline code), a toll-free / premium
 *              line, or WhatsApp already said no */
export type ReachLead = { id: string; whatsapp?: string | null; phone?: string | null; country?: string | null; wa_status?: string | null; stage?: string | null; replied_at?: string | null };
export function planReachability(leads: ReachLead[]): { queueNow: string[]; needCheck: Map<string, string[]>; unreachable: string[] } {
  const out = { queueNow: [] as string[], needCheck: new Map<string, string[]>(), unreachable: [] as string[] };
  for (const l of leads) {
    const dial = leadDialDigits(l);
    if (l.wa_status === "no" && !l.replied_at) { out.unreachable.push(l.id); continue; }
    if (l.replied_at || l.wa_status === "yes" || String(l.whatsapp ?? "").replace(/\D/g, "").length >= 8) { if (dial.ok) out.queueNow.push(l.id); else out.unreachable.push(l.id); continue; }
    if (!dial.ok) { out.unreachable.push(l.id); continue; }
    out.needCheck.set(dial.digits, [...(out.needCheck.get(dial.digits) ?? []), l.id]);
  }
  return out;
}

/** The pure dispatch decision for a tenant this tick — everything passed in, so it is unit-tested. */
export function canDispatchTenant(input: {
  autoReply: boolean;
  outboundEnabled: boolean;
  inQuietHours: boolean;
  hasActiveConversation: boolean;
  dailyCount: number;
  cap: number;
}): { ok: boolean; reason?: string } {
  if (!input.autoReply) return { ok: false, reason: "auto-replies off" };
  if (!input.outboundEnabled) return { ok: false, reason: "outbound off" };
  if (input.inQuietHours) return { ok: false, reason: "quiet hours" };
  if (input.hasActiveConversation) return { ok: false, reason: "a conversation is active — timeline paused" };
  if (input.dailyCount >= input.cap) return { ok: false, reason: "daily cap reached" };
  return { ok: true };
}

/* ── DB-backed steps ──────────────────────────────────────────────────────────────────────── */

async function tenantHasActiveConversation(tenantId: string, nowMs: number): Promise<boolean> {
  const since = new Date(nowMs - ACTIVE_CONVO_WINDOW_MS).toISOString();
  try {
    const { count } = await supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("direction", "in")
      .gte("created_at", since);
    return (count ?? 0) > 0;
  } catch {
    return true; // can't tell → assume active and hold (safer than blasting)
  }
}

/** Find approved, reachable, never-messaged leads for a tenant that are NOT yet on the timeline,
 *  and append them after the last pending slot — the carryover/merge behaviour. Bounded per run. */
async function backfillTenant(tenantId: string, nowMs: number): Promise<number> {
  const s = await getWhatsappSettings(tenantId);
  if (!s.auto_reply || !s.outbound_enabled) return 0;

  const { data: queuedRaw } = await supabase
    .from("wa_outbound_queue")
    .select("id, lead_id, scheduled_at, status")
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "sending"]);
  let queued = (queuedRaw ?? []) as any[];
  // Slots left over from a stretch when nothing could send: lay them out again instead of letting them burst.
  const re = respaceStale(queued.filter((r) => r.status === "pending"), nowMs, s.gap_min_min * 60_000, s.gap_max_min * 60_000, s.tz_offset, s.send_start, s.send_end);
  if (re.size) {
    await Promise.all(Array.from(re.entries()).map(([id, ms]) =>
      supabase.from("wa_outbound_queue").update({ scheduled_at: new Date(ms).toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending")
    ));
    queued = queued.map((r) => (re.has(r.id) ? { ...r, scheduled_at: new Date(re.get(r.id)!).toISOString() } : r));
  }
  // Take unreachable leads OUT of the line (a landline, a malformed number, a toll-free line, "not on WhatsApp"):
  // they were queued before this check existed, or their number turned out to be wrong.
  const pendingRows = queued.filter((r: any) => r.status === "pending");
  if (pendingRows.length) {
    const { data: inLine } = await supabase.from("leads").select("id, whatsapp, phone, country, wa_status, stage, replied_at").eq("tenant_id", tenantId).in("id", pendingRows.map((r: any) => r.lead_id));
    const dead = new Set(planReachability((inLine ?? []) as ReachLead[]).unreachable);
    const gone = pendingRows.filter((r: any) => dead.has(r.lead_id)).map((r: any) => r.id);
    if (gone.length) {
      await supabase.from("wa_outbound_queue").delete().in("id", gone).eq("status", "pending");
      queued = queued.filter((r: any) => !gone.includes(r.id));
      console.log(`[outbound] ${tenantId}: took ${gone.length} lead(s) out of the line: their number cannot receive WhatsApp`);
    }
  }
  const queuedIds = new Set((queued ?? []).map((r: any) => r.lead_id));
  const lastSlot = (queued ?? []).reduce((mx: number, r: any) => Math.max(mx, Date.parse(r.scheduled_at) || 0), 0);

  const { data: leads } = await supabase
    .from("leads")
    .select("id, whatsapp, phone, country, wa_status, stage, replied_at")
    .eq("tenant_id", tenantId)
    .eq("stage", "approved")
    .eq("opt_out", false)
    .is("contacted_at", null)
    .limit(200);

  // Only leads that can really be messaged on WhatsApp, decided BEFORE they are queued: a usable number, and WhatsApp
  // itself confirming that number has an account. Anyone who fails never takes a slot and never shows up as "skipped".
  // A lead whose slot was skipped in the last 24 hours (no opener could be written, the send failed) is left alone for
  // a day. Without this the very next tick queued it again, it was skipped again, and the same name filled the
  // "Skipped" list over and over while taking a place in line each time.
  const { data: recentSkips } = await supabase.from("wa_outbound_queue").select("lead_id").eq("tenant_id", tenantId).eq("status", "skipped").gte("updated_at", new Date(nowMs - 86_400_000).toISOString());
  const cooling = new Set(((recentSkips ?? []) as { lead_id: string }[]).map((r) => r.lead_id));
  const fresh = ((leads ?? []) as ReachLead[]).filter((l) => !queuedIds.has(l.id) && !cooling.has(l.id));
  const plan = planReachability(fresh);
  const confirmed = new Set<string>(plan.queueNow);
  const verdicts: { id: string; wa_status: "yes" | "no" }[] = [];
  if (plan.needCheck.size && sessionStatus(tenantId).status === "connected") {
    const digits = Array.from(plan.needCheck.keys()).slice(0, 25); // a batch a minute is plenty and kind to WhatsApp
    const answers = await checkNumbers(tenantId, digits);
    for (const d of digits) {
      const a = answers[d];
      if (a === null || a === undefined) continue; // could not tell: look again next time, do not queue blind
      for (const id of plan.needCheck.get(d) ?? []) { verdicts.push({ id, wa_status: a ? "yes" : "no" }); if (a) confirmed.add(id); }
    }
  }
  if (verdicts.length) {
    const at = new Date().toISOString();
    await Promise.all(verdicts.map((v) => supabase.from("leads").update({ wa_status: v.wa_status, wa_checked_at: at }).eq("id", v.id).eq("tenant_id", tenantId).then(() => {}, () => {})));
    const no = verdicts.filter((v) => v.wa_status === "no").length;
    if (no) console.log(`[outbound] ${tenantId}: ${no} lead(s) are not on WhatsApp and will not be messaged`);
  }
  const eligible = fresh.filter((l) => confirmed.has(l.id));
  if (!eligible.length) return 0;

  const from = Math.max(nowMs, lastSlot); // append AFTER the existing timeline
  const slots = computeSlots(
    eligible.length, from, s.gap_min_min * 60_000, s.gap_max_min * 60_000, s.tz_offset, s.send_start, s.send_end,
  );
  const rows = eligible.map((l: any, i: number) => ({
    tenant_id: tenantId,
    lead_id: l.id,
    scheduled_at: new Date(slots[i]).toISOString(),
    status: "pending",
  }));
  // Ignore unique-index conflicts (a lead already queued by a racing tick) rather than failing.
  const { error } = await supabase.from("wa_outbound_queue").insert(rows);
  if (error && !/duplicate key|unique/i.test(error.message)) {
    console.error(`[outbound] backfill insert failed for ${tenantId}:`, error.message);
    return 0;
  }
  return rows.length;
}

/** Claim the next due slot for a tenant (pending → sending), returning it, or null if none/claimed
 *  by nobody. The `.eq('status','pending')` is the lock — a second sweep claims nothing. */
async function claimNextDue(tenantId: string, nowIso: string): Promise<{ id: string; lead_id: string; attempt: number } | null> {
  const { data: due } = await supabase
    .from("wa_outbound_queue")
    .select("id, lead_id, attempt")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!due) return null;
  const { data: claimed } = await supabase
    .from("wa_outbound_queue")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", (due as any).id)
    .eq("status", "pending")
    .select("id");
  return claimed?.length ? (due as any) : null;
}

async function finishSlot(id: string, status: "sent" | "skipped" | "pending", reason: string | null, attempt?: number): Promise<void> {
  const patch: Record<string, unknown> = { status, reason, updated_at: new Date().toISOString() };
  if (attempt != null) patch.attempt = attempt;
  await supabase.from("wa_outbound_queue").update(patch).eq("id", id);
}

/** Say WHY nothing is going out, once each time the reason changes (a once-a-minute tick would otherwise flood the
 *  log). This is the line to look for in the Railway logs when first messages are not leaving. */
const lastHold = new Map<string, string>();
function holdNote(tenantId: string, reason: string): void {
  if (lastHold.get(tenantId) === reason) return;
  lastHold.set(tenantId, reason);
  console.log(`[outbound] ${tenantId}: first messages held: ${reason}`);
}

/** Send one tenant's next due cold message, if the gate allows. Returns true if a message went. */
async function dispatchTenant(tenantId: string, nowMs: number): Promise<boolean> {
  const s = await getWhatsappSettings(tenantId);
  const [active, dailyCount, { data: session }] = await Promise.all([
    tenantHasActiveConversation(tenantId, nowMs),
    dailyAutoSendCount(tenantId),
    supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!(await senderOnline(supabase, tenantId, (session as any)?.status))) { holdNote(tenantId, "WhatsApp is not connected in this process"); return false; }
  const cap = warmupCap((session as any)?.first_connected_at ? Date.parse((session as any).first_connected_at) : null, nowMs);

  const gate = canDispatchTenant({
    autoReply: s.auto_reply,
    outboundEnabled: s.outbound_enabled,
    inQuietHours: isQuietHours(nowMs, s.tz_offset, s.send_start, s.send_end),
    hasActiveConversation: active,
    dailyCount,
    cap,
  });
  if (!gate.ok) { holdNote(tenantId, gate.reason ?? "held"); return false; }

  // Belt and braces on top of the slots: never closer than the minimum gap to the previous first message.
  const { data: prev } = await supabase.from("wa_outbound_queue").select("updated_at").eq("tenant_id", tenantId).eq("status", "sent").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (prev && nowMs - Date.parse((prev as any).updated_at) < s.gap_min_min * 60_000) return false;

  const slot = await claimNextDue(tenantId, new Date(nowMs).toISOString());
  if (!slot) return false;

  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("whatsapp, phone, country, company, name, city, reason, draft, channel, opt_out, contacted_at, wa_status")
      .eq("id", slot.lead_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!lead || (lead as any).opt_out || (lead as any).contacted_at) {
      await finishSlot(slot.id, "skipped", "lead no longer eligible");
      return false;
    }
    const dial = leadDialDigits(lead as any);
    if (!dial.ok) {
      await finishSlot(slot.id, "skipped", dial.reason);
      return false;
    }
    const phone = dial.digits;

    // The opener: the lead's own screened first message, or a short one written from Site Brain and
    // finished in code with who is writing and a working opt-out. If there is genuinely nothing real to
    // say, skip rather than invent.
    const body = await composeOpener(tenantId, lead as any).catch(() => null);
    if (!body) {
      await finishSlot(slot.id, "skipped", "no opener drafted");
      return false;
    }

    await simulateTyping(tenantId, phone, Math.min(5000, Math.max(1500, body.length * 35)));
    const { waMessageId } = await sendText(tenantId, phone, body); // throws for a non-WhatsApp number
    await recordOutgoing(supabase, tenantId, slot.lead_id, body, waMessageId, "brain");
    // WhatsApp accepted the number: remember it, so the Leads page and later sweeps know.
    await supabase.from("leads").update({ wa_status: "yes", wa_checked_at: new Date().toISOString() }).eq("id", slot.lead_id).eq("tenant_id", tenantId).then(() => {}, () => {});
    await finishSlot(slot.id, "sent", null);
    lastHold.delete(tenantId);
    console.log(`[outbound] ${tenantId}: first message sent to lead ${slot.lead_id}`);
    return true;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/isn't on WhatsApp|not on WhatsApp/i.test(msg)) {
      await finishSlot(slot.id, "skipped", "not on WhatsApp");
      await supabase.from("leads").update({ stage: "invalid", wa_status: "no", wa_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", slot.lead_id).eq("tenant_id", tenantId).eq("stage", "approved")
        .then(async (r: any) => { if (r?.error && /wa_status|wa_checked_at/i.test(r.error.message)) await supabase.from("leads").update({ stage: "invalid", updated_at: new Date().toISOString() }).eq("id", slot.lead_id).eq("tenant_id", tenantId).eq("stage", "approved"); });
      return false;
    }
    // Transient: back to pending for a later tick, up to MAX_ATTEMPTS.
    const attempt = (slot.attempt ?? 0) + 1;
    if (attempt >= MAX_ATTEMPTS) await finishSlot(slot.id, "skipped", `failed ${attempt}x: ${msg}`, attempt);
    else await finishSlot(slot.id, "pending", msg, attempt);
    console.warn(`[outbound] send failed for lead ${slot.lead_id} (attempt ${attempt}):`, msg);
    return false;
  }
}

/** The once-a-minute dispatcher, called from scheduler.ts. Backfills new eligible leads onto each
 *  tenant's timeline, then sends at most one due cold message per tenant. Never throws past here. */
export async function tickOutbound(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  // Tenants with auto-reply on OR with pending slots already — the union keeps a tenant whose
  // leads were approved before they turned auto-reply on from being forgotten once they turn it on.
  let tenantIds: string[] = [];
  try {
    const [{ data: on }, { data: pend }] = await Promise.all([
      supabase.from("agent_settings").select("tenant_id, settings").eq("agent", "whatsapp"),
      supabase.from("wa_outbound_queue").select("tenant_id").in("status", ["pending", "sending"]).limit(2000),
    ]);
    const set = new Set<string>();
    for (const r of (on ?? []) as any[]) if (r?.settings?.auto_reply === true) set.add(r.tenant_id);
    for (const r of (pend ?? []) as any[]) set.add(r.tenant_id);
    tenantIds = [...set];
  } catch (e: any) {
    // Table missing (033 not applied) → say it once and do nothing, like the other sweeps.
    console.error("[outbound] tick could not list tenants:", e?.message);
    return 0;
  }

  let sent = 0;
  for (const tenantId of tenantIds) {
    try {
      await backfillTenant(tenantId, nowMs);
      for (let i = 0; i < SENDS_PER_TENANT_PER_TICK; i++) {
        const did = await dispatchTenant(tenantId, nowMs);
        if (!did) break;
        sent++;
      }
    } catch (e: any) {
      console.error(`[outbound] tenant ${tenantId} tick failed:`, e?.message);
    }
  }
  return sent;
}
