/** lib/chat-brain-intent.ts — the intent engine (plan §5.1).
 *
 *  One message in, this shape out, every time:
 *
 *      { action, params, when, delivery, confidence, missing, echo }
 *
 *  The model's only job is to pick a tool and fill its arguments. Everything that costs money
 *  if it is wrong is decided by code afterwards:
 *
 *   · WHEN is parsed by lib/when.ts, never by the model. The model copies the user's own time
 *     words into `when_phrase`; this file hands that phrase to `parseWhen`. A model asked for
 *     an instant produces a plausible one for a message that named no time at all — that is
 *     the exact bug that put "queued for immediate publish (30 minutes from now)" in front of
 *     a customer when nothing had been queued.
 *   · DELIVERY can only be "publish" when the user's own sentence says so. `wantsAutoPublish`
 *     (lib/chat-intent.ts) is the code half, and it already knows "publish mat karna" is a
 *     refusal; the model can only agree with it or downgrade it. Publishing to a live site is
 *     the one thing here that cannot be undone, so an unclear sentence must never resolve
 *     towards doing it.
 *   · AN ACTION NOT IN THE REGISTRY IS NOT AN ACTION. A hallucinated tool name becomes
 *     `answer_question`, which starts nothing.
 *   · MISSING SLOTS ARE COUNTED FROM THE MANIFEST, not from the model's opinion of them, and
 *     one missing slot means ONE question (plan §10 rule 3) — never a guess, never two
 *     questions.
 *   · IRREVERSIBLE IS NOT SET HERE AT ALL. The brain reads it off the manifest. A caller that
 *     could declare its own order reversible is a caller that could skip the confirmation.
 *
 *  MODEL: whatever lib/chat-model.ts says, with that file's per-model reasoning-off switch —
 *  today gpt-oss-120b, which read all seven real Hinglish orders correctly including "isko
 *  publish mat karna" (commit f3503b8). No model name appears in this file.
 *
 *  WHY THIS CALL TRIES A FAST PROVIDER FIRST (2026-08-28). This is the call that decides
 *  "order or question" for EVERY message, before anything else can happen — including the
 *  reply the customer actually watches. §18.1 measured NIM's shared free queue at 0.5-19s
 *  variance, and until this change that variance landed here in full even after §18.2 #1
 *  (lib/ai/fastChat.ts) made the FINAL reply fast: a 12s classification call ahead of a 1ms
 *  reply is still a 12s answer to the user. `openFastCompletion` (same file) tries Groq/
 *  Cerebras first, with a shorter timeout than NIM's own (stalling on a "fast" provider must
 *  not cost more than the NIM path it was supposed to beat) — inert, zero network calls, when
 *  none is configured, so this is unchanged behaviour until a key is set.
 */

import "@/lib/dns-fix";
import { NVIDIA_URL, chatModelsInOrder, modelParams } from "@/lib/chat-model";
import { openFastCompletion } from "@/lib/ai/fastChat";
import { parseWhen, describeWhen, type When } from "@/lib/when";
import { isRealTopic, wantsAutoPublish } from "@/lib/chat-intent";
import type { BrainRegistry } from "@/lib/brain";
import {
  ANSWER_QUESTION,
  CONFIDENCE_FIELD,
  DELIVERY_FIELD,
  REPLY_FIELD,
  WHEN_FIELD,
  coerceParams,
  enabledActions,
  missingSlots,
  toolsFromRegistry,
  type EnabledAction,
} from "@/lib/chat-tools";

/** Plan §5.1's shape, exactly. `agent` and `irreversible` are the brain's to fill in. */
export type IntentPlan = {
  action: string;
  params: Record<string, unknown>;
  when: { at: string; kind: "absolute" | "relative" | "recurring"; matched: string; label: string } | null;
  delivery: "approvals" | "publish" | "chat";
  confidence: number;
  missing: string[];
  echo: string;
  /** The model's own words for "I'm doing this now" — genuinely written by whichever call chose
   *  this tool (lib/chat-tools.ts's REPLY_FIELD), not a hand-written line. Null only when a
   *  model left the field out; ackLine() is the deterministic fallback for that case, kept
   *  separate so callers can tell "the model wrote this" from "we had to guess" if it matters. */
  reply: string | null;
};

