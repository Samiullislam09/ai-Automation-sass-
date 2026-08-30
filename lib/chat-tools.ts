/** lib/chat-tools.ts — the registry, as tools the model can call.
 *
 *  THE POINT OF THIS FILE, in one sentence: a new agent becomes routable in the chat without
 *  a web deploy.
 *
 *  Nothing here names a single action. Every tool the model is offered is built from a
 *  manifest the brain served a moment ago: the id becomes the tool name, the agent's
 *  description plus the action's own `phrases` become the description the model matches
 *  Hinglish against, and the `input` spec becomes a JSON Schema. Add an agent to the brain's
 *  manifests, and the next chat message can already order it. lib/chat-tools.test.ts asserts
 *  that literally — it greps this file's own source for the ids in the registry and fails if
 *  any of them appear.
 *
 *  Plan §5.1 upgrade C: function calling, not freeform JSON. The model does not "reply with
 *  ONLY JSON" and get parsed hopefully; it calls a tool whose schema the server enforces, and
 *  "none of these" is expressed by calling the one non-agent tool below instead of by an
 *  empty string we have to interpret.
 *
 *  DISABLED AGENTS GET NO TOOL. A stub, or an agent with no adapter yet, is registered in the
 *  brain (so the planner can explain itself) and `enabled: false`. Offering the model a tool
 *  whose agent would answer "stub — Phase 3 wires in…" is how a customer gets an accepted
 *  order that produces nothing. It cannot happen here: the model has no way to name it.
 */

import type { BrainAction, BrainAgent, BrainRegistry } from "@/lib/brain";

/** The tool the model calls when the user is not ordering work: a question, a greeting, small
 *  talk, a status check. It is not an agent and it starts nothing — it exists so that "none of
 *  these" is a positive answer with a name, which models pick far more reliably than they
 *  produce a well-formed refusal. */
export const ANSWER_QUESTION = "answer_question";

export type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
};

export type ChatTool = {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
};

/** action id → the agent that owns it and what it declares. Enabled agents only. */
export type EnabledAction = { agent: BrainAgent; spec: BrainAction };

/* ── The three fields every order carries, whatever the action is ────────────────────── */

/** The user's own words for the time, copied out of the message — NEVER an instant.
 *  lib/when.ts turns it into one. A model asked for "2026-08-27T16:40:00Z" will happily
 *  produce a plausible one, in the wrong timezone, for a message that named no time at all. */
export const WHEN_FIELD = "when_phrase";
/** Where the result goes. Only the user can put it on "publish". */
export const DELIVERY_FIELD = "delivery";
/** How sure the model is. Below the floor in lib/chat-brain-intent.ts it becomes a question. */
export const CONFIDENCE_FIELD = "confidence";

const META_FIELDS: Record<string, Record<string, unknown>> = {
  [WHEN_FIELD]: {
    type: "string",
    description:
      'The time words the user actually typed, copied EXACTLY ("30 min baad", "kal subah 9 baje", "in 2 hours"). ' +
      "Never a date, never an ISO timestamp, never your own wording. Leave it out if they named no time.",
  },
  [DELIVERY_FIELD]: {
    type: "string",
    enum: ["approvals", "publish"],
    description:
      'Use "publish" ONLY if the user explicitly asked for it to go live on their site in this message. ' +
      'Anything else — including "publish mat karna", "don\'t publish", "sirf draft" — is "approvals".',
  },
  [CONFIDENCE_FIELD]: {
    type: "number",
    description: "0 to 1: how sure you are this is the right tool and the arguments are right. Be honest; 0.5 is fine.",
  },
};

/* ── input spec → JSON Schema ────────────────────────────────────────────────────────── */

const BASE_TYPES: Record<string, Record<string, unknown>> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  object: { type: "object" },
  "string[]": { type: "array", items: { type: "string" } },
  "number[]": { type: "array", items: { type: "number" } },
  "boolean[]": { type: "array", items: { type: "boolean" } },
  "object[]": { type: "array", items: { type: "object" } },
};

/** `"number?"` → `{ type: "number" }`, not required. The `?` is the contract's optional mark
 *  and it is the ONLY thing that decides `required` — which is also what decides whether a
 *  missing value becomes a question instead of a guess. */
export function fieldSchema(spec: string): { schema: Record<string, unknown>; required: boolean } | null {
  const raw = String(spec ?? "").trim();
  if (!raw) return null;
  const optional = raw.endsWith("?");
  const base = optional ? raw.slice(0, -1) : raw;
  const schema = BASE_TYPES[base];
  if (!schema) return null;
  return { schema: { ...schema }, required: !optional };
}

