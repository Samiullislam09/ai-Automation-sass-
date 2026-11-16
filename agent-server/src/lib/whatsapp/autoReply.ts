/** §28 Phase 1 — the auto-reply engine's reactive lane: a DELAYED, COALESCED, safety-gated reply
 *  to an inbound message.
 *
 *  WHY NOT SEND INLINE (the old way). session.ts used to call suggestReply→sendText the instant a
 *  message arrived — a reply within a second, to every message, around the clock. That is exactly
 *  what gets a WhatsApp-Web-linked number banned. This module replaces it with a queued job:
 *    inbound → scheduleAutoReply() enqueues with the delay timing.ts decides: a FIRST message waits
 *              1–5 minutes (a person at a phone, not a machine); once the chat is live — we have replied
 *              within 5 hours — the pause is 2–6 s
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
import { decideReply, detectOptOut, detectBuyIntent, isNearDuplicate, loadRecentThread } from "./decide.js";
import { detectLanguage, classifyLanguage, splitForChat, HOLDING, OPT_OUT_ACK } from "./conversation.js";
import { logEvent } from "./events.js";
import { replyTiming, delayUntilReplyS, activeDelayS } from "./timing.js";
import { sendText, simulateTyping, setPresence } from "./session.js";
import { recordOutgoing } from "./store.js";
import { notifyAdmins, createNotification } from "./team.js";
import { ownerPings } from "./ownerPing.js";
import { offerMeeting, handleMeetingReply, offerBookingLink } from "./meeting.js";

export type AutoReplyJob = { tenantId: string; leadId: string; phone: string; waitedOnce?: boolean; redecided?: boolean; deferred?: number };

/** When the model's rate-limit lane is full (a surge), the reply is put back and tried again rather than
 *  answered with a holding message: a customer told "a team member will reply" because OUR queue was busy
 *  is a worse outcome than one who waits another half minute. After this many tries the holding reply and a
 *  human take over. 4 x 15-30 s is at most about two extra minutes. */
const MAX_DEFERRALS = 4;
const DEFER_MIN_S = 15;
const DEFER_SPREAD_S = 15;
const isBusy = (e: any) => /rate limit|key pool/i.test(String(e?.message ?? ""));

/** When the model says the lead is still typing ("wait"), we requeue ONCE after this short gap and
 *  re-decide — so a half-typed "hi" + the real question become one reply. Only once, so a stream of
 *  "wait"s can never loop forever. */
const WAIT_REQUEUE_S = 8;

/** How long a message waits before Mr Lxwa answers is decided in timing.ts: 1–5 minutes for the first message of
 *  an exchange, 2–6 seconds while the conversation is live. */

/** The customer must have been quiet this long before we answer, so a burst of short messages gets
 *  ONE answer to all of them. Capped, so a customer who keeps typing is still answered. */
const QUIET_MS = 3_000;
const QUIET_MAX_WAIT_MS = 12_000;

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

/** The most replies to people who WROTE FIRST that one number sends in 24 h. The warm-up cap above exists to
 *  keep a new number from looking like a spammer, and that is about messages WE START. Answering someone
 *  who has just messaged us is ordinary use of WhatsApp — yet the same cap used to block replies too, and
 *  silently: a new number (cap 20) that 60 people wrote to answered 20 of them and ignored 40 with one log
 *  line nobody reads. Replies get their own, much higher ceiling (4x the warm-up cap, never under 150);
 *  what we start ourselves keeps the strict cap. */
export function reactiveCeiling(firstConnectedAtMs: number | null, nowMs: number): number {
  return Math.max(150, warmupCap(firstConnectedAtMs, nowMs) * 4);
}

/** A human-ish typing time for a reply: ~22 ms/char, clamped 0.9–3.5 s. It was 35 ms/char up to 5 s on top of a 5-second quiet
 *  window and a 2-6 s pause: a customer waited 13-21 seconds for a short answer (measured on a real chat, 2026-11-14). Short
 *  replies now type for 2-3 s, and the typing indicator is shown while the model is still working (see handleAutoReplyLocked),
 *  so most of it overlaps. */
export function typingMs(text: string): number {
  return Math.min(3500, Math.max(900, text.length * 22));
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
  if (dailyAutoSendCount >= reactiveCeiling(firstConnectedAtMs, nowMs)) return { ok: false, reason: "daily reply ceiling reached" };
  return { ok: true };
}

