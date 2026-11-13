/** WHEN the assistant answers — the pause that makes it feel like a person at a phone, not a machine.
 *
 *  Owner, 2026-11-14: "when a user's FIRST message comes, do not answer at once — wait 1 to 5 minutes.
 *  Once the conversation has started there is no delay at all, so it feels like a human; and for the
 *  next 5 hours reply immediately. We are not 'always online' either when someone first writes to us."
 *
 *  So there are two modes, decided from the thread alone (a pure function: no clock, no database):
 *
 *   OPENING — nobody has been talking. The customer's message is the first of a new exchange: their first
 *     ever, their first answer to our opener or to one of our follow-ups, or the first after the chat has
 *     been quiet for 5 hours. The answer comes 1–5 minutes after THEIR FIRST unanswered message. Two or
 *     three messages sent during that pause are one wait, answered together (the clock does not restart).
 *
 *   ACTIVE — we replied to them within the last 5 hours. Anything they write is answered within seconds
 *     (2–6 s, then the typing indicator, then the model — a person's pace, not a pause).
 *
 *  An outbound counts as a "reply" only when the customer wrote something between it and the outbound
 *  before it. Our opener and our follow-up nudges are not replies: a lead who answers one of them is
 *  starting a conversation, not continuing one.
 *
 *  The 1–5 minutes is not random per job: it is derived from the lead and the moment their first message
 *  arrived, so every job that looks at the same burst computes the same due time. Several jobs for one
 *  burst (one per message) therefore cannot answer early by racing each other.
 *
 *  It also spreads load. A surge of first messages (an ad goes live, a broadcast lands) is answered over
 *  five minutes instead of all in the same instant — which the LLM lane and the sending caps need. */

export const ACTIVE_WINDOW_MS = 5 * 3_600_000;
export const OPENING_MIN_S = 60;
export const OPENING_MAX_S = 300;
export const ACTIVE_MIN_S = 2;
export const ACTIVE_MAX_S = 6;

export type TimingRow = { direction: "in" | "out"; created_at: string };
export type Timing = {
  /** none = the last message is ours: nothing to answer. */
  mode: "none" | "opening" | "active";
  /** When the customer's first unanswered message arrived. */
  burstStartMs: number | null;
  /** OPENING only: the moment the answer is due. */
  dueAtMs: number | null;
};

/** FNV-1a: small, stable, and good enough to spread a few hundred values evenly over 60–300. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The opening pause, in seconds, for this lead's burst. Deterministic. */
export function openingDelayS(leadId: string, burstStartMs: number): number {
  return OPENING_MIN_S + (hash(`${leadId}:${burstStartMs}`) % (OPENING_MAX_S - OPENING_MIN_S + 1));
}

/** The short pause mid-conversation, in seconds. Random — it only has to look natural. */
export function activeDelayS(rand: () => number = Math.random): number {
  return ACTIVE_MIN_S + Math.floor(rand() * (ACTIVE_MAX_S - ACTIVE_MIN_S + 1));
}

export function replyTiming(rows: TimingRow[], leadId: string): Timing {
  const sorted = rows
    .map((r) => ({ d: r.direction, t: Date.parse(r.created_at) }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  if (!sorted.length || sorted[sorted.length - 1].d !== "in") return { mode: "none", burstStartMs: null, dueAtMs: null };

  // The burst: every inbound after our last outbound.
  let lastOut = -1;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].d === "out") { lastOut = i; break; }
  const burstStartMs = sorted[lastOut + 1].t;

  // Was that last outbound a reply (did they write between it and the outbound before it)?
  let active = false;
  if (lastOut >= 0) {
    let prevOut = -1;
    for (let i = lastOut - 1; i >= 0; i--) if (sorted[i].d === "out") { prevOut = i; break; }
    let wroteBefore = false;
    for (let i = prevOut + 1; i < lastOut; i++) if (sorted[i].d === "in") { wroteBefore = true; break; }
    active = wroteBefore && burstStartMs - sorted[lastOut].t < ACTIVE_WINDOW_MS;
  }

  if (active) return { mode: "active", burstStartMs, dueAtMs: null };
  return { mode: "opening", burstStartMs, dueAtMs: burstStartMs + openingDelayS(leadId, burstStartMs) * 1000 };
}

/** Seconds to wait before the reply job should run, given the thread and the moment now. */
export function delayUntilReplyS(t: Timing, nowMs: number, rand: () => number = Math.random): number {
  if (t.mode === "opening" && t.dueAtMs != null) return Math.max(1, Math.ceil((t.dueAtMs - nowMs) / 1000));
  return activeDelayS(rand);
}
