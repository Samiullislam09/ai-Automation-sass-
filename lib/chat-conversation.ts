/** lib/chat-conversation.ts — what the chat is in the middle of (plan §5.1 upgrade B).
 *
 *  This is the table migration 017 calls `conversation_state`, and it exists to answer one
 *  question the old chat could not: **what is "haan" the answer to?**
 *
 *  Without it, multi-turn orders break in the most expensive way possible. "Kis topic pe?" →
 *  "solar panels" reads as a brand new message about solar panels. "Ye live kar dun?" → "haan"
 *  reads as agreement with nothing. And the failure is silent: the user believes they answered.
 *
 *  So one row per conversation holds the order that is waiting, and what it is waiting FOR:
 *
 *      pending_intent   the order, as the intent engine built it (or the task already created)
 *      asked_slot       "confirm", or the name of the one argument we asked about
 *      expires_at       ten minutes. After that the order lapses and NOTHING runs.
 *      turn_no          how many turns this conversation has spent on it
 *
 *  THE "NAHI" RULE, WHICH IS A REAL REGRESSION AND NOT A HYPOTHETICAL. "nahi", "mat karna",
 *  "rehne do" cancel THE PENDING INTENT AND NOTHING ELSE. They are not a cancel command. The
 *  chat once read "publish mat karna" — an instruction about something that had not happened
 *  yet — as an order to cancel the customer's next booked article, which has no undo. The
 *  matcher in lib/chat-intent.ts was fixed to require a word that means calling something off
 *  ("cancel", "band karo") rather than a word that means "no"; this file must not reintroduce
 *  the same mistake through the back door. `resolveFollowUp` returns "cancel" only when a
 *  pending intent EXISTS, and the caller may only act on the pending intent when it does.
 *
 *  EXPIRY IS A FEATURE. §10 rule 2 says an unanswered echo expires and nothing happens. Ten
 *  minutes rather than the plan's two: a user who steps away mid-conversation and comes back
 *  to type "haan" is common, and the cost of the wait is zero — the task sits in
 *  `awaiting_confirm` and no agent has been paid to do anything.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntentPlan } from "@/lib/chat-brain-intent";

/** How long a pending order waits for its answer. */
export const PENDING_TTL_MS = 10 * 60_000;

/** The slot name that means "waiting for a yes", as opposed to waiting for an argument. */
export const CONFIRM_SLOT = "confirm";

/** What is waiting.
 *
 *  Three routes, because there are three genuinely different things to resume:
 *   · "task"   — the brain already made a task and it is `awaiting_confirm`. A yes confirms it.
 *   · "slot"   — no task exists yet; one argument is missing. The next message fills it.
 *   · "legacy" — an irreversible order the brain cannot carry out yet, so the old code path
 *                will run it on a yes. The echo is the same; only the executor differs.
 */
export type PendingIntent = {
  v: 1;
  route: "task" | "slot" | "legacy";
  action: string;
  echo: string;
  /** The user's original sentence, so the resumed order is carried out on what they said. */
  message: string;
  /** route "task": the row the brain created and is holding. */
  task_id?: string | null;
  /** route "slot": the half-built order, to be re-sent once the slot is filled. */
  intent?: IntentPlan | null;
  /** route "legacy": which old handler, and its argument. */
  legacy?: { kind: string; which?: string } | null;
};

export type ConversationState = {
  conversation_id: string;
  tenant_id: string;
  pending_intent: PendingIntent | null;
  asked_slot: string | null;
  expires_at: string | null;
  turn_no: number;
};

export type FollowUp =
  | { kind: "none" }
  /** There was a pending order, and it timed out. Nothing runs; the row is cleared. */
  | { kind: "lapsed"; pending: PendingIntent }
  | { kind: "confirm"; pending: PendingIntent }
  | { kind: "cancel"; pending: PendingIntent }
  /** `value` null = "tum chuno" — they explicitly handed the choice back to the team. */
  | { kind: "slot"; slot: string; value: string | null; pending: PendingIntent };

/* ── Reading the answer ──────────────────────────────────────────────────────────────── */

/** A no, searched anywhere in the sentence.
 *
 *  Anywhere rather than at the start, because "haan lekin publish mat karna" contains both
 *  answers and the refusal has to win — the direction that does nothing is always the safe
 *  one to resolve towards. */