/** Below this, ask instead of doing (plan §5.1). Not a dial to turn down: the cost of a wrong
 *  order is the customer's credits and, at the far end, a page on their live website. */
export const CONFIDENCE_FLOOR = 0.75;

/** What a tool call means when the model did not say. A model that picked a specific tool and
 *  filled its arguments has already expressed more confidence than a hedge; the floor exists
 *  for the calls where it volunteers a low number, and for the ones where it says nothing at
 *  all AND left a required slot empty (which `missing` catches on its own). */
const ASSUMED_CONFIDENCE = 0.9;

const TIMEOUT_MS = 12_000;
// A fast provider (Groq/Cerebras, §18.2 #1) is dedicated hardware — if it has not answered in
// this long it is not going to beat NIM anyway, and waiting the full TIMEOUT_MS on a stalled
// fast provider before ALSO paying NIM's own timeout is the one way this change could make the
// worst case slower instead of faster. Shorter, not equal, on purpose.
const FAST_TIMEOUT_MS = 6_000;

export const nothingOrdered = (confidence = 1): IntentPlan => ({
  action: ANSWER_QUESTION,
  params: {},
  when: null,
  delivery: "chat",
  confidence,
  missing: [],
  echo: "",
  reply: null,
});

/* ── The parts the model does not decide ─────────────────────────────────────────────── */

/** The user's time words → an instant, or null.
 *
 *  The model's phrase is tried first, because it is the fragment the model believed was about
 *  timing. If it gave none, the whole message is read instead — which is what the chat has
 *  always done and what lib/when.ts's 26 tests cover. If it gave a phrase that lib/when.ts
 *  cannot read ("soon", "baad me"), that is not a time: the message is tried, and if that also
 *  finds nothing, the order is for now. Nothing in either path lets a model name an instant. */
export function resolveWhen(message: string, phrase: unknown, tz: string, now: Date = new Date()): When | null {
  const p = typeof phrase === "string" ? phrase.trim() : "";
  if (p) {
    const fromPhrase = parseWhen(p, tz, now);
    if (fromPhrase) return fromPhrase;
  }
  return parseWhen(message, tz, now);
}

/** "publish" needs BOTH halves to agree: the user's sentence must ask for it (code, tested,
 *  negation-aware) and the model must not have read it as a draft request. Either one saying
 *  "approvals" wins, in that direction only. */
export function resolveDelivery(message: string, fromModel: unknown): "approvals" | "publish" {
  const modelSaysNo = fromModel === "approvals";
  return !modelSaysNo && wantsAutoPublish(message) ? "publish" : "approvals";
}

/** Clean, English display label per action — used ONLY for the echo below (and, through it,
 *  the Live Visual header and timeline). `spec.phrases[0]` must not be reused for this: those
 *  are Hinglish routing triggers ("keywords do", "seedha publish kar do") meant for the intent
 *  engine to match against, not something the customer should read back at themselves. An
 *  action with no entry here still gets a readable label — its id with underscores turned to
 *  spaces — so a new agent needs no update here to avoid an unreadable echo. */
const ACTION_LABEL: Record<string, string> = {
  crawl_site: "Reading your site",
  build_site_profile: "Analyzing your site",
  plan_topics: "Planning topics",
  pick_topic: "Choosing a topic",
  find_keywords: "Keyword research",
  write_article: "Writing the article",
  research_brief: "Research",
  make_images: "Creating images",
  make_image: "Creating an image",
  make_story: "Creating a Web Story",
  check_seo: "SEO check",
  publish_article: "Publishing",
  audit_site: "Site audit",
  draft_social: "Drafting social posts",
  find_leads: "Finding leads",
};

/** Words that describe the REQUEST, not a subject. "find a good keyword for my article" hands
 *  the model `topic: "article"` — a perfectly ordinary word that isRealTopic() (built for
 *  "null" and sentence fragments) lets straight through — and the customer then watched the
 *  timeline say `Keyword research · "article"` and the title read "Keyword Research: article"
 *  (found live 2026-09-10 on Vercel). Same idea as lib/chat-classify.ts's FILLER: strip the
 *  request words and see whether anything is left. */
