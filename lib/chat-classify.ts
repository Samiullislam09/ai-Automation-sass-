import "@/lib/dns-fix";
import { isRealTopic, type ChatIntent } from "@/lib/chat-intent";

/** What the user actually asked for, decided by the model instead of by a regex.
 *
 *  WHY THIS EXISTS. The chat's entry point was a hand-written matcher: a list of writing
 *  verbs, a list of article nouns, a negation pattern. Every new phrasing was a new bug, and
 *  we shipped three in a row — "artical nahi likhna" read as an order to write, "keyword
 *  nikal ke do for the next article" read as nothing at all. That is not a matcher that needs
 *  more patterns; it is the wrong tool for free-form human instructions in two languages.
 *
 *  The matcher stays as the fast path — it is instant, free, and right about the obvious
 *  cases. This runs only when the matcher is unsure, which is exactly where it was wrong.
 *
 *  BIAS TOWARDS DOING NOTHING. A missed order costs one rephrase. A wrong "write" spends the
 *  customer's credits producing something they didn't ask for — which is the specific failure
 *  that prompted this. So the prompt says to answer "none" when unsure, anything unexpected
 *  in the response is treated as "none", and a failed call is "none" too.
 */

const TIMEOUT_MS = 12_000;

// Don't spend a model call on "hi" or "thanks". Only messages that mention the work at all
// can possibly be an instruction about it.
const MIGHT_BE_AN_ORDER =
  /\b(keywords?|artic\w*|blogs?|posts?|content|topics?|seo|research|write|writing|draft|likh\w*|nikal\w*|dhund\w*|banao|plan|publish)\b/i;

/** Exported so the chat route can decide whether an extra model call is even on the table
 *  BEFORE it commits to awaiting one. The route now starts its database reads first and only
 *  blocks on the classifier for messages that mention the work at all — for "hi hello" the
 *  classifier was never going to run, and it should not be sitting in the critical path
 *  pretending it might. */
export function mightBeAnOrder(message: unknown): boolean {
  const q = String(message ?? "").trim();
  return !!q && q.length <= 600 && MIGHT_BE_AN_ORDER.test(q);
}

const RULES = [
  '"write" — they want an article written now.',
  '"research" — they want keyword or topic research, but NOT an article written. Asking for keywords FOR an article is research, unless they also ask for the article itself.',
  '"plan" — they want the team to start on this week\'s content in general, with no specific topic.',
  '"publish" — they want an article that ALREADY EXISTS pushed live ("isko publish kar do", "publish the last one"). Nothing new is written.',
  '"none" — anything else: a question, a status check ("kya update hai"), small talk, or an instruction you are not sure about.',
];

// Generic words that describe the REQUEST rather than the subject. A model asked for "the
// topic" will happily echo "best keywords for my next blog post", and handing that to the
// keyword agent as a seed researches the phrasing instead of the business.
const FILLER = /\b(?:best|good|top|new|next|some|any|my|our|the|an?|for|about|on|please|keywords?|key ?word|artic\w*|blogs?|posts?|content|topics?|research|write|writing|likh\w*|nikal\w*)\b/gi;

function cleanTopic(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (v.length < 3) return null;
  // A model told to "use null" writes the WORD null about as often as it emits the JSON value,
  // and `String("null")` is four perfectly valid characters. This is not hypothetical: it
  // shipped, Mr. Keyword was handed "null" as a seed, and the customer watched their team
  // research it and come back with eight keywords for nothing. isRealTopic also throws out the
  // other shape of the same mistake — the model echoing the request back as the subject.
  if (!isRealTopic(v)) return null;
  // If nothing but filler is left, they never actually named a subject — say so with null
  // rather than seeding research with the sentence they typed.
  const residue = v.replace(FILLER, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  if (residue.length < 3) return null;
  return v.slice(0, 120);
}

export async function classifyIntent(message: string, history: { role: string; content: string }[] = []): Promise<ChatIntent> {
  const q = String(message ?? "").trim();
  if (!q || q.length > 600 || !MIGHT_BE_AN_ORDER.test(q)) return null;

  const key = process.env.NVIDIA_API_KEY;
  if (!key) return null;

  // One prior turn, for messages that lean on it ("haan wahi likh do"). More than that and
  // an old order starts pulling the classification towards itself.
  const prior = history.slice(-2).map((t) => `${t.role === "user" ? "User" : "Mr Lxwa"}: ${t.content.slice(0, 200)}`).join("\n");

  const prompt = [
    "Classify what the user is asking their AI marketing team to do.",
    "",
    prior ? `Previous turn:\n${prior}\n` : "",
    `User's message: ${q}`,
    "",
    `Actions:\n${RULES.map((r) => `- ${r}`).join("\n")}`,
    "",
    "Rules:",
    "- Negation decides everything. \"article nahi likhna\", \"don't write it\", \"mat likho\" is never \"write\".",
    "- The message may be English, Hinglish or Roman Urdu.",
    "- topic: ONLY the subject matter, e.g. \"ISO 9001 certification\" or \"local SEO\". Never the whole sentence, and never words like article, blog, post, keyword or content. If they named no subject, use null.",
    "- Asking to publish something that already exists is \"publish\", not \"write\" and not \"none\". Writing a NEW article and publishing it is \"write\".",
    "- A time in the message (\"30 min baad\", \"kal 9 baje\") does NOT change the action. It is read separately. Classify what they want done, not when.",
    "- When unsure, answer \"none\". Starting work nobody asked for costs the customer money.",
    "",
    'Reply with ONLY JSON: {"action":"write"|"research"|"plan"|"publish"|"none","topic":"..."|null}. For topic use the JSON value null, never the text "null".',
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        stream: false,
        chat_template_kwargs: { thinking: false },
        // Classification, not prose. A low temperature keeps the same sentence classified the
        // same way twice, which matters when the answer spends money.
        temperature: 0,
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const json = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));

    const topic = cleanTopic(parsed?.topic);
    switch (parsed?.action) {
      case "write": return { kind: "write", topic };
      case "research": return { kind: "research", topic };
      case "plan": return { kind: "plan" };
      case "publish": return { kind: "publish" };
      default: return null; // includes "none" and anything unexpected
    }
  } catch (e: any) {
    // Unreachable, slow, or unparseable — fall through to a normal conversational reply
    // rather than guessing at an action.
    console.error("[chat-classify] falling back to conversation:", e?.message);
    return null;
  }
}
