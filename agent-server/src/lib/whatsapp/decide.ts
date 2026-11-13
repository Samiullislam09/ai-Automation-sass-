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
import { brandName } from "./brand.js";

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
  // `handoff` is the model saying "a person should take this" (it could not answer from the facts it
  // was given). Honoured on top of the old rules, so a missing field changes nothing.
  const needs_human = confidence < 0.5 || intent === "objection" || o.handoff === true;
  return { intent, confidence, action, reply, reason, needs_human };
}

type ThreadMsg = { direction: "in" | "out"; body: string };

/** The newest `limit` messages of a thread, returned oldest-first. The old query was
 *  `order(created_at asc).limit(30)` — the OLDEST 30 — so once a chat passed 30 messages the model
 *  never saw the customer's latest message or its own recent replies, answered a stale point and
 *  repeated itself (client chat, 2026-11-13: "Sorry for the delay…" four times). */
export async function loadRecentThread(supabase: SupabaseClient, tenantId: string, leadId: string, limit = 30): Promise<ThreadMsg[]> {
  const { data } = await supabase
    .from("outreach_messages")
    .select("direction, body, created_at")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as ThreadMsg[]).slice().reverse();
}

const wordSet = (t: string) => new Set(normalizePhrase(t).split(" ").filter((w) => w.length > 2));

/** True when two messages say (nearly) the same thing — used to stop the bot repeating itself.
 *  Word-overlap on the words longer than two letters: cheap and language-agnostic. Two measures,
 *  because a rewording is often SHORTER than the original: Jaccard (symmetric) catches near-copies,
 *  and the overlap coefficient (shared words / the smaller message) catches "…outline now." vs
 *  "Sorry for the delay — I was preparing the ISO 9001 outline. I'll send it now." Measured on the
 *  four real replies from the 2026-11-13 client chat: Jaccard alone scored two of the three
 *  consecutive pairs 0.53 (missed at 0.6); overlap scored them 0.90 / 1.00 / 0.73, while a genuinely
 *  new answer scored 0.20. The overlap rule needs ≥4 words on the shorter side so a short "Sure,
 *  what is your email?" is not mistaken for a repeat. */
export function isNearDuplicate(a: string, b: string, threshold = 0.6): boolean {
  const A = wordSet(a), B = wordSet(b);
  if (A.size < 3 || B.size < 3) return normalizePhrase(a).trim() === normalizePhrase(b).trim();
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const overlap = inter / Math.min(A.size, B.size);
  return jaccard >= threshold || (Math.min(A.size, B.size) >= 4 && overlap >= 0.7);
}

/** Everything the model may state about the business, in one block. This used to be three lines
 *  (what we do, five offering names, tone): no name, no price, so "who are you" and "price?" had
 *  nothing to be answered from. */
export function buildBusinessBrief(profile: any, tenant: { name?: string | null; website_url?: string | null } | null): string {
  const p = profile ?? {};
  const lines: string[] = [];
  const brand = brandName(tenant as any);
  lines.push(`Business name: ${brand}`);
  if (p.owner_name) lines.push(`You write as: ${p.owner_name} from ${brand}`);
  if (p.what_they_do) lines.push(`What we do: ${p.what_they_do}`);
  if (p.audience) lines.push(`Who we help: ${p.audience}`);
  if (Array.isArray(p.offerings) && p.offerings.length) lines.push(`We offer: ${p.offerings.slice(0, 8).map((o: any) => o?.name ?? o).filter(Boolean).join(", ")}`);
  if (Array.isArray(p.usp) && p.usp.length) lines.push(`Why us: ${p.usp.slice(0, 4).join("; ")}`);
  if (p.pricing && (p.pricing.range || p.pricing.note || p.pricing.model)) {
    const model = p.pricing.model === "quote" ? "priced per quote" : p.pricing.model === "fixed" ? "fixed price" : p.pricing.model === "subscription" ? "subscription" : p.pricing.model === "free" ? "free" : "";
    lines.push(`Pricing: ${[model, p.pricing.range, p.pricing.note].filter(Boolean).join(" — ")}`);
  } else {
    lines.push("Pricing: NOT PROVIDED to you.");
  }
  if (Array.isArray(p.proof) && p.proof.length) lines.push(`Proven facts: ${p.proof.slice(0, 5).map((f: any) => f?.claim).filter(Boolean).join("; ")}`);
  if (Array.isArray(p.credentials) && p.credentials.length) lines.push(`Credentials: ${p.credentials.slice(0, 5).map((c: any) => c?.name).filter(Boolean).join(", ")}`);
  if (Array.isArray(p.objections) && p.objections.length) {
    lines.push("Known worries and our honest answers:");
    for (const o of p.objections.slice(0, 4)) if (o?.question && o?.answer) lines.push(`- ${o.question} → ${o.answer}`);
  }
  if (Array.isArray(p.never_say) && p.never_say.length) lines.push(`NEVER say: ${p.never_say.slice(0, 8).join("; ")}`);
  if (p.voice?.tone) lines.push(`Our tone: ${p.voice.tone}`);
  if (Array.isArray(p.voice?.do) && p.voice.do.length) lines.push(`Do: ${p.voice.do.join("; ")}`);
  if (Array.isArray(p.voice?.dont) && p.voice.dont.length) lines.push(`Do not: ${p.voice.dont.join("; ")}`);
  return lines.join("\n");
}