const REQUEST_WORDS =
  /\b(?:best|good|top|new|next|some|any|my|our|the|an?|for|about|on|please|keywords?|key ?word|artic\w*|blogs?|posts?|content|topics?|research|write|writing|draft|likh\w*|nikal\w*|dhund\w*|dhoond\w*|banao|website|site)\b/gi;

function isRealSubject(v: string): boolean {
  if (!isRealTopic(v)) return false;
  const residue = v.replace(REQUEST_WORDS, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  return /[\p{L}]{3,}/u.test(residue);
}

/** The subject the customer actually named, or null. `topic` is the field every manifest uses
 *  for the subject, so it is read first; any other string param is a fallback for an agent
 *  that names its subject field differently. */
function subjectOf(params: Record<string, unknown>): string | null {
  const topic = params.topic;
  if (typeof topic === "string" && topic.trim().length > 2) return topic.trim();
  for (const [k, v] of Object.entries(params)) {
    if (k === "topic") continue;
    if (typeof v === "string" && v.trim().length > 2) return v.trim();
  }
  return null;
}

/** Roman-Hindi / Hinglish, as a cheap word test — enough to pick which of two written
 *  sentences to send back, never used to decide anything about the order itself. */
export function looksHinglish(message: string): boolean {
  return /\b(?:karo|kar\s+do|karna|hai|hain|mujhe|mere|mera|liye|liya|dhundo|dhoondo|dhundho|likho|likhna|nikalo|batao|chahiye|kya|aap|tum|bhai|acha|achha|theek|thik|wala|wali|abhi|kal)\b/i.test(
    String(message ?? "")
  );
}

/** How an action's label joins onto its subject in a sentence. "Writing the article" already
 *  carries its noun, so the subject follows directly; "Keyword research" needs "for";
 *  "Research" reads best with "on". */
const SUBJECT_JOIN: Record<string, string> = {
  write_article: "",
  research_brief: "on",
};

/** The one line the user sees when they are asked to confirm, the receipt after, and the
 *  first line of the task's timeline — a plain English sentence, not a " · "-joined record
 *  (owner 2026-09-10: `Keyword research · "article" · now · your Approvals queue` read as
 *  "ajib sa"). Built from the action's own English label, the subject they named (kept in
 *  double quotes on purpose — components/MrLxwaDashboard.tsx's taskTitle() reads it back out
 *  with /"([^"]+)"/), the time in their zone, and where the result lands.
 *
 *  Shapes:
 *    Keyword research for "ISO 9001 certification". Starting now. Results will land in your Approvals queue.
 *    Writing the article "X". Scheduled: in 3 days — Thu 10 Sept at 03:37 pm (Asia/Calcutta). It will be published directly to your site.
 *    Site audit. Starting now. Results will land in your Approvals queue. */
export function echoLine(
  found: EnabledAction,
  params: Record<string, unknown>,
  when: When | null,
  delivery: "approvals" | "publish" | "chat",
  tz: string,
  now: Date = new Date()
): string {
  const spec = found.spec;
  const what = ACTION_LABEL[spec.id] ?? spec.id.replace(/_/g, " ");
  const subject = subjectOf(params);
  const join = SUBJECT_JOIN[spec.id] ?? "for";
  const headline = subject ? `${what} ${join ? `${join} ` : ""}"${subject}"` : what;
  const timing = when ? `Scheduled: ${describeWhen(when.at, tz, now)} (${tz}).` : "Starting now.";
  const lands = delivery === "publish" ? "It will be published directly to your site." : "Results will land in your Approvals queue.";
  return `${headline}. ${timing} ${lands}`;
}

/** What Mr. Lxwa actually says, in the chat, the moment a reversible action starts running
 *  with no confirmation needed — the first-person sentence the customer reads before the live
 *  progress strip takes over. There used to be a bare "On it." here, removed 2026-08-31 for
 *  going stale (it sat in the transcript unchanged for the whole run). The fix was never "say
 *  nothing" — it was "say something real instead of a status that goes stale" (owner
 *  2026-09-09: "kaam shuru hone se pehle mujhe ek message aana chahiye ... jo bhi task ho").
 *
 *  This is the FALLBACK only — the model writes the real line itself (lib/chat-tools.ts's
 *  REPLY_FIELD) and this runs when it left that field out. Two sentences per action, English
 *  and Hinglish, and looksHinglish() on the customer's own message picks: an English question
 *  answered in Hinglish read as the product not listening (found live 2026-09-10 on Vercel).
 *  One real sentence per action, same reason ACTION_LABEL is a table and not a formatter:
 *  "Working on X" repeated for every action reads like a template, not a teammate talking to
 *  you. An action with no entry here still gets a real sentence, built from the same
 *  id-to-words fallback ACTION_LABEL uses, so a new agent needs no update here either. */
type AckPair = { en: (subject: string | null) => string; hi: (subject: string | null) => string };
const ACK_LINE: Record<string, AckPair> = {
  crawl_site: {
    en: () => "Got it — I'm reading through your whole website again now.",
    hi: () => "Theek hai, main aapki poori website dobara padh raha hoon.",
  },
  build_site_profile: {
    en: () => "Got it — I'm re-analyzing your business from your site now.",
    hi: () => "Theek hai, main aapke business ko dobara samajh raha hoon.",
  },
  plan_topics: {
    en: () => "Got it — I'm planning this week's topics for you now.",
    hi: () => "Theek hai, main is hafte ke topics plan kar raha hoon.",
  },
  pick_topic: {
    en: () => "Got it — I'm choosing the best next topic for you now.",
    hi: () => "Theek hai, main agla best topic choose kar raha hoon.",
  },
  find_keywords: {
    en: (s) => `Got it — I'm finding the best keywords for you${s ? ` around "${s}"` : ""} now, ready for your next article.`,
    hi: (s) =>
      `Theek hai, main aapke liye best keywords dhoond raha hoon${s ? ` "${s}" ke liye` : ""} jo aap agle article ke liye use kar sakte hain.`,
  },
  write_article: {
    en: (s) => `Got it — I'm starting on your article${s ? ` about "${s}"` : ""} now.`,
    hi: (s) => `Theek hai, main${s ? ` "${s}" par` : ""} article likhna shuru kar raha hoon.`,
  },
  research_brief: {
    en: (s) => `Got it — I'm researching${s ? ` "${s}"` : " this"} for you now.`,
    hi: (s) => `Theek hai, main${s ? ` "${s}" par` : ""} research kar raha hoon.`,
  },
  make_images: { en: () => "Got it — I'm creating the images now.", hi: () => "Theek hai, main images bana raha hoon." },
  make_image: { en: () => "Got it — I'm creating the image now.", hi: () => "Theek hai, main ek image bana raha hoon." },
  make_story: { en: () => "Got it — I'm creating the Web Story now.", hi: () => "Theek hai, main ek Web Story bana raha hoon." },
  check_seo: { en: () => "Got it — I'm running the SEO check now.", hi: () => "Theek hai, main SEO check kar raha hoon." },
  publish_article: { en: () => "Got it — I'm publishing it now.", hi: () => "Theek hai, main ise publish kar raha hoon." },
  audit_site: { en: () => "Got it — I'm auditing your site now.", hi: () => "Theek hai, main aapki site ka audit kar raha hoon." },
  draft_social: { en: () => "Got it — I'm drafting the social posts now.", hi: () => "Theek hai, main social posts draft kar raha hoon." },
  find_leads: { en: () => "Got it — I'm finding leads for you now.", hi: () => "Theek hai, main aapke liye leads dhoond raha hoon." },
};

export function ackLine(found: EnabledAction, params: Record<string, unknown>, message = ""): string {
  const subject = subjectOf(params);
  const spec = found.spec;
  const hinglish = looksHinglish(message);
  const pair = ACK_LINE[spec.id];
  if (pair) return hinglish ? pair.hi(subject) : pair.en(subject);
  const what = (ACTION_LABEL[spec.id] ?? spec.id.replace(/_/g, " ")).toLowerCase();
  return hinglish
    ? `Theek hai, main ${what}${subject ? ` "${subject}"` : ""} shuru kar raha hoon.`
    : `Got it — I'm starting on ${what}${subject ? ` for "${subject}"` : ""} now.`;
}

/** One tool call → the plan. Pure, and the only place a tool call turns into an order — the
 *  network half below is a thin wrapper around this so every rule here is testable offline. */
export function planFromToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: { message: string; registry: BrainRegistry | null | undefined; tz: string; now?: Date }
): IntentPlan {
  const now = ctx.now ?? new Date();
  const actions = enabledActions(ctx.registry);
  const found = actions.get(String(name ?? ""));

  // Not a tool, or a tool the registry does not have (a hallucinated name, or an agent that
  // went disabled between the prompt and the answer). Either way nothing is ordered.
  if (!found || name === ANSWER_QUESTION) return nothingOrdered();

  const params = coerceParams(found.spec, args ?? {});
  // A `topic` that only names the request ("article", "keywords", "content") is no topic at
  // all — see isRealSubject. Dropped rather than kept, so it never reaches the agent as a seed
  // and never shows up in the echo/title. For the actions where `topic` is also a `need`
  // (find_keywords, write_article in the real manifests), the planner then fills it from the
  // customer's own site via pick_topic — missingSlots() already treats a graph-filled field as
  // provided, so this does not turn into a question.
  if (typeof params.topic === "string" && !isRealSubject(params.topic)) delete params.topic;
  const when = resolveWhen(ctx.message, (args ?? {})[WHEN_FIELD], ctx.tz, now);
  const delivery = resolveDelivery(ctx.message, (args ?? {})[DELIVERY_FIELD]);

  const raw = (args ?? {})[CONFIDENCE_FIELD];
  const confidence =
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : ASSUMED_CONFIDENCE;

  const rawReply = (args ?? {})[REPLY_FIELD];
  const reply = typeof rawReply === "string" && rawReply.trim().length > 0 ? rawReply.trim() : null;

  return {
    action: found.spec.id,
    params,
    reply,
    // `matched` stays the raw phrase the customer typed (kept for the reply that quotes them
    // back to themselves); `label` is always the clean, English, describeWhen() rendering —
    // the one every downstream "Booked — ..." card should show, so a Hinglish "3 din bad" never
    // leaks into an otherwise-English confirmation (owner report 2026-09-07: dashboard card read
    // "Booked — 3 din bad" next to English chrome everywhere else).
    when: when
      ? { at: when.at.toISOString(), kind: when.kind, matched: when.matched, label: describeWhen(when.at, ctx.tz, now) }
      : null,
    delivery,
    confidence,
    missing: missingSlots(found.spec, params),
    echo: echoLine(found, params, when, delivery, ctx.tz, now),
  };
}

