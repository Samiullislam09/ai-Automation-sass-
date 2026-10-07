/** §28 Phase 1 — the auto-reply engine's reactive lane: a DELAYED, COALESCED, safety-gated reply
 *  to an inbound message.
 *
 *  WHY NOT SEND INLINE (the old way). session.ts used to call suggestReply→sendText the instant a
 *  message arrived — a reply within a second, to every message, around the clock. That is exactly
 *  what gets a WhatsApp-Web-linked number banned. This module replaces it with a queued job:
 *    inbound → scheduleAutoReply() enqueues with a RANDOM 30–180s delay and a per-lead singletonKey
 *            → the worker runs later, re-reads the thread, checks the gate, types, then sends one.
 *  The singletonKey coalesces a burst ("hi" + "I need ISO 9001" as two messages) into one reply,
 *  and the random delay makes the timing human rather than machine-instant.
 *
 *  THE GATE IS THE SAFETY LAYER (§28.2). It is a pure function so the rules are unit-testable with
 *  no database and no clock. Reactive replies deliberately IGNORE quiet hours — answering someone
 *  who just messaged you is natural at any hour; quiet hours constrain the PROACTIVE lanes
 *  (outbound timeline, follow-ups), not this one. */
import { supabase } from "../../supabase.js";
import { enqueueWhatsappAutoReply } from "../../queues.js";
import { decideReply, detectOptOut } from "./decide.js";
import { sendText, simulateTyping } from "./session.js";
import { recordOutgoing } from "./store.js";
import { notifyAdmins } from "./team.js";
import { offerMeeting, handleMeetingReply } from "./meeting.js";

export type AutoReplyJob = { tenantId: string; leadId: string; phone: string; waitedOnce?: boolean };

/** When the model says the lead is still typing ("wait"), we requeue ONCE after this short gap and
 *  re-decide — so a half-typed "hi" + the real question become one reply. Only once, so a stream of
 *  "wait"s can never loop forever. */
const WAIT_REQUEUE_S = 75;

/** A new message waits a random slice of this window before Mr Lxwa answers — never instant. */
const DELAY_MIN_S = 30;
const DELAY_MAX_S = 180;

/** Warmup ramp: a freshly-linked number must not fire like an aged one. Days since first_connected
 *  → max auto-sends in a rolling 24h (reactive + proactive combined). Conservative on purpose; the
 *  first days are where a new number gets flagged. */
export function warmupCap(firstConnectedAtMs: number | null, nowMs: number): number {
  if (!firstConnectedAtMs) return 20; // unknown age → treat as brand new
  const days = Math.floor((nowMs - firstConnectedAtMs) / 86_400_000);
  if (days <= 0) return 20;
  if (days === 1) return 35;
  if (days === 2) return 50;
  if (days === 3) return 70;
  if (days <= 6) return 120;
  return 250;
}

/** A human-ish typing time for a reply: ~35ms/char, clamped 1.2s–5s. */
export function typingMs(text: string): number {
  return Math.min(5000, Math.max(1200, text.length * 35));
}

/** The pure decision: may we auto-reply to this lead right now? Everything is passed in — no DB,
 *  no `Date.now()` inside — so every rule below is testable in isolation. */
export function autoReplyGate(input: {
  optOut: boolean;
  pausedUntilMs: number | null;
  nowMs: number;
  lastMessageDirection: "in" | "out" | null;
  dailyAutoSendCount: number;
  firstConnectedAtMs: number | null;
}): { ok: boolean; reason?: string } {
  const { optOut, pausedUntilMs, nowMs, lastMessageDirection, dailyAutoSendCount, firstConnectedAtMs } = input;
  if (optOut) return { ok: false, reason: "lead opted out" };
  if (pausedUntilMs && nowMs < pausedUntilMs) return { ok: false, reason: "a human is handling this chat" };
  // Never twice in a row: when the worker runs, the lead's last message must be THEIRS. If it is
  // ours, we already answered (or a human did) and no new inbound came — replying again would be a
  // monologue, the exact loop this rule forbids.
  if (lastMessageDirection !== "in") return { ok: false, reason: "already answered — waiting for them" };
  if (dailyAutoSendCount >= warmupCap(firstConnectedAtMs, nowMs)) return { ok: false, reason: "daily auto-send cap reached" };
  return { ok: true };
}

/** Schedule an auto-reply for a lead after a random human-like delay. singletonKey coalesces a
 *  burst: while one reply job for this lead is pending, new inbounds don't create a second — the
 *  worker reads the whole thread when it runs, so it answers all of them at once. Best effort:
 *  a queue hiccup must never break receiving the message, so the caller `void`s this. */
export async function scheduleAutoReply(job: AutoReplyJob): Promise<void> {
  const startAfter = DELAY_MIN_S + Math.floor(Math.random() * (DELAY_MAX_S - DELAY_MIN_S + 1));
  try {
    await enqueueWhatsappAutoReply(job, { startAfter, singletonKey: `${job.tenantId}:${job.leadId}` });
  } catch (e: any) {
    console.warn(`[whatsapp] could not schedule auto-reply for ${job.leadId}:`, e?.message);
  }
}

/** How many auto-sends (reactive OR outbound) this tenant has made in a rolling 24h — both lanes
 *  share one budget, so the cap is a true ceiling on machine-sent messages. */
