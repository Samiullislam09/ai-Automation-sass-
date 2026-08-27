/** The label schema for the chat intent evaluation set (rebuild plan §16, "eval-driven intent").
 *
 *  Every real user message in `chat_messages` gets one of these, first from the model
 *  (`intent_eval.auto_label`, written by scripts/label-intents.mjs) and then from a person
 *  (`intent_eval.human_label`, written from /app/eval). The human column is the truth the next
 *  intent engine is scored against — see lib/eval/README.md for the gate.
 *
 *  The intents are the brain's manifest actions (docs/MASTER_PLAN.html §5.1) plus the three
 *  things that are not actions but the router still has to tell apart: a question, small talk,
 *  and a follow-up to something Mr Lxwa just asked.
 */

export const INTENTS = [
  "write_article",   // write ONE (or N) new article(s) now — includes "write and publish"
  "find_keywords",   // keyword / topic research only, explicitly NOT an article
  "plan_topics",     // "run the team", "is hafte ka content shuru karo" — no specific topic
  "publish",         // push something that ALREADY EXISTS live ("isko publish kar do")
  "schedule",        // change the recurring timetable ("roz 9 baje", "automation band kar do")
  "cancel",          // call off a booked order or the next run
  "reject",          // throw a draft away instead of publishing it
  "status",          // "kya update hai", "article likha?", "kitne bache hain" — checking on work
  "connect",         // connect / change the website, WordPress, Google, integrations
  "question",        // a question about the product, SEO, pricing, how things work
  "chitchat",        // greeting, thanks, small talk, testing the box
  "followup",        // ONLY the answer to Mr Lxwa's previous question ("haan", "mat karna", "pehla wala")
  "other",           // in scope of nothing above and not chitchat (a pasted URL, gibberish, a rant)
] as const;

export type Intent = (typeof INTENTS)[number];

export const DELIVERIES = ["approvals", "publish", "chat"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export const FOLLOWUP_KINDS = ["confirm", "deny", "choose", "change"] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export type IntentLabel = {
  intent: Intent;
  /** The SUBJECT only ("solar panels for homes"), never the request ("best keywords for my blog"). */
  topic?: string | null;
  /** Where the result should go. "approvals" = draft to review, "publish" = straight to the site,
   *  "chat" = an answer in the conversation (keywords, a brief). Null when the message says nothing. */
  delivery?: Delivery | null;
  /** The time phrase as written ("30 min baad", "kal 9 baje"), NOT parsed — lib/when.ts parses. */
  when?: string | null;
  /** True when the message only makes sense as a reply to the assistant's previous turn. */
  is_followup: boolean;
  /** confirm = "haan", "yes do it"; deny = "nahi", "mat karna"; choose = picking an option
   *  ("pehla wala", "2"); change = "nahi, solar ki jagah wind pe". */
  followup_kind?: FollowupKind | null;
  /** True when a reasonable person could read the message two ways. Ambiguous rows are still
   *  scored, but the README says how they count. */
  ambiguous: boolean;
  notes?: string;
};

/** The same schema, as text, for the labelling prompt. Kept next to the type so the two
 *  cannot drift apart without someone noticing. */
export const LABEL_SCHEMA_TEXT = `{
  "intent": ${INTENTS.map((i) => `"${i}"`).join(" | ")},
  "topic": string | null,
  "delivery": "approvals" | "publish" | "chat" | null,
  "when": string | null,
  "is_followup": boolean,
  "followup_kind": "confirm" | "deny" | "choose" | "change" | null,
  "ambiguous": boolean,
  "notes": string
}`;

export function isIntent(v: unknown): v is Intent {
  return typeof v === "string" && (INTENTS as readonly string[]).includes(v);
}

/** Coerce anything the model or a form handed us into a valid label, or null if it is not one. */
export function normalizeLabel(raw: any): IntentLabel | null {
  if (!raw || typeof raw !== "object" || !isIntent(raw.intent)) return null;
  const str = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s && s.toLowerCase() !== "null" ? s.slice(0, 200) : null;
  };
  const delivery = (DELIVERIES as readonly string[]).includes(raw.delivery) ? (raw.delivery as Delivery) : null;
  const followup_kind = (FOLLOWUP_KINDS as readonly string[]).includes(raw.followup_kind) ? (raw.followup_kind as FollowupKind) : null;
  return {
    intent: raw.intent,
    topic: str(raw.topic),
    delivery,
    when: str(raw.when),
    is_followup: raw.is_followup === true || raw.intent === "followup",
    followup_kind,
    ambiguous: raw.ambiguous === true,
    notes: str(raw.notes) ?? "",
  };
}
