/** §28.3 Phase 2 — the decision engine. ONE model call that reads the conversation and returns a
 *  structured decision, not just a draft:
 *
 *      MESSAGE → CONTEXT → INTENT → CONFIDENCE → ACTION → RESPONSE
 *
 *  This is what stops Mr Lxwa replying to every message blindly. A bare "ok" or "hmm" gets
 *  action="ignore" (nothing sent); a half-typed line gets "wait"; a real question gets "reply"
 *  with a short, context-aware answer. The old suggestReply (manual "Suggest" button) still exists
 *  and still just drafts — this is the autonomous path.
 *
 *  Owner rule: even when the model is unsure or the message is complex (pricing/legal/annoyed), it
 *  STILL replies (no human-handoff hold) — but we mark needs_human so the human sees it. Opt-out is
 *  NOT trusted to the model: a deterministic keyword check (detectOptOut) owns that, because "stop"
 *  must always stop. */
import { completeJson } from "../llm.js";
import { loadActiveProfile } from "../siteProfile.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Intent =
  | "greeting" | "question" | "affirmation" | "objection"
  | "smalltalk" | "ready" | "meeting" | "stop" | "other";
export type Action = "reply" | "wait" | "ignore";

export type Decision = {
  intent: Intent;
  confidence: number; // 0..1
  action: Action;
  reply: string; // the message to send when action === "reply" (may be "" for ignore/wait)
  reason: string; // short why — shown on the needs-you flag and in logs
  needs_human: boolean; // complex/low-confidence → flag for the human (we still reply)
};

const INTENTS: Intent[] = ["greeting", "question", "affirmation", "objection", "smalltalk", "ready", "meeting", "stop", "other"];
const ACTIONS: Action[] = ["reply", "wait", "ignore"];

/** Lower-case, drop apostrophes (so "let's"→"lets", "i'll"→"ill"), turn other punctuation into
 *  spaces, and pad with spaces so a phrase can be matched on whole-word boundaries. */
function normalizePhrase(text: string): string {
  return ` ${String(text).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").replace(/\s+/g, " ")} `;
}

/** Deterministic opt-out: if the latest inbound is a stop request, we stop — never the model's call.
 *  Matches the common English + Hindi/Hinglish phrasings as whole words/phrases, case-insensitive. */
export function detectOptOut(text: string): boolean {
  const t = normalizePhrase(text);
  const phrases = [
    "stop", "unsubscribe", "opt out", "optout", "remove me", "do not contact", "dont contact", "leave me alone",
    "band karo", "band kar", "mat bhejo", "mat bhej", "message mat", "msg mat", "pareshan mat", "rok do", "ruk jao",
  ];
  return phrases.some((p) => t.includes(` ${p} `));
}

/** An EXPLICIT, high-confidence buying signal — the only thing that auto-converts a lead to a paying
 *  client (§29.8, owner: fully automatic, but only on an unmistakable signal, never a lukewarm
 *  "sounds good"). Deterministic like detectOptOut so the model can't trigger a conversion on a
 *  guess; a human can always move the stage back in one tap. */
export function detectBuyIntent(text: string): boolean {
  const t = normalizePhrase(text);
  const phrases = [
    "send the invoice", "send invoice", "send me the invoice", "share the invoice",
    "where do i pay", "how do i pay", "ready to pay", "i will pay", "ill pay", "make the payment",
    "lets start", "lets begin", "lets do it", "sign me up", "sign up now",
    "i want to buy", "ill take it", "ill go ahead", "go ahead with it", "close the deal", "we have a deal",
    "proceed with the order", "place the order", "confirm the order", "book it",
    "invoice bhejo", "invoice bhej", "payment kaise", "kaise pay", "start karte hain", "start kardo", "order kardo", "le lete hain", "final kardo",
  ];
  return phrases.some((p) => t.includes(` ${p} `) || t.includes(p));
}

/** Turn the model's raw JSON into a safe Decision — every field validated/clamped, so a malformed
 *  or partial answer can never send garbage or crash the worker. Pure, so it is unit-tested. */