/** Schedule an auto-reply for a lead after a short random human-like delay. NOTE there is no
 *  singletonKey: under pg-boss's default queue policy it dedupes nothing (it only means something
 *  with the short/singleton/stately policies), so the old comment here claiming it coalesced a
 *  burst was wrong. Coalescing is done by the worker instead (per-lead lock + quiet window + the
 *  "already answered" gate). Best effort: a queue hiccup must never break receiving the message,
 *  so the caller `void`s this. */
export async function scheduleAutoReply(job: AutoReplyJob): Promise<void> {
  // The pause depends on the conversation, so read it. If that fails, a short pause is the safe default
  // (a reply that comes a little early is better than one that never comes).
  let startAfter = activeDelayS();
  try {
    const timing = replyTiming(await recentTimingRows(job.tenantId, job.leadId), job.leadId);
    startAfter = delayUntilReplyS(timing, Date.now());
    if (timing.mode === "opening") void logEvent(job.tenantId, job.leadId, "system", `First message: answering in about ${Math.round(startAfter / 60 * 10) / 10} min (a natural pause, like a person)`);
  } catch { /* keep the default */ }
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

/** The direction and time of the last messages in a chat — all timing.ts needs. */
async function recentTimingRows(tenantId: string, leadId: string): Promise<{ direction: "in" | "out"; created_at: string }[]> {
  const { data } = await supabase
    .from("outreach_messages")
    .select("direction, created_at")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(40);
  return ((data ?? []) as any[]).filter((r) => r.direction === "in" || r.direction === "out");
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
    void logEvent(tenantId, leadId, "flagged", `Handed to a person: ${reason}`);
  } catch (e: any) {
    console.warn("[whatsapp] could not flag lead for a human:", e?.message);
  }
}

/** A "needs you" alert to the owner: always on the dashboard, but at most one WhatsApp every few minutes
 *  (ownerPing.ts), saying how many more arrived since. */
async function notifyOwner(tenantId: string, n: { title: string; body: string; leadId?: string | null; whatsappText: string }): Promise<void> {
  const gate = ownerPings.take(tenantId);
  const more = gate.send && gate.held > 0 ? ` (+${gate.held} more since the last alert — see the dashboard)` : "";
  await notifyAdmins(tenantId, { type: "system", title: n.title, body: n.body, leadId: n.leadId ?? null, whatsappText: n.whatsappText + more }, { whatsapp: gate.send });
}