/** Read the thread + Site Brain, ask the model for a decision, return the parsed Decision. Throws
 *  only if there is no conversation yet (the caller should not auto-reply into an empty thread).
 *  `avoid` = replies we already sent that this one must not repeat or rephrase. */
export async function decideReply(
  supabase: SupabaseClient,
  tenantId: string,
  leadId: string,
  opts: { avoid?: string[] } = {},
): Promise<Decision> {
  const [{ data: lead }, thread, profile, { data: tenant }] = await Promise.all([
    supabase.from("leads").select("company, name, reason, city").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
    loadRecentThread(supabase, tenantId, leadId, 30),
    loadActiveProfile(tenantId),
    supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle(),
  ]);

  if (thread.length === 0) throw new Error("No conversation yet — nothing to decide on.");

  const business = buildBusinessBrief(profile?.profile, (tenant as any) ?? null);

  const transcript = thread
    .map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  const avoid = (opts.avoid ?? []).filter(Boolean).slice(0, 3);

  const prompt = [
    "You are the person answering on a business's WhatsApp, deciding how to handle a lead's latest message. Your job is to be genuinely useful, fast and honest — like the best salesperson at a well-run company, never a bot reading a script.",
    "",
    `ABOUT THE BUSINESS YOU REPRESENT (these are the ONLY facts you may state):
${business}`,
    lead?.company ? `THE LEAD: ${lead.company}${lead.city ? `, ${lead.city}` : ""}${lead.reason ? ` — noted because: ${lead.reason}` : ""}` : "",
    "",
    "THE CONVERSATION SO FAR (oldest first; the LAST line is what you are answering):",
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
    '- "handoff": true ONLY if a real person must take over (they want something you cannot give from the facts above — a quote, a document, a decision, a complaint). Else false.',
    '- "reason": a 3-8 word note on why (for the human), e.g. "asked about ISO 9001 price".',
    "",
    "HOW TO WRITE THE REPLY:",
    "- One short WhatsApp message, 1-3 sentences, no email formatting, no 'Dear', no signature. At most ONE question, and only if it moves the conversation forward.",
    "- ANSWER THEIR QUESTION FIRST, in the first sentence. Only then, if useful, add one line of value or a next step. Never dodge, never restate the pitch if they moved past it.",
    "- Write in THEIR language and script: English → English; Hindi/Hinglish typed in Roman letters → Hinglish in Roman letters; Hindi/Urdu script → the same script. Keep it simple and warm, the way a real person types.",
    "- 'yes'/'ok' as an answer to OUR question → act on that question, don't send a generic blurb.",
    "",
    "WHAT YOU CAN AND CANNOT DO (critical):",
    "- You can ONLY send text messages in this chat. You CANNOT send files, PDFs, outlines, brochures, quotes, images or links you were not given, and you cannot call.",
    "- NEVER promise something you cannot deliver in this very message. Never write 'I'll send it now / shortly / right away / in a moment'. If they ask for details or an outline, GIVE the useful content right now in 2-4 short lines (scope, timeline, what is included), then offer a call or say a team member will share the full document — and set handoff true.",
    "- If asked the price: if Pricing is provided above, state it plainly first (range/model), then one line of what it depends on. If Pricing is NOT PROVIDED, say honestly that it depends on their situation, ask the ONE detail you need (e.g. company size / which standard), and set handoff true so a person sends the exact quote. Do not say 'let me confirm' without also giving them something useful.",
    "- Never invent a price, date, guarantee, client name or number that is not in the facts above. If you do not know, say so simply and say a team member will confirm — and set handoff true.",
    "",
    "WHO YOU ARE:",
    "- If asked 'who are you' / 'kaun ho': one line — your name (if given) and the business name, what we do and how it helps THEM, then ONE question about their need. Do not repeat the business pitch word for word.",
    "- If they sincerely ask whether you are a bot/AI/human, answer honestly: you are the team's AI assistant and a team member can join any time. Never claim to be a human.",
    "",
    "TONE AND HONESTY:",
    "- NEVER repeat or rephrase anything US already said in the conversation. Every reply must move the conversation FORWARD with new information or a concrete next step.",
    "- Do NOT apologise for delays unless their LAST message complains about waiting; then apologise in ≤5 words once and answer immediately in the same message.",
    "- If their message is a placeholder like [Voice message] / [Photo] / [Document], you cannot open it: say so in one friendly line and ask them to type it, or offer a quick call.",
    "- If they sound annoyed, frustrated or say stop: be human — one short sincere line, solve the actual problem, set handoff true. If they said stop, write a one-line polite backoff.",
    "- Be confident and warm, never pushy. Sell by being helpful: one clear next step (a question, a call, or the detail they asked for).",
    avoid.length ? `
YOU ALREADY SENT THESE — your new reply must NOT repeat or paraphrase them; give something genuinely new or hand off:
${avoid.map((a) => `- ${a.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}` : "",
    "",
    'Reply with ONLY JSON: {"intent":"...","confidence":0.0,"action":"...","reply":"...","handoff":false,"reason":"..."}',
  ].filter((x) => x !== undefined).join("\n");

  const answer = await completeJson<Record<string, unknown>>(prompt);
  return parseDecision(answer);
}
