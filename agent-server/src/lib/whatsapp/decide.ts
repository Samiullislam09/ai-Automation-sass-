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
import {
  detectLanguage, detectSignals, conversationStage, mustHandOff, signalsBrief,
  LANG_INSTRUCTION, STAGE_GUIDE, riskyClaim, unverifiedTerms, assertsUnverified, confirmLine, offersCall, stripCallOffer, missingDetails, CONFIRM_LANG, containsPriceAmount, statesPriceUnavailable, PRICE_UNKNOWN_LINE, proposesTime, parseMeetingPreference, MEETING_ACK, MEETING_REASK, isMeetingAsk, tooLongForChat, MAX_CHAT_CHARS, stripTimeProposals, claimsExperience, MEETING_FALLBACK, SMALLTALK_DEFLECT, type Lang, type Msg,
} from "./conversation.js";
import { retrieveKnowledge, queryFor, renderKnowledge, type Passage } from "./knowledge.js";
import { unsupportedAmounts } from "../pricing.js";

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
  /** A sentence the code fixed or replaced, in plain words — shown in the Activity log so a manager can see WHY a
   *  reply says what it says ("call offer removed: already offered", "price replaced: none published"). */
  notes?: string[];
  /** The reply is a fixed, code-written line (a meeting acknowledgement, "cannot share the price"), not the model's. */
  templated?: boolean;
  /** When they said they would like the call (MeetingPref.label): the owner is alerted with it. */
  meeting_pref?: string;
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