export function schemaFromInput(input: Record<string, string>, extras: string[] = [], needs: string[] = []): JsonSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  // A field that is ALSO one of the action's `needs` is never required of the user: an earlier
  // step produces it and the planner threads it in (agent-server/src/brain/planner.ts's
  // `__from`). missingSlots() below has always known this; this function did not, and the
  // difference is what made "write me an article" fail once its topic slot became a need. The
  // model was shown a tool it could not legally call without that value, so it quietly fell
  // back to the question tool and replied conversationally instead of ordering the work —
  // which reads to the customer as being interrogated for something the team is supposed to
  // work out itself (found live 2026-08-31).
  const providedByGraph = new Set((needs ?? []).map(String));

  for (const [name, spec] of Object.entries(input ?? {})) {
    const field = fieldSchema(spec);
    if (!field) continue; // a type we do not understand is left out rather than guessed at
    properties[name] = field.schema;
    if (field.required && !providedByGraph.has(name)) required.push(name);
  }

  // The shared fields go on last and never overwrite a field the agent declared itself: an
  // agent that genuinely takes a field of the same name owns it, and its meaning wins.
  for (const name of extras) {
    if (properties[name]) continue;
    properties[name] = META_FIELDS[name];
  }

  return { type: "object", properties, required, additionalProperties: false };
}

/* ── The tool list ───────────────────────────────────────────────────────────────────── */

/** Which actions are on the table right now: enabled agent, healthy agent, nothing else. */
export function enabledActions(registry: BrainRegistry | null | undefined): Map<string, EnabledAction> {
  const out = new Map<string, EnabledAction>();
  for (const agent of registry?.agents ?? []) {
    if (!agent.enabled || !agent.healthy) continue;
    for (const spec of agent.actions ?? []) {
      if (!out.has(spec.id)) out.set(spec.id, { agent, spec });
    }
  }
  return out;
}

/** Does the message literally contain one of an action's own registered trigger phrases?
 *
 *  Plan §5.1 promises a deterministic fast path ("Aaj ka regex + chhota classifier rahega — fast
 *  path, 0ms, ₹0") under the model-driven extractor. It was never built, so routing rested
 *  entirely on the model's judgement — and the model kept reading a bare, unmistakable order (an
 *  action's own trigger words, with no subject after them) as a question, answering it
 *  conversationally instead of ordering the work (found live, 2026-08-31).
 *
 *  This reads the phrases straight off the manifests, so it stays honest to the rule stated in
 *  agent-server/src/brain/manifests.ts: phrases are what the intent engine routes on, and the
 *  registry refuses to boot if two actions claim the same one. Nothing here is hard-coded — a
 *  new agent gets a fast path the day it declares its phrases.
 *
 *  The longest match wins, so a specific phrase beats a generic one that happens to be a
 *  substring of it. Both sides are padded with spaces so a phrase matches as whole words inside
 *  a longer sentence, without matching as a fragment inside an unrelated compound word.
 */