/* ── The model call ──────────────────────────────────────────────────────────────────── */

function systemPrompt(): string {
  return [
    "You route one message from a small business owner to their AI marketing team.",
    "",
    "Call exactly ONE tool. The tools are the only work the team can do; there is no other way to start anything.",
    "",
    "Rules:",
    "- The message may be English, Hinglish or Roman Urdu, and badly typed. Read the meaning.",
    '- Negation decides everything. "article nahi likhna", "mat likho", "don\'t write it" is never an order to write.',
    "- A question, a greeting, a status check, or anything you are unsure about is the question tool. Starting work " +
      "nobody asked for spends the customer's money; asking one question costs nothing.",
    "- Fill only the arguments the user actually gave you. Never invent a topic, a name, or a number. Leaving a " +
      "required argument out is correct and safe — they will be asked.",
    "- Copy time words verbatim into " + WHEN_FIELD + ". Do not convert them, do not compute a date.",
    "- " + REPLY_FIELD + " MUST be in the same language and script as the user's latest message: an English message gets " +
      "professional English, a Hinglish / Roman Hindi message gets Hinglish. Never switch languages on them.",
    "- Do not write any prose. The tool call is the whole answer.",
  ].join("\n");
}

type ToolCall = { name: string; args: Record<string, unknown> };