type ThreadMsg = Msg;

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
  if (p.pricing && p.pricing.range) {
    const model = p.pricing.model === "quote" ? "priced per quote" : p.pricing.model === "fixed" ? "fixed price" : p.pricing.model === "subscription" ? "subscription" : p.pricing.model === "free" ? "free" : "";
    lines.push(`Pricing: ${[model, p.pricing.range, p.pricing.note].filter(Boolean).join(" — ")}`);
    const pk = (p.pricing.packages ?? []).filter((x: any) => x?.name && x?.from);
    if (pk.length) {
      lines.push("Packages (quote the ONE that fits the customer, with its own price — never the whole range):");
      for (const x of pk) lines.push(`- ${[x.name, x.from, x.best_for ? `for ${x.best_for}` : "", x.duration, x.covers].filter(Boolean).join(" — ")}`);
    }
  } else if (p.pricing && (p.pricing.note || p.pricing.model)) {
    // The site says HOW it charges ("on request") but prints no figure. That is not a price: say so, or the
    // model reads "priced per quote" as licence to estimate one.
    const how = p.pricing.model === "quote" ? "priced per quote" : p.pricing.model === "subscription" ? "a subscription" : p.pricing.model === "free" ? "free" : "";
    lines.push(`Pricing: ${[how, p.pricing.note].filter(Boolean).join(" — ")}. NO FIGURE IS PUBLISHED — you cannot state any price, range or estimate.`);
  } else {
    lines.push("Pricing: NOT PROVIDED to you.");
  }
  // How a customer reaches and checks the business. Read from the website and kept in the Site Brain (or typed
  // by the owner); stated exactly as written. What is not listed here is NOT known — and when asked for it the
  // assistant says a team member will share it (missingDetails in conversation.ts), it never makes one up.
  const bd = p.business_details;
  if (bd) {
    const c = [
      bd.address ? `Address: ${bd.address}` : "",
      bd.phone ? `Phone: ${bd.phone}` : "",
      bd.whatsapp ? `WhatsApp: ${bd.whatsapp}` : "",
      bd.email ? `Email: ${bd.email}` : "",
      bd.hours ? `Working hours: ${bd.hours}` : "",
      bd.registration ? `Licence / registration: ${bd.registration}` : "",
    ].filter(Boolean);
    if (c.length) lines.push(`Contact details (you may give these exactly as written):\n${c.map((x) => `- ${x}`).join("\n")}`);
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

/** One request to the model for a reply. Kept well under the 90 s a background job is allowed. */
export const REPLY_TIMEOUT_MS = 12_000;
/** The exact call settings for a customer reply — shared with golden.live.ts so the live eval runs
 *  what production runs (a 700-token cap that truncated replies would otherwise only show up live). */
export const REPLY_LLM = { lane: "wa" as const, timeoutMs: REPLY_TIMEOUT_MS, retries: 1, maxTokens: 700 };

/** The model occasionally returns nothing or garbage instead of the JSON it was asked for — measured
 *  live on 2026-11-13: two of twelve scenarios in one run ("did not return valid JSON: вар", and an
 *  empty body), none in sixteen calls straight after. It is intermittent, not a prompt problem, and
 *  one more attempt almost always succeeds. Without this, each such blip became a holding message and
 *  an owner alert for a question the assistant could easily have answered. Only THIS kind of failure
 *  is retried here (timeouts and rate limits are already retried inside nvidiaFetch); a second bad
 *  answer falls through to the holding reply. */
export async function completeReplyJson(user: string, system: string, call: typeof completeJson = completeJson): Promise<Record<string, unknown>> {
  try {
    return await call<Record<string, unknown>>(user, { system, ...REPLY_LLM });
  } catch (e: any) {
    if (!/valid JSON|unexpected response shape/i.test(String(e?.message))) throw e;
    console.warn(`[whatsapp] reply model returned a bad answer (${String(e.message).slice(0, 80)}) — one more try`);
    return await call<Record<string, unknown>>(user, { system, ...REPLY_LLM });
  }
}

/** The instructions that never change between conversations. Travels as the `system` message. */
export const REPLY_SYSTEM = [
  "You are the person answering on a business's WhatsApp, deciding how to handle a lead's latest message. Be genuinely useful, fast and honest — like the best salesperson at a well-run company, never a bot reading a script.",
  "",
  "Return ONLY JSON: " + '{"intent":"...","confidence":0.0,"action":"...","reply":"...","handoff":false,"reason":"..."}',
  '- "intent": one of greeting, question, affirmation, objection, smalltalk, ready, meeting, stop, other. Use "meeting" when they ASK FOR or ACCEPT a call/meeting/demo, or answer OUR question about when (the system then sends real slots, or notes their preferred time for the team — you never write times yourself).',
  '- "confidence": 0..1, how sure you are about intent AND that a reply is appropriate.',
  '- "action": "ignore" (a bare acknowledgement that needs no reply: "ok", "thanks", "hmm", "👍"), "wait" (the message looks half-typed; they are still writing) or "reply" (answer now).',
  '- "reply": if action is "reply", the ACTUAL next WhatsApp message from US. Else "".',
  '- "handoff": true ONLY if a real person must take over (they want something you cannot give from the facts — a quote, a document, a decision, a complaint). Else false.',
  '- "reason": a 3-8 word note on why (for the human), e.g. "asked about ISO 9001 price".',
  "",
  "HOW TO WRITE THE REPLY — like a real person texting on WhatsApp, not a company brochure:",
  "- 1 or 2 SHORT sentences, about 25 words in all, never more than 40. One idea per message. If there is more to say, say the ONE most useful thing and ask a question; the rest can come in the next message.",
  "- No lists, no bullet points, no headings, no semicolons, no 'Based on that', no 'I understand your concern', no 'Great question'. Plain everyday words and contractions — how you would text a client you respect.",
  "- Do NOT repeat back what they just told you ('3 employees at one site in West Bengal') — they know. Use it silently.",
  "- ANSWER THEIR QUESTION FIRST, in the first sentence. Then, if useful, one short line that moves things on. Never dodge, never restate the pitch if they moved past it.",
  "- Use the REPLY LANGUAGE given with the conversation, and stay in it for the whole reply.",
  "- 'yes'/'ok' as an answer to OUR question → act on that question, don't send a generic blurb.",
  "",
  "SELLING — you are this business's best salesperson, and every message should earn the next step:",
  "- The goal of the conversation is a short CALL (best) or an exact quote. Know where they are: just curious → find out what they need; clear need → show the ONE option that fits and its price; hesitating → handle the worry, then offer the next step again; ready → move now.",
  "- ONE next step per message: either one question that moves them forward OR the offer of a call. Never both, never neither. Qualify lightly and one thing at a time — what they need, how big (people / sites), by when — and never ask something they have already told you.",
  "- Price: lead with the specific PACKAGE that fits what they told you, by name, with its 'from' price and what it covers in a few words. Do NOT quote the whole range at a small buyer and never say 'at the lower end of our range'. Mention other packages only if they ask.",
  "- 'Can you reduce the price / any discount?': you have no authority to discount and must never hint that you do. Be warm, point to what they get or to a smaller option that fits their budget (ask their budget), and offer a call where a manager can discuss options — that is the one place to negotiate.",
  "- 'Another company is cheaper': never criticise them; ask what their quote includes, and restate only the differences that are in the facts.",
  "- Hesitation ('I'll think'): see WHEN THEY NEED TIME below. A buying signal ('ok let's do it', 'how do I start'): take the next step at once — offer the call or the exact next action.",
  "",
  "THE BUSINESS'S OWN WEBSITE:",
  "- When a FACTS FROM OUR WEBSITE block is given, those are real passages from the business's own pages and are as trustworthy as the business facts. Use them for specifics — what the service includes, how the process works, how long it takes, what is required — and say it in your own short words, never paste a paragraph.",
  "- If the customer asks something that neither the business facts nor the website facts answer, do NOT guess and do NOT fill the gap with general knowledge about the topic. Say plainly that a team member will confirm, and set handoff true. A confident wrong answer loses the customer; an honest 'I'll have the team confirm' keeps them.",
  "- Mention a page address only if it genuinely helps them (one at most), and only an address that appears in the facts.",
  "- A thing being ABSENT from the facts does not mean we do not do it, and its being present elsewhere does not mean we do. Never say 'we do offer X' or 'we don't offer X' (or where we operate, how many clients or years we have) unless the facts say it in so many words. For anything else say a team member will confirm, and set handoff true.",
  "",
  "WHAT YOU CAN AND CANNOT DO (critical):",
  "- You can ONLY send text messages in this chat. You CANNOT send files, PDFs, outlines, brochures, quotes, images or links you were not given, and you cannot call.",
  "- NEVER promise something you cannot deliver in this very message. Never write 'I'll send it now / shortly / right away / in a moment'. If they ask for details or an outline, GIVE the useful content right now in 2-4 short lines (scope, timeline, what is included), then offer a call or say a team member will share the full document — and set handoff true.",
  "- Price: if a price or range is given in the facts, state it plainly first, then one line of what it depends on. If NO figure is given (Pricing NOT PROVIDED, or 'NO FIGURE IS PUBLISHED'), say clearly in the first sentence that you cannot share the price right now, give NO number, range, 'starting from' or estimate, say a team member will send an exact quote, ask ONE question about what they need, and set handoff true.",
  "- Never invent a price, date, guarantee, client name or number that is not in the facts. If you do not know, say so simply and say a team member will confirm — and set handoff true.",
  "",
  "CALLS AND MEETINGS:",
  "- You cannot see anyone's calendar. NEVER propose, promise or confirm a specific day or time yourself (no 'tomorrow 10 AM', no 'tonight', no 'this week'). A time you invent may be one nobody can keep.",
  "- To move toward a call, offer it ONCE, and only when they have shown real interest (given their need or size, asked the price, raised an objection you have answered): e.g. 'Would a short call help? I can send you a few time slots.' When they say yes or ask for a call, set intent to \"meeting\".",
  "- Do not bring a call up in every message. If you already offered one and they did not take it, do not repeat it unless they raise it. Do not end every message with the same kind of question either — answer, and ask something only when it genuinely moves things on.",
  "",
  "WHO YOU ARE:",
  "- If asked 'who are you' / 'kaun ho': one line — your name (if given) and the business name, what we do and how it helps THEM, then ONE question about their need. Do not repeat the business pitch word for word.",
  "- If they sincerely ask whether you are a bot/AI/human, answer honestly and plainly: you are the AI assistant of the business (say its name), and a team member can join any time. Do NOT give the owner's name as your own name in that answer, and never claim to be a human.",
  "- You are an assistant, not a person with a life: never claim to have watched, visited, eaten, travelled or experienced anything. For small talk (cricket, weather, how are you) answer in a few warm words without inventing an experience, then come back to their need naturally.",
  "",
  "WHEN THEY NEED TIME:",
  "- If they say they will think about it, need time, or have no budget right now: respect it in one warm line and leave the door open ('message me whenever you are ready'). Do NOT repeat the price, do NOT push a call, and do NOT promise anything you will do later ('I'll send you slots', 'I'll follow up tomorrow') — you cannot schedule that.",
  "",
  "TONE AND HONESTY:",
  "- NEVER repeat or rephrase anything US already said in the conversation. Every reply must move the conversation FORWARD with new information or a concrete next step.",
  "- Do NOT apologise for delays unless their LAST message complains about waiting; then apologise in ≤5 words once and answer immediately in the same message.",
  "- If their message is a placeholder like [Voice message] / [Photo] / [Document], you cannot open it: say so in one friendly line and ask them to type it, or offer a quick call.",
  "- If they sound annoyed or say stop: be human — one short sincere line, solve the actual problem, set handoff true. If they said stop, write a one-line polite backoff.",
  "- Be confident and warm, never pushy. Sell by being helpful: one clear next step (a question, a call, or the detail they asked for).",
].join("\n");

export type ReplyPromptInput = {
  business: string;
  pricingProvided: boolean;
  lead: { company?: string | null; city?: string | null; reason?: string | null } | null;
  thread: Msg[];
  avoid?: string[];
  /** Passages from the business's own site that bear on the customer's question (knowledge.ts). */
  knowledge?: Passage[];
};

/** Assemble the call. Pure — the whole point of splitting it from decideReply is that the golden
 *  conversations (golden.test.ts) can assert on exactly what the model would be told, with no
 *  database and no network. */
export function buildReplyPrompt(input: ReplyPromptInput): { system: string; user: string; lang: ReturnType<typeof detectLanguage>; handoffFloor: { yes: boolean; reason: string }; unverified: string[]; detailGaps: string[]; recentOut: string[]; callWanted: boolean; priceUnknown: boolean; lastInbound: string; factsText: string } {
  const { thread, business, lead } = input;
  const lastIn = [...thread].reverse().find((m) => m.direction === "in");
  const signals = detectSignals(lastIn?.body ?? "");
  const lang = detectLanguage(thread);
  const stage = conversationStage(thread);
  // What we may state: the brief, the website passages and OUR OWN earlier lines. The customer's own
  // words are not facts about us.
  const factsText = [input.business, ...(input.knowledge ?? []).map((p) => p.text), ...thread.filter((m) => m.direction === "out").map((m) => m.body)].join("\n");
  const unverified = lastIn ? unverifiedTerms(lastIn.body, factsText, [lead?.company ?? "", lead?.city ?? ""]) : [];
  const detailGaps = lastIn ? missingDetails(lastIn.body, factsText) : [];
  const facts = signalsBrief(signals, input.pricingProvided, lang, unverified, detailGaps);
  const avoid = (input.avoid ?? []).filter(Boolean).slice(0, 3);

  const transcript = thread
    .map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  const user = [
    `ABOUT THE BUSINESS YOU REPRESENT (together with any website facts given below, these are the ONLY facts you may state):\n${business}`,
    lead?.company ? `THE CUSTOMER YOU ARE TALKING TO (not us — their company and their city, NOT ours): ${lead.company}${lead.city ? `, ${lead.city}` : ""}${lead.reason ? ` — noted because: ${lead.reason}` : ""}` : "",
    "",
    input.knowledge && input.knowledge.length
      ? `FACTS FROM OUR WEBSITE (passages from the business's own pages that bear on their question):\n${renderKnowledge(input.knowledge)}`
      : "",
    `REPLY LANGUAGE: ${LANG_INSTRUCTION[lang]}`,
    `WHERE THE CONVERSATION IS: ${STAGE_GUIDE[stage]}`,
    facts.length ? `READ FROM THEIR LAST MESSAGE (treat as fact):\n${facts.map((f) => `- ${f}`).join("\n")}` : "",
    "",
    "THE CONVERSATION SO FAR (oldest first; the LAST line is what you are answering):",
    transcript,
    avoid.length ? `\nYOU ALREADY SENT THESE — your new reply must NOT repeat or paraphrase them; give something genuinely new or hand off:\n${avoid.map((a) => `- ${a.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}` : "",
    "",
    "Decide about THEIR most recent message and answer with the JSON.",
  ].join("\n");

  return { system: REPLY_SYSTEM, user, lang, handoffFloor: mustHandOff(signals, input.pricingProvided, unverified, detailGaps), unverified, detailGaps, recentOut: thread.filter((m) => m.direction === "out").slice(-2).map((m) => String(m.body)), callWanted: signals.wantsCall, priceUnknown: signals.price && !input.pricingProvided, lastInbound: String(lastIn?.body ?? ""), factsText };
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
  // The thread is read first and the website lookup starts the moment its last question is known, so
  // the ~0.4 s embedding overlaps the profile and tenant reads instead of following them.
  const threadP = loadRecentThread(supabase, tenantId, leadId, 30);
  const [{ data: lead }, thread, profile, { data: tenant }, knowledge] = await Promise.all([
    supabase.from("leads").select("company, name, reason, city").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
    threadP,
    loadActiveProfile(tenantId),
    supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle(),
    threadP.then((t) => retrieveKnowledge(supabase, tenantId, queryFor(t))),
  ]);

  if (thread.length === 0) throw new Error("No conversation yet — nothing to decide on.");

  const p: any = profile?.profile;
  // "Provided" means a concrete figure exists. A site that only says "price on request" gives the assistant
  // nothing to quote: it must say it cannot share the price, not estimate one.
  const pricingProvided = !!p?.pricing?.range;
  const business = buildBusinessBrief(p, (tenant as any) ?? null);

  return decideFromPrompt(buildReplyPrompt({ business, pricingProvided, lead: lead as any, thread, avoid: opts.avoid, knowledge }));
}

/** Everything after the prompt is built, exactly as production runs it — shared with golden.live.ts so
 *  the live eval exercises the same nets (finalizeDecision) and not just the raw model.
 *
 *  The reply lane: its own rate-limit window, a 12 s request timeout with one retry, and a small output
 *  cap. A customer is waiting — better to fail fast into a holding message and a human than to sit 90 s
 *  per attempt behind a busy pool (autoReply.ts handles the failure). */
export async function decideFromPrompt(built: ReturnType<typeof buildReplyPrompt>): Promise<Decision> {
  const { system, user } = built;
  const answer = await completeReplyJson(user, system);
  return finalizeDecision(parseDecision(answer), {
    handoffFloor: built.handoffFloor, unverified: built.unverified, detailGaps: built.detailGaps, lang: built.lang, recentOut: built.recentOut, callWanted: built.callWanted, priceUnknown: built.priceUnknown, lastInbound: built.lastInbound, factsText: built.factsText,
    rewrite: async (instruction) => parseDecision(await completeReplyJson(`${user}

${instruction}`, system)),
  });
}

/** What happens to the model's decision before anything is sent. Three nets, in order, each one there
 *  because the model was seen to get past the prompt (live eval, 2026-11-14):
 *   1. UNVERIFIED SPECIFICS — the customer asked about something that is nowhere in our facts and the
 *      reply asserted something about it anyway ("we don't do 27001", "we work in Saudi Arabia").
 *      One rewrite with the violation named; if that still asserts, the safe "a team member will
 *      confirm" line is sent instead. The model never gets to answer a question it has no facts for.
 *   2. RISKY CLAIMS — a "we don't offer X" with no source: a person is told to look.
 *   3. THE ESCALATION FLOOR — situations that always need a person, whatever the model felt.
 *  Pure apart from `rewrite`, so every branch is a unit test with a fake one. */
export async function finalizeDecision(
  first: Decision,
  ctx: { handoffFloor: { yes: boolean; reason: string }; unverified: string[]; detailGaps?: string[]; lang: Lang; rewrite: (instruction: string) => Promise<Decision>; recentOut?: string[]; callWanted?: boolean; priceUnknown?: boolean; lastInbound?: string; factsText?: string },
): Promise<Decision> {
  let d = first;
  const note = (s: string) => { d = { ...d, notes: [...(d.notes ?? []), s] }; };

  // 0. TOO LONG FOR A CHAT. First, so every net below checks the text that will actually be sent. One rewrite asking for the
  //    short version; if the model still writes an essay, autoReply sends it as two or three short messages instead.
  if (d.action === "reply" && tooLongForChat(d.reply)) {
    try {
      const shorter = await ctx.rewrite(`YOUR DRAFT IS TOO LONG FOR WHATSAPP (${d.reply.length} characters): "${d.reply.slice(0, 320)}". Rewrite it as a person would text it: 1 or 2 SHORT sentences, at most 35 words, same language, keep only the most useful point and one next step. Keep the same intent and handoff.`);
      if (shorter.action === "reply" && shorter.reply && !tooLongForChat(shorter.reply) && shorter.reply.length < d.reply.length) {
        d = { ...d, reply: shorter.reply };
        note("shortened: it read like an email");
      }
    } catch { /* it will be split into short messages instead */ }
  }

  if (ctx.unverified.length && d.action === "reply" && assertsUnverified(d.reply, ctx.unverified)) {
    const what = ctx.unverified.join(", ");
    let better: Decision | null = null;
    try {
      better = await ctx.rewrite(
        `YOUR PREVIOUS DRAFT STATED THINGS ABOUT ${what} THAT ARE NOT IN THE FACTS: "${d.reply.slice(0, 200)}". Rewrite it: acknowledge their question, say plainly that a team member will confirm ${what}, do not say whether we do or do not handle it and do not mention any place or standard we have not been told about, and ask ONE useful question. Set handoff true.`,
      );
    } catch { /* fall through to the safe line */ }
    d = better && better.action === "reply" && better.reply && !assertsUnverified(better.reply, ctx.unverified)
      ? better
      : { ...d, action: "reply", reply: confirmLine(ctx.lang, ctx.unverified) };
    d = { ...d, needs_human: true, reason: d.reason || `asked about ${what} — not in our facts` };
    note(`${what}: not in our facts — a team member will confirm`);
  }

  // 1b. DETAILS ABOUT THE BUSINESS ITSELF that we do not hold (address, phone, hours, licence number):
  //     unless the reply already defers to a person, it is rewritten once, else replaced by the safe line.
  if ((ctx.detailGaps ?? []).length && d.action === "reply" && !CONFIRM_LANG.test(d.reply)) {
    const what = (ctx.detailGaps ?? []).join(" and ");
    let better: Decision | null = null;
    try {
      better = await ctx.rewrite(`YOUR PREVIOUS DRAFT GAVE DETAILS ABOUT ${what} THAT ARE NOT IN THE FACTS: "${d.reply.slice(0, 200)}". Rewrite it: say plainly that a team member will share ${what}, invent nothing, and ask ONE useful question. Set handoff true.`);
    } catch { /* fall through */ }
    d = better && better.action === "reply" && better.reply && CONFIRM_LANG.test(better.reply)
      ? better
      : { ...d, action: "reply", reply: confirmLine(ctx.lang, ctx.detailGaps ?? []) };
    d = { ...d, needs_human: true, reason: d.reason || `asked for ${what} — not in our facts` };
    note(`${what}: not held — a team member will share it`);
  }

  // 1a. NO PUBLISHED PRICE. A customer asked, the business has printed none, and the reply either contains an
  //     amount (invented) or never says plainly that the price cannot be shared. Rewritten once with the rule
  //     spelled out; if that still fails, the standard line is sent — never a number.
  if (ctx.priceUnknown && d.action === "reply" && (containsPriceAmount(d.reply) || !statesPriceUnavailable(d.reply))) {
    let better: Decision | null = null;
    try {
      better = await ctx.rewrite(`YOUR PREVIOUS DRAFT DID NOT FOLLOW THE PRICE RULE: "${d.reply.slice(0, 200)}". The business has published no price. Rewrite it: in the FIRST sentence say clearly that you cannot share the price right now, give no number, range or estimate, say a team member will send an exact quote, and ask ONE question about what they need. Set handoff true.`);
    } catch { /* fall through to the standard line */ }
    d = better && better.action === "reply" && better.reply && !containsPriceAmount(better.reply) && statesPriceUnavailable(better.reply)
      ? better
      : { ...d, action: "reply", reply: PRICE_UNKNOWN_LINE[ctx.lang] };
    d = { ...d, needs_human: true, reason: d.reason || "asked for the price — none is published", templated: d.reply === PRICE_UNKNOWN_LINE[ctx.lang] ? true : d.templated };
    note("price: none published — said so instead of quoting");
  }

  // 1a-2. AN AMOUNT WE WERE NOT GIVEN. When a price IS published, every amount in the reply must be one of the published
  //     ones (or one the customer themselves wrote). A model asked to be persuasive will round, blend or invent: "about
  //     $5,000 for you" when the page says "from $2,400". The offending sentence is rewritten once, then removed.
  if (!ctx.priceUnknown && d.action === "reply" && containsPriceAmount(d.reply)) {
    const known = `${ctx.factsText ?? ""}\n${ctx.lastInbound ?? ""}`;
    const bad = unsupportedAmounts(d.reply, known);
    if (bad.length) {
      let better: Decision | null = null;
      try {
        better = await ctx.rewrite(`YOUR DRAFT QUOTED ${bad.join(", ")}, WHICH IS NOT A PRICE IN THE FACTS: "${d.reply.slice(0, 220)}". Rewrite it using ONLY prices that appear in the facts above (copy them exactly, with the package they belong to), or no price at all. Keep it to 1-2 short sentences.`);
      } catch { /* fall through */ }
      if (better && better.action === "reply" && better.reply && unsupportedAmounts(better.reply, known).length === 0) d = { ...d, reply: better.reply };
      else {
        const kept = d.reply.split(/(?<=[.!?])\s+/).filter((s) => unsupportedAmounts(s, known).length === 0).join(" ").trim();
        d = { ...d, reply: kept || "A team member will send you the exact figure for your case.", needs_human: true, reason: d.reason || "quoted a price that is not in the facts" };
      }
      note(`price corrected: ${bad.join(", ")} is not a published figure`);
    }
  }

  // 1c. CALLS. When they ask for or accept a call the system sends REAL slots (autoReply.ts); whatever the
  //     model wrote around that is never the message that goes out, so for intent "meeting" it is the
  //     honest fallback — a person will fix a time — and nothing the model invented ("10 AM - 4 PM, Mon-Fri",
  //     "I'll send you slots" when none are coming). Any OTHER reply that proposes a time for a call has
  //     those sentences removed. The assistant cannot see a calendar.
  if (d.action === "reply") {
    // WHERE ARE WE IN ARRANGING THE CALL? If our last words asked when they would like it ("morning, afternoon or
    // evening?") and they have now said ("subah"), the answer is an acknowledgement and an alert to the team — NOT the
    // same question again. Asking twice made the duplicate-guard see a repeat and the assistant went SILENT on a customer
    // who had just said yes (live, 2026-11-14: "subah" -> nothing, "???" -> nothing).
    const asked = (ctx.recentOut ?? []).some(isMeetingAsk);
    const pref = parseMeetingPreference(ctx.lastInbound ?? "");
    if (asked && pref.any) {
      d = { ...d, intent: "meeting", reply: MEETING_ACK[ctx.lang](pref.label), meeting_pref: pref.label, templated: true, needs_human: true, reason: `wants a call — ${pref.label}` };
      note("call time noted: team told to schedule it");
    } else if (d.intent === "meeting") {
      d = { ...d, reply: asked ? MEETING_REASK[ctx.lang] : MEETING_FALLBACK[ctx.lang], templated: true };
      note(asked ? "asked again when they would like the call" : "call requested: no calendar or booking link, asked when they are free");
    } else if (proposesTime(d.reply)) {
      const cleaned = stripTimeProposals(d.reply);
      d = { ...d, reply: cleaned || MEETING_FALLBACK[ctx.lang] };
      note("invented call time removed");
    }
  }

  // 1d. SMALL TALK. An assistant has watched, eaten and visited nothing.
  if (d.action === "reply" && d.intent === "smalltalk" && claimsExperience(d.reply)) {
    d = { ...d, reply: SMALLTALK_DEFLECT[ctx.lang], templated: true };
    note("small talk: claimed an experience, replaced");
  }

  // 2b. A CALL ASKED FOR AGAIN. One offer is salesmanship; the same question under every message is
  //     pressure (live sim, 2026-11-14: three offers in six replies). If a call was offered in either of
  //     our last two messages, they have not taken it, and they are not asking for one now, the offer is
  //     dropped from this reply — deterministically, with no second model call.
  if (d.action === "reply" && d.intent !== "meeting" && !ctx.callWanted && offersCall(d.reply) && (ctx.recentOut ?? []).some(offersCall)) {
    d = { ...d, reply: stripCallOffer(d.reply) };
    note("call offer removed: already offered");
  }

  if (d.action === "reply" && !d.needs_human) {
    const claim = riskyClaim(d.reply);
    if (claim) d = { ...d, needs_human: true, reason: d.reason ? `${d.reason} — check: ${claim}` : `check: ${claim}` };
  }

  if (ctx.handoffFloor.yes && !d.needs_human) d = { ...d, needs_human: true, reason: d.reason || ctx.handoffFloor.reason };
  return d;
}