export async function dailyAutoSendCount(tenantId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  try {
    const { count } = await supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("direction", "out")
      .eq("answered_by", "brain")
      .gte("created_at", since);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function lastMessage(tenantId: string, leadId: string): Promise<{ direction: "in" | "out" | null; body: string }> {
  try {
    const { data } = await supabase
      .from("outreach_messages")
      .select("direction, body")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const d = (data as any)?.direction;
    return { direction: d === "in" || d === "out" ? d : null, body: String((data as any)?.body ?? "") };
  } catch {
    return { direction: null, body: "" };
  }
}

/** The worker body — runs when a scheduled reply is due. Reads FRESH state (the thread may have
 *  grown since the job was enqueued), checks the gate, then types and sends ONE message. Every
 *  exit is logged, nothing is thrown past the queue, so one bad lead never stalls the worker. */
export async function handleAutoReply(job: AutoReplyJob): Promise<void> {
  const { tenantId, leadId, phone } = job;
  try {
    const [{ data: lead }, { data: session }, last, count] = await Promise.all([
      supabase.from("leads").select("opt_out, auto_reply_paused_until, stage, company, name").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("whatsapp_sessions").select("first_connected_at").eq("tenant_id", tenantId).maybeSingle(),
      lastMessage(tenantId, leadId),
      dailyAutoSendCount(tenantId),
    ]);
    if (!lead) return;

    // Deterministic opt-out FIRST — "stop" must always stop, never the model's judgement. Set the
    // forever flag and never message this lead again.
    if (last.direction === "in" && detectOptOut(last.body)) {
      await supabase
        .from("leads")
        .update({ opt_out: true, opt_out_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", leadId)
        .eq("tenant_id", tenantId);
      console.log(`[whatsapp] auto-reply: ${leadId} opted out — stopping`);
      return;
    }

    const gate = autoReplyGate({
      optOut: (lead as any).opt_out === true,
      pausedUntilMs: (lead as any).auto_reply_paused_until ? Date.parse((lead as any).auto_reply_paused_until) : null,
      nowMs: Date.now(),
      lastMessageDirection: last.direction,
      dailyAutoSendCount: count,
      firstConnectedAtMs: (session as any)?.first_connected_at ? Date.parse((session as any).first_connected_at) : null,
    });
    if (!gate.ok) {
      console.log(`[whatsapp] auto-reply skipped for ${leadId}: ${gate.reason}`);
      return;
    }

    // PENDING MEETING OFFER (§29.6 P7): if we already offered slots and they just replied, treat the
    // reply as a slot pick / postpone BEFORE the general decision engine — booking the Meet, or
    // re-offering. If it handled the message, we're done.
    if (last.direction === "in" && (await handleMeetingReply(tenantId, leadId, phone, last.body))) return;

    // THE DECISION ENGINE (§28.3): one call → intent + confidence + action + a drafted reply.
    const decision = await decideReply(supabase, tenantId, leadId);

    // Record what we understood on the lead — so the Leads page / Mr Lxwa can show "kahaan tak baat
    // hui" and flag the ones a human should look at — regardless of whether we send now.
    await supabase
      .from("leads")
      .update({
        last_intent: decision.intent,
        needs_attention: decision.needs_human,
        needs_attention_reason: decision.needs_human ? decision.reason || decision.intent : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .eq("tenant_id", tenantId);

    // MEETING REQUEST (§29.6 P6): they asked for a call/demo. Move the lead to meeting_requested and
    // alert the team (dashboard + their WhatsApp) — but only on the TRANSITION, so a back-and-forth
    // about timing doesn't re-fire the alert on every message. The actual slot-offering is P7; here
    // the normal reply still goes (the model acknowledges), and a human/P7 takes the booking from here.
    const MEETING_PRE = ["new", "approved", "contacted", "delivered", "read", "replied", "in_conversation", "interested"];
    if (decision.intent === "meeting" && MEETING_PRE.includes(String((lead as any).stage))) {
      const who = (lead as any).company || (lead as any).name || phone;
      await supabase.from("leads").update({ stage: "meeting_requested", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
      await notifyAdmins(tenantId, {
        type: "meeting",
        title: `📅 Meeting request from ${who}`,
        body: "A lead asked to schedule a call/demo on WhatsApp.",
        leadId,
        whatsappText: `Meeting request from ${who} — they want to schedule a call. Open the WhatsApp inbox to set a time.`,
      }).catch((e: any) => console.warn("[whatsapp] meeting alert failed:", e?.message));

      // Option B: offer real Google-Calendar slots on WhatsApp. If that works, it IS the reply — skip
      // the generic one. If Calendar isn't connected/usable, offerMeeting returns false and the
      // normal reply still goes (the admins were just alerted to schedule it by hand).
      if (await offerMeeting(tenantId, leadId, phone).catch(() => false)) return;
    }

    let action = decision.action;
    // "wait" (they're mid-typing) requeues ONCE; the second time we must act, not wait again.
    if (action === "wait" && job.waitedOnce) action = decision.reply ? "reply" : "ignore";

    if (action === "ignore") {
      console.log(`[whatsapp] auto-reply: ${leadId} intent=${decision.intent} → ignore (${decision.reason})`);
      return;
    }
    if (action === "wait") {
      await enqueueWhatsappAutoReply({ ...job, waitedOnce: true }, { startAfter: WAIT_REQUEUE_S });
      return;
    }

    const reply = decision.reply.trim();
    if (!reply) return;
    await simulateTyping(tenantId, phone, typingMs(reply));
    const { waMessageId } = await sendText(tenantId, phone, reply);
    await recordOutgoing(supabase, tenantId, leadId, reply, waMessageId, "brain");
  } catch (e: any) {
    console.warn(`[whatsapp] auto-reply failed for ${leadId}:`, e?.message);
  }
}