export function parseDecision(raw: unknown): Decision {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = INTENTS.includes(o.intent as Intent) ? (o.intent as Intent) : "other";
  let action = ACTIONS.includes(o.action as Action) ? (o.action as Action) : "reply";
  let confidence = Number(o.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  const reply = String(o.reply ?? "").trim().slice(0, 900);
  const reason = String(o.reason ?? "").trim().slice(0, 300);
  // A "reply" action with no text is useless — downgrade it to ignore rather than send an empty
  // message. (The model occasionally says reply but leaves reply blank.)
  if (action === "reply" && !reply) action = "ignore";
  // Complex or unsure → flag for the human, but we still reply (owner's choice).
  const needs_human = confidence < 0.5 || intent === "objection";
  return { intent, confidence, action, reply, reason, needs_human };
}

type ThreadMsg = { direction: "in" | "out"; body: string };

/** Read the thread + Site Brain, ask the model for a decision, return the parsed Decision. Throws
 *  only if there is no conversation yet (the caller should not auto-reply into an empty thread). */
export async function decideReply(
  supabase: SupabaseClient,
  tenantId: string,
  leadId: string,
): Promise<Decision> {
  const [{ data: lead }, { data: msgs }, profile] = await Promise.all([
    supabase.from("leads").select("company, name, reason, city").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("direction, body, created_at")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(30),
    loadActiveProfile(tenantId),
  ]);

  const thread = (msgs ?? []) as ThreadMsg[];
  if (thread.length === 0) throw new Error("No conversation yet — nothing to decide on.");

  const p = profile?.profile;
  const business = [
    p?.what_they_do ? `What we do: ${p.what_they_do}` : "",
    Array.isArray(p?.offerings) && p.offerings.length ? `We offer: ${p.offerings.slice(0, 5).map((o: any) => o?.name ?? o).filter(Boolean).join(", ")}` : "",
    p?.voice?.tone ? `Our tone: ${p.voice.tone}` : "",
  ].filter(Boolean).join("\n");

  const transcript = thread
    .map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  const prompt = [
    "You are the assistant on a business's WhatsApp, deciding how to handle a lead's latest message.",
    "",
    business ? `ABOUT THE BUSINESS YOU REPRESENT:\n${business}` : "",
    lead?.company ? `THE LEAD: ${lead.company}${lead.city ? `, ${lead.city}` : ""}${lead.reason ? ` — noted because: ${lead.reason}` : ""}` : "",
    "",
    "THE CONVERSATION SO FAR (oldest first):",
    transcript,
    "",
    "Decide about THEIR most recent message. Return JSON with these fields:",
    '- "intent": one of greeting, question, affirmation, objection, smalltalk, ready, meeting, stop, other.',
    '- "confidence": 0..1, how sure you are about intent AND that a reply is appropriate.',
    '- "action": one of:',
    '    "ignore"  — a bare acknowledgement that needs no reply ("ok", "thanks", "hmm", "👍"). Do NOT reply to these.',
    '    "wait"    — the message looks half-typed/incomplete; they are probably still writing.',
    '    "reply"   — answer them now.',
    '- "reply": if action is "reply", the ACTUAL next WhatsApp message from US. Else "".',
    '- "reason": a 3-8 word note on why (for the human), e.g. "asked about ISO 9001 price".',
    "",
    "Rules for the reply text:",
    "- One short WhatsApp message, 1-3 sentences, no email formatting, no 'Dear', no signature.",
    "- Answer what they actually said; do NOT restate the pitch if they moved past it.",
    "- 'yes'/'ok' as an answer to OUR question → act on that question, don't send a generic blurb.",
    "- Match their language (English, Hindi/Hinglish, etc.).",
    "- Never promise a price/discount/delivery you were not given — offer to confirm instead.",
    "- If they sound annoyed or say stop, write a one-line polite backoff.",
    "",
    'Reply with ONLY JSON: {"intent":"...","confidence":0.0,"action":"...","reply":"...","reason":"..."}',
  ].filter(Boolean).join("\n");

  const answer = await completeJson<Record<string, unknown>>(prompt);
  return parseDecision(answer);
}
