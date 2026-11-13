/** §28 Phase 1 — the auto-reply engine's reactive lane: a DELAYED, COALESCED, safety-gated reply
 *  to an inbound message.
 *
 *  WHY NOT SEND INLINE (the old way). session.ts used to call suggestReply→sendText the instant a
 *  message arrived — a reply within a second, to every message, around the clock. That is exactly
 *  what gets a WhatsApp-Web-linked number banned. This module replaces it with a queued job:
 *    inbound → scheduleAutoReply() enqueues with a SHORT random delay (4–12 s)
 *            → the worker runs, waits for the customer to stop typing (a few seconds of quiet),
 *              re-reads the thread, checks the gate, types, then sends ONE reply.
 *  A burst ("hi" + "I need ISO 9001" as two messages) becomes one reply because jobs for the same
 *  lead run one at a time (a per-lead lock) and the second finds the first already answered.
 *  Until 2026-11-13 this was a 30–180 s delay on top of a 300 s queue wake-up gap, and customers
 *  waited 4–5 minutes per reply and left. A person who just wrote in expects an answer in seconds.
 *
 *  THE GATE IS THE SAFETY LAYER (§28.2). It is a pure function so the rules are unit-testable with
 *  no database and no clock. Reactive replies deliberately IGNORE quiet hours — answering someone
 *  who just messaged you is natural at any hour; quiet hours constrain the PROACTIVE lanes
 *  (outbound timeline, follow-ups), not this one. */
import { supabase } from "../../supabase.js";
import { enqueueWhatsappAutoReply } from "../../queues.js";
import { decideReply, detectOptOut, detectBuyIntent, isNearDuplicate } from "./decide.js";
import { sendText, simulateTyping } from "./session.js";
import { recordOutgoing } from "./store.js";
import { notifyAdmins, createNotification } from "./team.js";
import { offerMeeting, handleMeetingReply, offerBookingLink } from "./meeting.js";

export type AutoReplyJob = { tenantId: string; leadId: string; phone: string; waitedOnce?: boolean; redecided?: boolean };

/** When the model says the lead is still typing ("wait"), we requeue ONCE after this short gap and
 *  re-decide — so a half-typed "hi" + the real question become one reply. Only once, so a stream of
 *  "wait"s can never loop forever. */
const WAIT_REQUEUE_S = 8;

/** A new message waits a random slice of this window before Mr Lxwa answers — never instant. */
const DELAY_MIN_S = 4;
const DELAY_MAX_S = 12;

/** The customer must have been quiet this long before we answer, so a burst of short messages gets
 *  ONE answer to all of them. Capped, so a customer who keeps typing is still answered. */
const QUIET_MS = 5_000;
const QUIET_MAX_WAIT_MS = 20_000;

/** One reply at a time per lead. The worker runs two jobs at once and a burst creates several jobs
 *  for the same chat; without this they race — each reads the thread before the other has sent,
 *  both decide to answer, and the customer gets the same reply twice. Safe because every
 *  wa-autoreply worker lives in this one process (index.ts). */
const leadLocks = new Map<string, Promise<void>>();

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

/** Schedule an auto-reply for a lead after a short random human-like delay. NOTE there is no
 *  singletonKey: under pg-boss's default queue policy it dedupes nothing (it only means something
 *  with the short/singleton/stately policies), so the old comment here claiming it coalesced a
 *  burst was wrong. Coalescing is done by the worker instead (per-lead lock + quiet window + the
 *  "already answered" gate). Best effort: a queue hiccup must never break receiving the message,
 *  so the caller `void`s this. */
