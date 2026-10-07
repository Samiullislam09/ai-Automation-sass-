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
import { decideReply } from "./decide.js";
import { sendText, simulateTyping } from "./session.js";
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

  const { data: queued } = await supabase
    .from("wa_outbound_queue")
    .select("lead_id, scheduled_at, status")
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "sending"]);
  const queuedIds = new Set((queued ?? []).map((r: any) => r.lead_id));
  const lastSlot = (queued ?? []).reduce((mx: number, r: any) => Math.max(mx, Date.parse(r.scheduled_at) || 0), 0);

  const { data: leads } = await supabase
    .from("leads")
    .select("id, whatsapp, phone")
    .eq("tenant_id", tenantId)
    .eq("stage", "approved")
    .eq("opt_out", false)
    .is("contacted_at", null)
    .limit(200);

  const eligible = (leads ?? []).filter((l: any) => !queuedIds.has(l.id) && (l.whatsapp || l.phone));
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

/** Send one tenant's next due cold message, if the gate allows. Returns true if a message went. */
async function dispatchTenant(tenantId: string, nowMs: number): Promise<boolean> {
  const s = await getWhatsappSettings(tenantId);
  const [active, dailyCount, { data: session }] = await Promise.all([
    tenantHasActiveConversation(tenantId, nowMs),
    dailyAutoSendCount(tenantId),
    supabase.from("whatsapp_sessions").select("first_connected_at, status").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if ((session as any)?.status !== "connected") return false; // not linked → nothing to send through
  const cap = warmupCap((session as any)?.first_connected_at ? Date.parse((session as any).first_connected_at) : null, nowMs);

  const gate = canDispatchTenant({
    autoReply: s.auto_reply,
    outboundEnabled: s.outbound_enabled,
    inQuietHours: isQuietHours(nowMs, s.tz_offset, s.send_start, s.send_end),
    hasActiveConversation: active,
    dailyCount,
    cap,
  });
  if (!gate.ok) return false;

  const slot = await claimNextDue(tenantId, new Date(nowMs).toISOString());
  if (!slot) return false;

  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("whatsapp, phone, opt_out, contacted_at")
      .eq("id", slot.lead_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const phone = (lead as any)?.whatsapp || (lead as any)?.phone || "";
    if (!lead || (lead as any).opt_out || (lead as any).contacted_at || !phone) {
      await finishSlot(slot.id, "skipped", "lead no longer eligible");
      return false;
    }

    // The opener: the decision engine drafts it from the thread (the first "message" is the lead's
    // own record/notes) + Site Brain. If there is genuinely nothing to say, skip rather than invent.
    const decision = await decideReply(supabase, tenantId, slot.lead_id).catch(() => null);
    const body = decision?.reply?.trim();
    if (!body) {
      await finishSlot(slot.id, "skipped", "no opener drafted");
      return false;
    }

    await simulateTyping(tenantId, phone, Math.min(5000, Math.max(1500, body.length * 35)));
    const { waMessageId } = await sendText(tenantId, phone, body); // throws for a non-WhatsApp number
    await recordOutgoing(supabase, tenantId, slot.lead_id, body, waMessageId, "brain");
    await finishSlot(slot.id, "sent", null);
    return true;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/isn't on WhatsApp|not on WhatsApp/i.test(msg)) {
      await finishSlot(slot.id, "skipped", "not on WhatsApp");
      await supabase.from("leads").update({ stage: "invalid", updated_at: new Date().toISOString() }).eq("id", slot.lead_id).eq("tenant_id", tenantId).eq("stage", "approved");
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