/** The assistant could not produce an answer. Say so honestly, once, and get a person on it. */
async function holdingReply(tenantId: string, leadId: string, phone: string, alreadySaid: string[], inboundAt: string | null): Promise<void> {
  try {
    const thread = await loadRecentThread(supabase, tenantId, leadId, 12);
    const lang = detectLanguage(thread);
    const text = HOLDING[lang];
    // Never twice: a customer who already got this line and is still unanswered gets the owner's
    // attention, not a second copy of an apology.
    const already = alreadySaid.some((m) => Object.values(HOLDING).some((h) => isNearDuplicate(m, h)));
    if (!already) {
      await simulateTyping(tenantId, phone, typingMs(text));
      const { waMessageId } = await sendText(tenantId, phone, text);
      await recordOutgoing(supabase, tenantId, leadId, text, waMessageId, "brain");
    }
    await flagForHuman(tenantId, leadId, "A customer is waiting", "The assistant could not answer in time — please reply to this chat yourself.");
    void notifyOwner(tenantId, {
      title: "🙋 A customer is waiting",
      body: "The assistant could not answer in time.",
      leadId,
      whatsappText: "A customer messaged on WhatsApp and the assistant could not answer in time — please reply to them yourself.",
    }).catch(() => {});
    if (inboundAt) console.log(`[whatsapp] holding reply for ${leadId} after ${Math.round((Date.now() - Date.parse(inboundAt)) / 1000)}s`);
  } catch (e: any) {
    console.warn(`[whatsapp] holding reply failed for ${leadId}:`, e?.message);
    await flagForHuman(tenantId, leadId, "A customer is waiting", "The assistant could not reply — please answer this chat yourself.");
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
  let typingOn = false;
  let startedAt = Date.now();
  try {
    // THE FIRST-MESSAGE PAUSE, enforced where the answer is actually produced. scheduleAutoReply already
    // delays the job, but a burst creates several jobs (one per message) and a later one is queued with
    // the short mid-conversation pause — without this check it could run first and answer a first message
    // in seconds. Every job derives the same due time from the same thread, so whichever runs early simply
    // puts itself back until then.
    const timing = replyTiming(await recentTimingRows(tenantId, leadId), leadId);
    if (timing.mode === "opening" && timing.dueAtMs != null && Date.now() < timing.dueAtMs - 500) {
      await enqueueWhatsappAutoReply(job, { startAfter: delayUntilReplyS(timing, Date.now()) });
      return;
    }
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
      void logEvent(tenantId, leadId, "system", "Asked to stop: confirmed once, and will not be messaged again");
      // One short confirmation, then never again (the flag above blocks every later send). Silence after
      // "band karo" reads as being ignored; a person would say "understood". Best effort.
      try {
        const ack = OPT_OUT_ACK[classifyLanguage(last.body) ?? "en"];
        await simulateTyping(tenantId, phone, typingMs(ack));
        const { waMessageId } = await sendText(tenantId, phone, ack);
        await recordOutgoing(supabase, tenantId, leadId, ack, waMessageId, "brain");
      } catch (e: any) {
        console.warn(`[whatsapp] opt-out confirmation not sent for ${leadId}:`, e?.message);
      }
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
      void logEvent(tenantId, leadId, "skipped", `Not answered: ${gate.reason}`);
      // Most reasons are right to stay quiet about (opted out, a human has the chat, we spoke last). Hitting the
      // daily ceiling is not: a customer is being left unanswered, and the owner has to be able to see it.
      if (/ceiling/.test(gate.reason ?? "")) {
        await flagForHuman(tenantId, leadId, "A customer is waiting", "The daily reply limit for this WhatsApp number was reached — please answer this chat yourself.");
        await notifyOwner(tenantId, { title: "🙋 Reply limit reached", body: "The daily reply limit was reached; customers are waiting for you.", leadId, whatsappText: "The daily reply limit for your WhatsApp number was reached — customers who write now need a reply from you." });
      }
      return;
    }

    // PENDING MEETING OFFER (§29.6 P7): if we already offered slots and they just replied, treat the
    // reply as a slot pick / postpone BEFORE the general decision engine — booking the Meet, or
    // re-offering. If it handled the message, we're done.
    if (last.direction === "in" && (await handleMeetingReply(tenantId, leadId, phone, last.body))) return;

    // "typing…" from the first second. The customer used to see nothing until the model had finished and THEN a typing
    // indicator for several more seconds; now they see someone typing at once and the answer lands when it is ready.
    startedAt = Date.now();
    await setPresence(tenantId, phone, "composing");
    typingOn = true;

    // THE DECISION ENGINE (§28.3): one call → intent + confidence + action + a drafted reply.
    const alreadySaid = await recentOutgoing(tenantId, leadId, 3);
    let decision;
    try {
      decision = await decideReply(supabase, tenantId, leadId);
    } catch (e: any) {
      // The model timed out, was rate-limited for too long, or returned nonsense. The customer has
      // just written in and must not be left with silence: tell them, once, that a person will
      // answer — and make that true by flagging the lead and alerting the owner.
      console.warn(`[whatsapp] reply model failed for ${leadId}: ${e?.message}`);
      // The LLM lane is full (a surge): wait a little and try again before telling the customer anything.
      void logEvent(tenantId, leadId, "error", `The reply model failed: ${String(e?.message ?? e).slice(0, 160)}`);
      if (isBusy(e) && (job.deferred ?? 0) < MAX_DEFERRALS) {
        void logEvent(tenantId, leadId, "system", `The reply model was busy: trying again (${(job.deferred ?? 0) + 1} of ${MAX_DEFERRALS})`);
        await enqueueWhatsappAutoReply({ ...job, deferred: (job.deferred ?? 0) + 1 }, { startAfter: DEFER_MIN_S + Math.floor(Math.random() * DEFER_SPREAD_S) });
        return;
      }
      await holdingReply(tenantId, leadId, phone, alreadySaid, last.at);
      return;
    }

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

    // THE CUSTOMER HAS SAID WHEN THEY WOULD LIKE THE CALL ("subah"), and nothing can book it automatically (no calendar, no
    // booking link — otherwise the slots flow would have caught it). Record it on the lead, move the lead on, and tell the team
    // exactly what to do. Not throttled like the other alerts: a call request is the most valuable thing in the inbox.
    // Google Calendar connected? Then the customer does not need to type a time: offer real free slots (the customer picks a
    // number, the assistant books the Meet and tells the team). Skipped if slots were already offered in the last 30 minutes —
    // the same list twice would just confuse them.
    const slotsRecentlyOffered = async () => {
      const { data } = await supabase.from("lead_meetings").select("id").eq("tenant_id", tenantId).eq("lead_id", leadId).eq("status", "offered").gt("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
      return !!data?.length;
    };
    if ((decision.meeting_pref || decision.intent === "meeting") && !(await slotsRecentlyOffered())) {
      if (await offerMeeting(tenantId, leadId, phone).catch(() => false)) {
        const whoS = (lead as any).company || (lead as any).name || phone;
        await supabase.from("leads").update({ stage: "meeting_requested", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);
        await notifyAdmins(tenantId, { type: "meeting", title: `📅 ${whoS} wants a call`, body: "Real time slots from your calendar were offered on WhatsApp.", leadId, whatsappText: `${whoS} wants a call — I offered them real time slots. I'll book the Google Meet and send you the link when they pick one.` }).catch(() => {});
        void logEvent(tenantId, leadId, "meeting", "Call requested: offered real free slots from Google Calendar");
        return;
      }
    }
    if (decision.meeting_pref) {
      const whoM = (lead as any).company || (lead as any).name || phone;
      await supabase.from("leads").update({
        stage: "meeting_requested", needs_attention: true,
        needs_attention_reason: `Wants a call — ${decision.meeting_pref}. Send them a time and a meeting link.`,
        updated_at: new Date().toISOString(),
      }).eq("id", leadId).eq("tenant_id", tenantId);
      await notifyAdmins(tenantId, {
        type: "meeting",
        title: `📅 ${whoM} wants a call — ${decision.meeting_pref}`,
        body: "No calendar or booking link is set up, so the call has to be arranged by hand.",
        leadId,
        whatsappText: `${whoM} wants a call: ${decision.meeting_pref}. Please message them a time and a meeting link. (To make this automatic: open the dashboard → Connect → Google and connect your Google account — then I will offer free times, create the Google Meet link, add it to your calendar and send it to you and the customer.)`,
      }).catch((e: any) => console.warn("[whatsapp] meeting alert failed:", e?.message));
      void logEvent(tenantId, leadId, "meeting", `Wants a call — ${decision.meeting_pref}. Team told to schedule it by hand (no calendar or booking link).`);
    }

    // The model says a person must take over (price / document / complaint it cannot settle from
    // the facts it has): tell the owner on the transition only, so a long exchange is one alert.
    if (decision.needs_human && !(lead as any).needs_attention && !decision.meeting_pref) {
      const who0 = (lead as any).company || (lead as any).name || phone;
      void notifyOwner(tenantId, {
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
    if (decision.intent === "meeting" && !decision.meeting_pref && MEETING_PRE.includes(String((lead as any).stage))) {
      const who = (lead as any).company || (lead as any).name || phone;
      await supabase.from("leads").update({ stage: "meeting_requested", updated_at: new Date().toISOString() }).eq("id", leadId).eq("tenant_id", tenantId);

      // Meeting scheduling, in order of preference:
      //  1) Google Calendar connected → offer real free slots (Option B, auto Meet on reply).
      //  2) else a booking link set (Calendly/Cal.com) → send it, the lead self-books (no Google).
      //  3) else nothing can be sent: the reply (already the honest, code-written one — decide.ts) asks WHEN they are free, and
      //     the owner is told exactly what is missing so a missing link is never a silent gap.
      if (await offerMeeting(tenantId, leadId, phone).catch(() => false)) {
        await notifyAdmins(tenantId, { type: "meeting", title: `📅 Meeting request from ${who}`, body: "Real time slots were offered on WhatsApp.", leadId, whatsappText: `${who} asked for a call — I offered them real time slots. I'll confirm and send the Meet link when they pick one.` }).catch(() => {});
        void logEvent(tenantId, leadId, "meeting", "Call requested: offered real time slots from the calendar");
        return;
      }
      if (await offerBookingLink(tenantId, leadId, phone).catch(() => false)) {
        await notifyAdmins(tenantId, { type: "meeting", title: `📅 Meeting request from ${who}`, body: "Your booking link was sent.", leadId, whatsappText: `${who} asked for a call — I sent them your booking link.` }).catch(() => {});
        void logEvent(tenantId, leadId, "meeting", "Call requested: sent the booking link");
        return;
      }
      await notifyAdmins(tenantId, {
        type: "meeting",
        title: `📅 Meeting request from ${who}`,
        body: "No calendar or booking link is set up, so no meeting link could be sent automatically.",
        leadId,
        whatsappText: `${who} asked for a call. I could not send a meeting link automatically — no Google Calendar is connected and no booking link is set. I asked them when they are free; please message them a time and a link. To make this automatic: dashboard → Connect → Google → Connect.`,
      }).catch((e: any) => console.warn("[whatsapp] meeting alert failed:", e?.message));
      void logEvent(tenantId, leadId, "meeting", "Call requested, but NO calendar or booking link is set up: asked when they are free and told the team to arrange it by hand");
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
      void logEvent(tenantId, leadId, "skipped", `Chose not to reply (${decision.intent}): ${decision.reason || "nothing to answer"}`);
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
    // A line the code itself wrote (a meeting acknowledgement, "cannot share the price") is exempt: it is deliberate and
    // different in each state. The guard used to catch the SECOND such line, give up and send nothing — a customer who had
    // just answered "subah" got silence (live, 2026-11-14).
    if (!decision.templated && alreadySaid.some((m) => isNearDuplicate(reply, m))) {
      const retry = await decideReply(supabase, tenantId, leadId, { avoid: alreadySaid });
      const next = retry.action === "reply" ? retry.reply.trim() : "";
      if (!next || alreadySaid.some((m) => isNearDuplicate(next, m))) {
        // Still a repeat. Never go silent on someone who just wrote: a short honest holding line (once), the lead flagged,
        // the owner told — and the log says exactly what happened.
        void logEvent(tenantId, leadId, "skipped", "The reply would have repeated an earlier message: sent a holding line and handed it to a person instead");
        await holdingReply(tenantId, leadId, phone, alreadySaid, last.at);
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

    // As a person would send it: a long reply goes out as two or three SHORT messages, each with its own moment of typing.
    // The first one's typing was already shown while the model worked, so only the remainder of it is waited out.
    const parts = splitForChat(reply);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === 0) await sleep(Math.max(0, typingMs(part) - (Date.now() - startedAt)));
      else { await setPresence(tenantId, phone, "composing"); await sleep(typingMs(part)); }
      const { waMessageId } = await sendText(tenantId, phone, part);
      await recordOutgoing(supabase, tenantId, leadId, part, waMessageId, "brain");
    }
    // Reply time, as the customer felt it: their message arriving → ours leaving. The number every
    // "is it fast enough?" question should be answered with, instead of a feeling.
    const latencyS = last.at ? Math.round((Date.now() - Date.parse(last.at)) / 1000) : null;
    if (latencyS != null) console.log(`[whatsapp] replied to ${leadId} in ${latencyS}s`);
    void logEvent(tenantId, leadId, "sent", `Replied${latencyS != null ? ` in ${latencyS}s` : ""}${parts.length > 1 ? ` (as ${parts.length} short messages)` : ""}`, {
      text: reply.slice(0, 600), intent: decision.intent, needs_human: decision.needs_human, reason: decision.reason, notes: decision.notes ?? [], latency_s: latencyS, parts: parts.length,
    });
  } catch (e: any) {
    console.warn(`[whatsapp] auto-reply failed for ${leadId}:`, e?.message);
    void logEvent(tenantId, leadId, "error", `The reply failed: ${String(e?.message ?? e).slice(0, 200)}`);
    // The customer's message is NOT left unanswered in silence: the owner sees it on the Leads page.
    await flagForHuman(tenantId, leadId, "A customer is waiting", "The assistant could not reply (a technical error) — please answer this chat yourself.");
  } finally {
    // Whatever happened, do not leave "typing…" showing on the customer's phone.
    if (typingOn) await setPresence(tenantId, phone, "paused").catch(() => {});
  }
}