export async function scheduleAutoReply(job: AutoReplyJob): Promise<void> {
  const startAfter = DELAY_MIN_S + Math.floor(Math.random() * (DELAY_MAX_S - DELAY_MIN_S + 1));
  try {
    await enqueueWhatsappAutoReply(job, { startAfter });
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

async function lastMessage(tenantId: string, leadId: string): Promise<{ direction: "in" | "out" | null; body: string; at: string | null }> {
  try {
    const { data } = await supabase
      .from("outreach_messages")
      .select("direction, body, created_at")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const d = (data as any)?.direction;
    return { direction: d === "in" || d === "out" ? d : null, body: String((data as any)?.body ?? ""), at: (data as any)?.created_at ?? null };
  } catch {
    return { direction: null, body: "", at: null };
  }
}

/** Our last few messages to this lead, newest first — what a new reply must not repeat. */
async function recentOutgoing(tenantId: string, leadId: string, n = 3): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("outreach_messages")
      .select("body")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .eq("direction", "out")
      .order("created_at", { ascending: false })
      .limit(n);
    return ((data ?? []) as any[]).map((r) => String(r.body ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Let a customer who is still typing finish. Returns once their last message is at least QUIET_MS
 *  old (or the cap is hit), so "hi" / "I need ISO" / "what is the price" is answered once. */
async function waitForQuiet(tenantId: string, leadId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < QUIET_MAX_WAIT_MS) {
    const last = await lastMessage(tenantId, leadId);
    if (last.direction !== "in" || !last.at) return;
    const age = Date.now() - Date.parse(last.at);
    if (age >= QUIET_MS) return;
    await sleep(Math.min(QUIET_MS - age + 250, 3000));
  }
}

/** Tell the owner something went wrong with a reply — and put the lead on the "needs you" list —
 *  instead of dropping the customer's message silently, which is what every failure here did
 *  before (a console line nobody reads). Dashboard notification only: no WhatsApp ping, so a
 *  provider outage cannot turn into a flood. */
async function flagForHuman(tenantId: string, leadId: string, title: string, reason: string): Promise<void> {
  try {
    await supabase.from("leads").update({ needs_attention: true, needs_attention_reason: reason, updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
    await createNotification(tenantId, { type: "system", title, body: reason, leadId });
  } catch (e: any) {
    console.warn("[whatsapp] could not flag lead for a human:", e?.message);
  }
}

/** The worker body — runs when a scheduled reply is due. Reads FRESH state (the thread may have
 *  grown since the job was enqueued), checks the gate, then types and sends ONE message. Every
 *  exit is logged, nothing is thrown past the queue, so one bad lead never stalls the worker. */
export async function handleAutoReply(job: AutoReplyJob): Promise<void> {
  const key = `${job.tenantId}:${job.leadId}`;
  const prev = leadLocks.get(key) ?? Promise.resolve();
  const run = prev.then(() => handleAutoReplyLocked(job));
  const tail = run.catch(() => {});
  leadLocks.set(key, tail);
  try {
    await run;
  } finally {
    if (leadLocks.get(key) === tail) leadLocks.delete(key);
  }
}

async function handleAutoReplyLocked(job: AutoReplyJob): Promise<void> {
  const { tenantId, leadId, phone } = job;
  try {
    // Customer still typing? Let them finish, so a burst is answered once, not three times.
    await waitForQuiet(tenantId, leadId);

    const [{ data: lead }, { data: session }, last, count] = await Promise.all([
      supabase.from("leads").select("opt_out, auto_reply_paused_until, stage, company, name, needs_attention").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle(),
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
    const alreadySaid = await recentOutgoing(tenantId, leadId, 3);
    let decision = await decideReply(supabase, tenantId, leadId);

    // The customer may have written again WHILE the model was thinking. Answering the old message
    // now would talk past them — so decide again on the fuller thread (once), and if they are STILL
    // typing, hand it to a fresh job instead of looping here.
    const fresh = await lastMessage(tenantId, leadId);
    if (fresh.at !== last.at) {
      if (!job.redecided) return handleAutoReplyLocked({ ...job, redecided: true });
      await scheduleAutoReply({ tenantId, leadId, phone });
      return;
    }

    // Record what we understood on the lead — so the Leads page / Mr Lxwa can show "kahaan tak baat
    // hui" and flag the ones a human should look at — regardless of whether we send now.
    await supabase
      .from("leads")
      .update({
        last_intent: decision.intent,
        // STICKY: a flag raised for a person stays up until a person answers (store.ts clears it when
        // a human sends). It used to be overwritten with `false` by the very next decision — an
        // owner-alert for "asked about price" vanished the moment the customer said "ok".
        ...(decision.needs_human
          ? { needs_attention: true, needs_attention_reason: decision.reason || decision.intent }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .eq("tenant_id", tenantId);

    // The model says a person must take over (price / document / complaint it cannot settle from
    // the facts it has): tell the owner on the transition only, so a long exchange is one alert.
    if (decision.needs_human && !(lead as any).needs_attention) {
      const who0 = (lead as any).company || (lead as any).name || phone;
      void notifyAdmins(tenantId, {
        type: "system",
        title: `🙋 ${who0} needs you`,
        body: decision.reason || "The assistant could not settle this from what it knows.",
        leadId,
        whatsappText: `${who0} needs you on WhatsApp — ${decision.reason || "please take a look"}.`,
      }).catch(() => {});
    }

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

      // Meeting scheduling, in order of preference:
      //  1) Google Calendar connected → offer real free slots (Option B, auto Meet on reply).
      //  2) else a booking link set (Calendly/Cal.com) → send it, the lead self-books (no Google).
      //  3) else nothing sent here → the normal reply goes and the admins (just alerted) book by hand.
      if (await offerMeeting(tenantId, leadId, phone).catch(() => false)) return;
      if (await offerBookingLink(tenantId, leadId, phone).catch(() => false)) return;
    }

    // READY TO BUY (§29.8). Two tiers:
    //  · EXPLICIT high-confidence buy ("send the invoice", "let's start") → auto-convert to a client
    //    (owner: fully automatic). A human can move it back in one tap.
    //  · softer "ready" intent → stage ready_to_buy + hot alert + next-steps, but NOT auto-converted.
    const STAGE = String((lead as any).stage);
    const NOT_DONE = !["won", "lost", "opted_out"].includes(STAGE);
    const who2 = (lead as any).company || (lead as any).name || phone;
    if (last.direction === "in" && detectBuyIntent(last.body) && NOT_DONE) {
      await supabase.from("leads").update({ stage: "won", needs_attention: true, needs_attention_reason: "Became a client — confirm & follow up", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
      await notifyAdmins(tenantId, { type: "hot_lead", title: `🎉 New client: ${who2}`, body: "An explicit buying signal — the lead was auto-converted to a client. Confirm the details.", leadId, whatsappText: `New client: ${who2} just gave a buying signal on WhatsApp. Confirm the details.` }).catch(() => {});
      const body = "That's wonderful — thank you! I'll get everything set up and our team will send the next steps right away.";
      try { await simulateTyping(tenantId, phone, typingMs(body)); const { waMessageId } = await sendText(tenantId, phone, body); await recordOutgoing(supabase, tenantId, leadId, body, waMessageId, "brain"); } catch { /* best effort */ }
      return;
    }
    const READY_PRE = ["new", "approved", "contacted", "delivered", "read", "replied", "in_conversation", "interested", "meeting_requested", "meeting_scheduled", "meeting_done"];
    if (decision.intent === "ready" && READY_PRE.includes(STAGE)) {
      await supabase.from("leads").update({ stage: "ready_to_buy", needs_attention: true, needs_attention_reason: "Ready to buy — follow up", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
      await notifyAdmins(tenantId, { type: "hot_lead", title: `🔥 Hot lead: ${who2} is ready to buy`, body: decision.reason || "Showed a strong buying signal on WhatsApp.", leadId, whatsappText: `Hot lead: ${who2} looks ready to buy. Open the WhatsApp inbox to close it.` }).catch(() => {});
      const body = decision.reply?.trim() || "Great to hear! I'll line up the next steps — would you like me to send a quick summary of what's involved?";
      try { await simulateTyping(tenantId, phone, typingMs(body)); const { waMessageId } = await sendText(tenantId, phone, body); await recordOutgoing(supabase, tenantId, leadId, body, waMessageId, "brain"); } catch { /* best effort */ }
      return;
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

    let reply = decision.reply.trim();
    if (!reply) return;

    // NEVER repeat ourselves. If the draft is (nearly) something we already sent, ask the model once
    // more with those lines marked off-limits; if it STILL repeats, say nothing and hand the chat to
    // a person — a repeated line ("Sorry for the delay…" four times) is what made the customer
    // leave, and silence plus an alert beats a fifth copy.
    if (alreadySaid.some((m) => isNearDuplicate(reply, m))) {
      const retry = await decideReply(supabase, tenantId, leadId, { avoid: alreadySaid });
      const next = retry.action === "reply" ? retry.reply.trim() : "";
      if (!next || alreadySaid.some((m) => isNearDuplicate(next, m))) {
        await flagForHuman(tenantId, leadId, "A customer needs you", "The assistant was about to repeat itself — please reply to this chat yourself.");
        return;
      }
      reply = next;
      decision = retry;
    }

    // The same final check, right before the send: it is the only thing between a race and a
    // second message to a real person.
    const beforeSend = await lastMessage(tenantId, leadId);
    if (beforeSend.direction !== "in" || beforeSend.at !== last.at) {
      console.log(`[whatsapp] auto-reply for ${leadId} dropped: the thread changed while drafting`);
      if (beforeSend.direction === "in") await scheduleAutoReply({ tenantId, leadId, phone });
      return;
    }

    await simulateTyping(tenantId, phone, typingMs(reply));
    const { waMessageId } = await sendText(tenantId, phone, reply);
    await recordOutgoing(supabase, tenantId, leadId, reply, waMessageId, "brain");
  } catch (e: any) {
    console.warn(`[whatsapp] auto-reply failed for ${leadId}:`, e?.message);
    // The customer's message is NOT left unanswered in silence: the owner sees it on the Leads page.
    await flagForHuman(tenantId, leadId, "A customer is waiting", "The assistant could not reply (a technical error) — please answer this chat yourself.");
  }
}
