/** Chat -> real work. Mr Lxwa is a manager, not a ghostwriter: when the user says
 *  "write me an article", the chat must START THE TEAM (boss/keyword -> writer -> approvals),
 *  not type an article into the chat bubble. This file decides when a message is an order
 *  rather than a question.
 *
 *  Deliberately a plain matcher, not a model call: it runs before every chat reply, so it has
 *  to be instant and predictable. Anything it isn't sure about falls through to the normal
 *  conversational reply — a missed order just means the user rephrases, but a false positive
 *  would spend real LLM/DataForSEO credits on a job nobody asked for. */

export type ChatIntent =
  | { kind: "write"; topic: string | null }    // write ONE article (topic optional)
  | { kind: "research"; topic: string | null } // keywords only — explicitly NOT an article
  | { kind: "plan" }                           // "run the team" — Mr Lxwa picks the topics himself
  | null;

// "how does X work", "kya", "kaise", "?" — these are questions ABOUT the work, not orders.
const QUESTION = /^(how|what|why|when|who|which|can you|could you|do you|does|is |are |kya|kaise|kyun|kyu|kaun|batao|explain|tell me)\b|\?\s*$/i;

const WRITE_VERB = /\b(write|writing|draft|create|make|generate|publish|likh|likho|likhna|likhkar|likhe|banao|banado|bana|chahiye|chaiye)\b/i;
// Typo-tolerant on purpose: real users type "artical", "articla", "artcile". Missing one of
// those meant the message fell through to the chat model, which then cheerfully announced a
// queued draft when in fact nothing had been queued at all.
const ARTICLE_NOUN = /\b(artic\w*|artcile|artikel|blogs?|posts?|content|piece)\b/i;
const PLAN_ORDER = /\b(run the team|start the team|start team|team ko chalao|kaam shuru|start working|plan (this week|the week|content|topics)|get to work)\b/i;
// "kya update hai, article likha?" is someone checking on work already ordered. It must
// never re-queue the job — that would quietly spend the credits again and stack up
// duplicate drafts every time the user asked how it was going.
const STATUS_QUESTION = /\b(update|status|progress|kya hua|kya huwa|kiya hua|kiya huwa|ho gaya|hogaya|likha|likh diya|done|finished|ready|kahan tak|kitna hua)\b/i;

// "keyword research karke do", "sirf keyword nikalo", "find me some keywords".
const RESEARCH_NOUN = /\b(keywords?|key ?word|kw)\b/i;
const RESEARCH_VERB = /\b(research|find|nikal\w*|dhund\w*|dedo|de do|karke do|karo|do|suggest|give)\b/i;

// The bug this exists for: "ek keyword research karke do ... but artical nahi likhna" matched
// WRITE_VERB on "likhna" and ARTICLE_NOUN on "artical", so an explicit instruction NOT to
// write an article was read as an order to write one — and one got written.
//
// Matches a negation appearing shortly before a writing word, which is how it is said in both
// languages: "artical nahi likhna", "don't write the article", "article mat likho".
const NO_WRITE = new RegExp(
  [
    "\\b(?:nahi|nahin|mat|bina)\\b[^.!?]{0,40}?\\b(?:likh\\w*|banao|banana|write|writing)\\b",
    "\\b(?:don'?t|do not|no|without|never|skip)\\b[^.!?]{0,40}?\\b(?:write|writing|draft|publish)\\b",
    "\\b(?:artic\\w*|blogs?|posts?)\\b[^.!?]{0,20}?\\b(?:nahi|nahin|mat)\\b",
  ].join("|"),
  "i"
);

export function detectChatIntent(raw: string): ChatIntent {
  const q = (raw ?? "").trim();
  if (!q || q === "__hello__") return null;

  if (PLAN_ORDER.test(q)) return { kind: "plan" };

  // Checked BEFORE the write matcher. "Research the keywords but don't write anything" is a
  // real, common instruction, and treating it as an article order is the worst possible
  // reading of it — it spends the credits and produces the exact thing that was refused.
  const refusesWriting = NO_WRITE.test(q);
  const asksForKeywords = RESEARCH_NOUN.test(q) && RESEARCH_VERB.test(q);
  if (asksForKeywords && (refusesWriting || !ARTICLE_NOUN.test(q))) {
    return { kind: "research", topic: extractTopic(q) };
  }
  if (refusesWriting) return null;

  // A question about articles ("how do you write an article?") must stay a conversation.
  if (QUESTION.test(q)) return null;
  if (STATUS_QUESTION.test(q)) return null;
  if (!WRITE_VERB.test(q) || !ARTICLE_NOUN.test(q)) return null;

  return { kind: "write", topic: extractTopic(q) };
}

/** Pulls the subject out of the order, if the user gave one. No subject is fine — that's what
 *  Mr Lxwa's planner (agent-server/src/agents/boss.ts) is for: it picks topics from the
 *  tenant's own niche and crawled pages instead of us inventing one here. */
function extractTopic(q: string): string | null {
  const patterns: RegExp[] = [
    /["“”'](.{3,90}?)["“”']/,                                   // "quoted topic"
    /\b(?:about|on|regarding|related to)\s+(.{3,90})$/i,        // ... about X
    /\b(?:topic|subject)\s*[:=-]\s*(.{3,90})$/i,                // topic: X
    /^(.{3,90}?)\s+(?:pe|par|ke bare mein|ke baare mein)\s+/i,  // Hinglish: "X pe article likho"
  ];
  for (const re of patterns) {
    const m = q.match(re);
    const t = clean(m?.[1] ?? "");
    if (t) return t;
  }
  return null;
}

function clean(s: string): string {
  const t = s
    .replace(/\b(an?|the|ek|mere liye|mere liya|for me|please|plz)\b/gi, " ")
    .replace(/\b(artic\w*|artcile|artikel|blogs?|posts?|content|likho|likhna|banao|chahiye|write|karo)\b/gi, " ")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 3 ? t : "";
}