function readToolCall(data: any): ToolCall | null {
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  const name = call?.function?.name;
  if (typeof name !== "string" || !name) return null;
  const raw = call?.function?.arguments;
  let args: Record<string, unknown> = {};
  if (raw && typeof raw === "object") args = raw as Record<string, unknown>;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") args = parsed;
    } catch {
      // Arguments that will not parse are arguments we do not have. The tool name still
      // stands, and the missing-slot question is exactly the right outcome.
    }
  }
  return { name, args };
}

export type ExtractOptions = {
  tz?: string;
  history?: Array<{ role: string; content: string }>;
  now?: Date;
  /** Injected by the tests. Production always uses the global fetch. */
  fetchImpl?: typeof fetch;
  apiKey?: string;
  /** Injected by the tests to stand in for lib/ai/fastChat.ts's openFastCompletion, so a test
   *  can prove the fast path is TRIED first without needing a real Groq key. Production always
   *  uses the real one — see the file header on why this call matters more than the reply. */
  fastCompletion?: typeof openFastCompletion;
};

/** The whole intent engine: registry → tools → one model call → a plan.
 *
 *  Never throws and never invents. Anything that goes wrong — no key, no answer, a broken
 *  stream, an unparseable reply — comes back as "nothing was ordered", which routes the
 *  message to the ordinary conversational reply. A missed order costs one rephrase; a
 *  fabricated one costs credits and trust. */