export function matchActionPhrase(message: string, registry: BrainRegistry | null | undefined): string | null {
  const hay = ` ${String(message ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  if (hay.trim().length < 3) return null;

  let bestId: string | null = null;
  let bestLen = 0;
  for (const { spec } of Array.from(enabledActions(registry).values())) {
    for (const raw of spec.phrases ?? []) {
      const phrase = String(raw ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
      // Single short words ("publish it") are fine; anything under 4 characters is too easy to
      // hit by accident inside an unrelated sentence.
      if (phrase.length < 4) continue;
      if (!hay.includes(` ${phrase} `)) continue;
      if (phrase.length > bestLen) {
        bestLen = phrase.length;
        bestId = spec.id;
      }
    }
  }
  return bestId;
}

function describe(agent: BrainAgent, spec: BrainAction): string {
  const secs = spec.estimated_seconds;
  const time = secs < 90 ? `~${secs}s` : `~${Math.round(secs / 60)} min`;
  const said = (spec.phrases ?? []).filter(Boolean).map((p) => `"${p}"`).join(", ");
  return [
    `${agent.name}: ${agent.description}`,
    // The phrases are the whole reason Hinglish routes at all. They are the agent's own
    // words for what it does, in the language the customer types, and they travel with the
    // manifest — so a new agent teaches the router its phrasings by declaring them.
    said ? `The user says it like: ${said}.` : "",
    `Takes about ${time}.`,
    // Said out loud so the model never withholds the tool for want of a value the team supplies
    // itself. Without this it read a blank `topic` as "I cannot call this yet" and answered
    // conversationally instead of placing the order.
    (spec.needs ?? []).length
      ? `Call this even when ${(spec.needs ?? []).join(", ")} ${(spec.needs ?? []).length === 1 ? "is" : "are"} not given — the team works ${(spec.needs ?? []).length === 1 ? "it" : "them"} out from the customer's own site and search data. Never ask the customer for ${(spec.needs ?? []).join(" or ")}.`
      : "",
    spec.irreversible ? "This one cannot be undone — the user will be asked to confirm first." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Every enabled action as a tool, plus the one non-agent tool. Order is stable (registry
 *  order, then the question tool last) so two identical registries produce two identical
 *  prompts and the same message classifies the same way twice. */
export function toolsFromRegistry(registry: BrainRegistry | null | undefined): ChatTool[] {
  const tools: ChatTool[] = [];
  const extras = [WHEN_FIELD, DELIVERY_FIELD, CONFIDENCE_FIELD];

  // Array.from rather than iterating the Map directly: this repo's tsconfig targets ES5-era
  // iteration and `--downlevelIteration` is off.
  for (const { agent, spec } of Array.from(enabledActions(registry).values())) {
    tools.push({
      type: "function",
      function: {
        name: spec.id,
        description: describe(agent, spec),
        parameters: schemaFromInput(spec.input, extras, spec.needs),
      },
    });
  }

  tools.push({
    type: "function",
    function: {
      name: ANSWER_QUESTION,
      description:
        "Use this for anything that is NOT an instruction to do work: greetings, questions, status checks " +
        '("kya update hai", "mera schedule kya hai"), thanks, small talk, and anything you are not sure about. ' +
        "It starts nothing and costs nothing, so it is always the safe answer.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "What the question is about, in a few words." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  });

  return tools;
}

/* ── Reading a tool call back ────────────────────────────────────────────────────────── */

/** Keeps only fields the action declares, with the type it declared, and drops the rest.
 *
 *  A model that answers `{ topic: 42 }` or invents a field is not an error to report to the
 *  user — it is noise to discard before it reaches an agent as a job parameter. Anything
 *  dropped that was REQUIRED shows up in `missingSlots` below, which turns it into one
 *  question instead of a guess. */
export function coerceParams(spec: BrainAction, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, decl] of Object.entries(spec.input ?? {})) {
    if (!(name in (args ?? {}))) continue;
    const value = (args as any)[name];
    if (value === null || value === undefined) continue;
    const field = fieldSchema(decl);
    if (!field) continue;
    const kind = String(field.schema.type);

    if (kind === "array") {
      const items = Array.isArray(value) ? value : [value];
      const cleaned = items.filter((v) => v !== null && v !== undefined && v !== "");
      if (cleaned.length) out[name] = cleaned;
      continue;
    }
    if (kind === "number") {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (Number.isFinite(n)) out[name] = n;
      continue;
    }
    if (kind === "boolean") {
      out[name] = value === true || value === "true";
      continue;
    }
    if (kind === "object") {
      if (typeof value === "object") out[name] = value;
      continue;
    }
    const s = String(value).trim();
    if (s) out[name] = s;
  }
  return out;
}

/** Required fields the model could not fill — the list that turns into ONE question.
 *
 *  A required field that is also one of the action's `needs` is NOT missing: the planner
 *  guarantees an earlier step produces it, so asking the user for it would be asking them for
 *  something the team is about to work out for itself. */
export function missingSlots(spec: BrainAction, params: Record<string, unknown>): string[] {
  const provided = new Set(Object.keys(params ?? {}));
  const needs = new Set((spec.needs ?? []).map(String));
  const missing: string[] = [];
  for (const [name, decl] of Object.entries(spec.input ?? {})) {
    const field = fieldSchema(decl);
    if (!field?.required) continue;
    if (provided.has(name)) continue;
    if (needs.has(name)) continue;
    missing.push(name);
  }
  return missing;
}

/* ── What the conversation model is allowed to claim ─────────────────────────────────── */

/** The registry as a fact sheet for the CONVERSATION model (plan §5.2).
 *
 *  "kya tum Instagram pe post kar sakte ho?" has exactly one honest answer and it is not the
 *  model's to invent in either direction — it is a lookup. The brain already writes this list
 *  in the customer's language (`describeCapabilities`), split into what can happen now and
 *  what cannot yet; all this adds is the instruction not to improve on it. */
export function capabilitiesPrompt(registry: BrainRegistry | null | undefined): string {
  const text = registry?.capabilities?.trim();
  if (!text) return "";
  return [
    "WHAT THE TEAM CAN AND CANNOT DO. This list is the truth, read from the team itself just now.",
    text,
    "",
    "Asked whether you can do something: answer ONLY from this list. If it is not on it, say plainly that you " +
      "cannot do it yet — never \"haan\", never a maybe, never a workaround you invented. Saying no is not a " +
      "failure; promising something that will not happen is.",
    registry?.stale
      ? "(This list may be a minute or two old — the team was restarting. Do not mention that to the user.)"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
