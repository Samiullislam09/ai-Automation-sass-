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
 */

import "@/lib/dns-fix";
import { NVIDIA_URL, chatModelsInOrder, modelParams } from "@/lib/chat-model";
import { parseWhen, describeWhen, type When } from "@/lib/when";
import { wantsAutoPublish } from "@/lib/chat-intent";
import type { BrainRegistry } from "@/lib/brain";
import {
  ANSWER_QUESTION,
  CONFIDENCE_FIELD,
  DELIVERY_FIELD,
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
  when: { at: string; kind: "absolute" | "relative" | "recurring"; matched: string } | null;
  delivery: "approvals" | "publish" | "chat";
  confidence: number;
  missing: string[];
  echo: string;
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

export const nothingOrdered = (confidence = 1): IntentPlan => ({
  action: ANSWER_QUESTION,
  params: {},
  when: null,
  delivery: "chat",
  confidence,
  missing: [],
  echo: "",
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

/** The one line the user sees when they are asked to confirm, and the receipt after.
 *
 *  Built from the action's own words — its first `phrase` is how the customer says it — plus
 *  the subject they named, the time in their zone, and where the result lands. No action name
 *  is spelled out here, so a new agent gets a readable echo the day it registers. */
export function echoLine(
  found: EnabledAction,
  params: Record<string, unknown>,
  when: When | null,
  delivery: "approvals" | "publish" | "chat",
  tz: string,
  now: Date = new Date()
): string {
  const spec = found.spec;
  const what = (spec.phrases ?? [])[0] ?? spec.id.replace(/_/g, " ");
  const subject = Object.entries(params)
    .filter(([, v]) => typeof v === "string" && v.trim().length > 2)
    .map(([, v]) => String(v).trim())[0];
  const at = when ? `${describeWhen(when.at, tz, now)} (${tz})` : "abhi";
  const lands = delivery === "publish" ? "seedha site pe live" : "Approvals me";
  return [what, subject ? `"${subject}"` : null, at, lands].filter(Boolean).join(" · ");
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
  const when = resolveWhen(ctx.message, (args ?? {})[WHEN_FIELD], ctx.tz, now);
  const delivery = resolveDelivery(ctx.message, (args ?? {})[DELIVERY_FIELD]);

  const raw = (args ?? {})[CONFIDENCE_FIELD];
  const confidence =
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : ASSUMED_CONFIDENCE;

  return {
    action: found.spec.id,
    params,
    when: when ? { at: when.at.toISOString(), kind: when.kind, matched: when.matched } : null,
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

  const key = opts.apiKey ?? process.env.NVIDIA_API_KEY;
  if (!key) return nothingOrdered();

  const doFetch = opts.fetchImpl ?? fetch;
  const prior = (opts.history ?? [])
    .slice(-2)
    .filter((t) => t && typeof t.content === "string")
    .map((t) => ({ role: t.role === "user" ? "user" : "assistant", content: String(t.content).slice(0, 300) }));

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
          messages: [{ role: "system", content: systemPrompt() }, ...prior, { role: "user", content: q }],
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