const SAYS_NO =
  /\b(?:nahi+|nahin|nai|nhi|na\s*karo|na\s*karna|mat\s*kar\w*|mat\s*likh\w*|mat\s*bhej\w*|rehne\s*do|rahne\s*do|rehne\s*de|chhod\s*do|chod\s*do|cancel|ruk\s*\w*|rok\s*do|stop|no|nope|nah|don'?t|do\s*not|abhi\s*nahi|baad\s*me\s*karna|skip)\b/i;

/** A yes, at the start of the sentence. Anchored because "kar do" and "ok" turn up inside
 *  ordinary sentences that are not answers at all ("agar ho sake to kar do jo pehle bola tha"),
 *  and reading one of those as a confirmation would run an irreversible order. */
const SAYS_YES =
  /^[\s.,!]*(?:haan|haa+n?|han|ha|hn|ji|ji\s*haan|yes|yeah|yep|yup|ok|okay|okey|k|sure|theek|thik|thk|sahi|bilkul|chalo|kar\s*do|kardo|karo|kar\s*de|karde|kar\s*dijiye|chalao|go\s*ahead|do\s*it|proceed|confirm|start|please\s*do)\b/i;

/** "you pick" — the answer to a slot question that hands the choice back to the team. */
const HANDS_IT_BACK =
  /\b(?:tum\s*chuno|tum\s*decide|aap\s*chuno|aap\s*decide|you\s*(?:choose|pick|decide)|koi\s*bhi|jo\s*bhi|jo\s*acha\s*lage|kuch\s*bhi|anything|your\s*choice)\b/i;

/** A slot answer should be a short thing, not a fresh paragraph. Longer than this and the
 *  user has moved on to something else, and the pending order should lapse rather than
 *  swallow their new sentence as an argument. */
const MAX_SLOT_ANSWER = 90;

const isExpired = (state: ConversationState, now: Date): boolean =>
  !!state.expires_at && new Date(state.expires_at).getTime() <= now.getTime();

/** What this message means, GIVEN what we asked. Pure — the whole point is that it can be
 *  read, argued with, and tested without a database. */
export function resolveFollowUp(
  message: string,
  state: ConversationState | null | undefined,
  now: Date = new Date()
): FollowUp {
  const pending = state?.pending_intent;
  // No pending order means no follow-up, and this is the load-bearing line: with nothing
  // pending, "publish mat karna" is just a sentence, and it must not cancel anything.
  if (!state || !pending || !state.asked_slot) return { kind: "none" };
  if (isExpired(state, now)) return { kind: "lapsed", pending };

  const q = String(message ?? "").trim();
  if (!q) return { kind: "none" };

  if (SAYS_NO.test(q)) return { kind: "cancel", pending };

  if (state.asked_slot === CONFIRM_SLOT) {
    if (SAYS_YES.test(q)) return { kind: "confirm", pending };
    // Anything else while an irreversible order is waiting: the order does NOT run. It is
    // dropped, and the new message is answered on its own merits.
    return { kind: "lapsed", pending };
  }

  // A question about an argument. "tum chuno" is an answer — it means "no value, you choose"
  // — and so is a short phrase. A long one is a new subject.
  if (HANDS_IT_BACK.test(q)) return { kind: "slot", slot: state.asked_slot, value: null, pending };
  if (q.length <= MAX_SLOT_ANSWER && !SAYS_YES.test(q)) {
    return { kind: "slot", slot: state.asked_slot, value: q, pending };
  }
  return { kind: "lapsed", pending };
}

/* ── The row ─────────────────────────────────────────────────────────────────────────── */

export type StateResult = { ok: boolean; error?: string; missingTable?: boolean };

/** Migration 017 not run. Worth telling apart, because the fix is one file and the confirm
 *  flow is the thing that stops working without it. */
function isMissingTable(message: string | null | undefined): boolean {
  const m = String(message ?? "");
  return /relation .*conversation_state.* does not exist/i.test(m) || /42P01/.test(m);
}

export const STATE_MIGRATION_HINT =
  "The conversation-state table isn't in your database yet — run supabase/migrations/017_brain_tasks.sql.";

function readPending(raw: unknown): PendingIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as any;
  if (typeof p.action !== "string" || typeof p.route !== "string") return null;
  return {
    v: 1,
    route: p.route === "task" || p.route === "slot" || p.route === "legacy" ? p.route : "slot",
    action: p.action,
    echo: typeof p.echo === "string" ? p.echo : "",
    message: typeof p.message === "string" ? p.message : "",
    task_id: typeof p.task_id === "string" ? p.task_id : null,
    intent: p.intent && typeof p.intent === "object" ? p.intent : null,
    legacy: p.legacy && typeof p.legacy === "object" ? p.legacy : null,
  };
}

export async function loadState(
  supabase: SupabaseClient,
  tenantId: string,
  conversationId: string
): Promise<ConversationState | null> {
  if (!tenantId || !conversationId) return null;
  try {
    const { data, error } = await supabase
      .from("conversation_state")
      .select("conversation_id, tenant_id, pending_intent, asked_slot, expires_at, turn_no")
      .eq("conversation_id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      conversation_id: data.conversation_id,
      tenant_id: data.tenant_id,
      pending_intent: readPending(data.pending_intent),
      asked_slot: data.asked_slot ?? null,
      expires_at: data.expires_at ?? null,
      turn_no: typeof data.turn_no === "number" ? data.turn_no : 0,
    };
  } catch (e: any) {
    // A conversation whose state cannot be read is a conversation with no pending order. The
    // chat still answers; it simply cannot resume anything, which is the safe direction.
    console.error("[chat-conversation] could not read the pending order:", e?.message);
    return null;
  }
}

/** Park an order against the next message.
 *
 *  The result matters to the caller: an irreversible task that is waiting for a yes we have no
 *  way to hear is worse than no task at all, so a failure here is reported, not swallowed. */
export async function savePending(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    conversationId: string;
    pending: PendingIntent;
    askedSlot: string;
    turnNo?: number;
    now?: Date;
  }
): Promise<StateResult> {
  const now = args.now ?? new Date();
  try {
    const { error } = await supabase.from("conversation_state").upsert(
      {
        conversation_id: args.conversationId,
        tenant_id: args.tenantId,
        pending_intent: args.pending as any,
        asked_slot: args.askedSlot,
        expires_at: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
        turn_no: (args.turnNo ?? 0) + 1,
      },
      { onConflict: "conversation_id" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message ?? "unknown error";
    console.error("[chat-conversation] could not park the order:", msg);
    return { ok: false, error: msg, missingTable: isMissingTable(msg) };
  }
}

/** Nothing is waiting any more — because it ran, was cancelled, or lapsed. */
export async function clearState(
  supabase: SupabaseClient,
  tenantId: string,
  conversationId: string
): Promise<StateResult> {
  if (!tenantId || !conversationId) return { ok: true };
  try {
    const { error } = await supabase
      .from("conversation_state")
      .update({ pending_intent: null, asked_slot: null, expires_at: null })
      .eq("conversation_id", conversationId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    console.error("[chat-conversation] could not clear the pending order:", e?.message);
    return { ok: false, error: e?.message };
  }
}