export async function extractIntent(
  message: string,
  registry: BrainRegistry | null | undefined,
  opts: ExtractOptions = {}
): Promise<IntentPlan> {
  const q = String(message ?? "").trim();
  const tz = opts.tz || "UTC";
  if (!q || q.length > 2000) return nothingOrdered();

  const tools = toolsFromRegistry(registry);
  // Only the question tool means the team can do nothing at all — do not spend a call on it.
  if (tools.length <= 1) return nothingOrdered();

  const doFetch = opts.fetchImpl ?? fetch;
  const prior = (opts.history ?? [])
    .slice(-2)
    .filter((t) => t && typeof t.content === "string")
    .map((t) => ({ role: t.role === "user" ? "user" : "assistant", content: String(t.content).slice(0, 300) }));
  const messages = [{ role: "system", content: systemPrompt() }, ...prior, { role: "user", content: q }];

  // ── The fast path first (§18.2 #1, extended past just the reply — see the file header) ────
  //
  // This is THE call that decides "order or question" for every single message, before the
  // brain knows which it is looking at — so it is the one place §18.1's 0.5-19s NIM variance
  // hurt the most, worse than the final reply itself, because nothing else can start until this
  // one answers. Same providers (Groq, then Cerebras), same key fallback as the reply path;
  // inert with zero network calls when none is configured, exactly like fastChat.ts elsewhere.
  const tryFast = opts.fastCompletion ?? openFastCompletion;
  const fast = await tryFast(
    { temperature: 0, max_tokens: 300, tools, tool_choice: "auto", messages },
    { fetchImpl: opts.fetchImpl, signal: AbortSignal.timeout(FAST_TIMEOUT_MS) }
  ).catch((e: any) => {
    console.error(`[chat-brain-intent] fast provider errored, falling back to NIM:`, e?.message);
    return null;
  });
  if (fast) {
    const call = readToolCall(fast.data);
    if (!call) return nothingOrdered(); // the model answered in prose: it is a conversation
    return planFromToolCall(call.name, call.args, { message: q, registry, tz, now: opts.now });
  }

  const key = opts.apiKey ?? process.env.NVIDIA_API_KEY;
  if (!key) return nothingOrdered();

  for (const model of chatModelsInOrder()) {
    try {
      const res = await doFetch(NVIDIA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          stream: false,
          ...modelParams(model),
          // Routing spends money when it is wrong, so the same sentence must route the same
          // way twice. Sampling variety belongs in prose, not here.
          temperature: 0,
          max_tokens: 300,
          tools,
          tool_choice: "auto",
          messages,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res?.ok) {
        console.error(`[chat-brain-intent] ${model} refused (${res?.status})`);
        continue;
      }
      const data = await res.json();
      const call = readToolCall(data);
      if (!call) return nothingOrdered(); // the model answered in prose: it is a conversation
      return planFromToolCall(call.name, call.args, { message: q, registry, tz, now: opts.now });
    } catch (e: any) {
      console.error(`[chat-brain-intent] ${model} unreachable:`, e?.message);
    }
  }

  // Every model failed. Falling through to conversation is the honest outcome: we do not know
  // what was asked for, so we start nothing.
  return nothingOrdered();
}
