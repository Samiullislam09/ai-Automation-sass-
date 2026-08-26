import { parseScheduleCommand, type SchedulePatch } from "@/lib/chat-schedule";

/** Chat -> real work. Mr Lxwa is a manager, not a ghostwriter: when the user says
 *  "write me an article", the chat must START THE TEAM (boss/keyword -> writer -> approvals),
 *  not type an article into the chat bubble. This file decides when a message is an order
 *  rather than a question.
 *
 *  Deliberately a plain matcher, not a model call: it runs before every chat reply, so it has
 *  to be instant and predictable. Anything it isn't sure about falls through to the normal
 *  conversational reply — a missed order just means the user rephrases, but a false positive
 *  would spend real LLM/DataForSEO credits on a job nobody asked for. */

/** WHAT was asked for. WHEN is deliberately not in here: it is read from the raw message by
 *  lib/when.ts inside startWork, which is already async and already knows the tenant's
 *  timezone. "9 baje" is a different instant in Karachi than in London, so a time resolved
 *  without the zone is worse than no time at all. */
export type ChatIntent =
  | { kind: "write"; topic: string | null }    // write ONE article (topic optional)
  | { kind: "research"; topic: string | null } // keywords only — explicitly NOT an article
  | { kind: "plan" }                           // "run the team" — Mr Lxwa picks the topics himself
  // Push something that ALREADY EXISTS live. This used to be deliberately classified as "none"
  // — "that happens on the Approvals page" — which was true right up until a customer asked
  // for it in the chat and got a fabricated confirmation instead of either the action or an
  // honest refusal.
  | { kind: "publish" }
  // Change the RECURRING timetable — "roz subah 9 baje 3 article banao", "automation band kar
  // do". The patch is parsed by lib/chat-schedule.ts and applied ON TOP of the saved row, so a
  // message that changes one field cannot silently reset the other four.
  | { kind: "schedule"; patch: SchedulePatch }
  // Call off something already booked. `which` is "all" only when they said so — cancelling
  // more than was asked for is the same class of mistake as publishing more than was asked for.
  | { kind: "cancel"; which: "next" | "all" }
  // Throw a draft away instead of publishing it.
  | { kind: "reject" }
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

// Pushing something that already exists, as opposed to making a new one. The tell is a word
// pointing AT an existing thing — "isko", "ise", "this one", "it" — with no writing verb
// anywhere near it. "ek article publish karo" makes one; "isko publish kardo" does not.
const PUBLISH_VERB = /\b(publish\w*|publsh\w*|pubish\w*|live kar\w*|upload\w*|post kar\w*)\b/i;
const POINTS_AT_EXISTING = /\b(isko|ise|iss?e|usko|use ?ko|wo wala|ye wala|yeh wala|this one|that one|it|the last one|last wala|pichhla|pichla)\b/i;
const MAKES_A_NEW_ONE = /\b(write|writing|draft|likh\w*|banao|banado|bana|naya|new|ek aur|another)\b/i;

// Calling off something already booked. Both halves are required: "cancel" on its own is what
// someone types about a subscription, an order on a shop, or a meeting — none of which this
// chat has any business touching.
//
// "mat karna" and "mat chalana" were in here and are now not. "publish mat karna" is "don't
// publish", said about something that has not happened — and it was cancelling the customer's
// next booked order, which there is no undo for. Calling something off needs a word that means
// calling something off, not a word that means "no".
const CANCEL_VERB = /\b(cancel|canncel|cancle|rad+\s*kar\w*|hata\s*do|hatado|rok\s*do|rokdo|band\s*kar\w*)\b/i;
const CANCEL_TARGET = /\b(schedule\w*|schudule\w*|booking|book\s*kiya|order|task|wo\s*wala|ye\s*wala|jo\s*book|countdown|publish\w*|artic\w*)\b/i;
const CANCEL_ALL = /\b(sab|sabhi|saare|sara|all|everything|har\s*ek)\b/i;

// Throwing a draft away. Deliberately narrow — there is no undo, and "reject" is a word people
// also use about ideas and suggestions in ordinary conversation.
const REJECT_VERB = /\b(reject|rejct|thukra\w*|delete\s*kar\w*|hata\s*do|discard|bin\s*it|scrap)\b/i;

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
    // `publish` used to be in this list and `no` used to open it, which made two different
    // instructions the same instruction. "ek article likho, no need to publish" asks for an
    // article and asks for it NOT to go live — and it came out as no article at all. Refusing
    // to publish is NO_PUBLISH's job; this pattern is only about refusing to WRITE.
    "\\b(?:don'?t|do not|without|never|skip)\\b[^.!?]{0,40}?\\b(?:write|writing|draft)\\b",
    "\\bno\\s+(?:need\\s+to\\s+)?(?:write|draft)\\b",
    "\\b(?:artic\\w*|blogs?|posts?)\\b[^.!?]{0,20}?\\b(?:nahi|nahin|mat)\\b",
  ].join("|"),
  "i"
);

export function detectChatIntent(raw: string): ChatIntent {
  const q = (raw ?? "").trim();
  if (!q || q === "__hello__") return null;

  if (PLAN_ORDER.test(q)) return { kind: "plan" };

  // ---- Settings changes, checked BEFORE the question guard ----
  //
  // These three are polite by nature — "kya automation band kar sakte ho?", "ye cancel kar
  // doge?" — and QUESTION below drops anything ending in a question mark. Left after it, the
  // most natural way to ask for them was also the one way that never worked.
  //
  // Each parser carries its own proof that an instruction was actually given, so a genuine
  // question about the same subject still falls through: parseScheduleCommand needs an on/off
  // word or a setting verb and returns null for "mera schedule kya hai", and the two below
  // need an explicit cancel/reject verb.
  const schedulePatch = parseScheduleCommand(q);
  if (schedulePatch) return { kind: "schedule", patch: schedulePatch };

  if (CANCEL_VERB.test(q) && CANCEL_TARGET.test(q) && !MAKES_A_NEW_ONE.test(q)) {
    return { kind: "cancel", which: CANCEL_ALL.test(q) ? "all" : "next" };
  }

  if (REJECT_VERB.test(q) && (POINTS_AT_EXISTING.test(q) || ARTICLE_NOUN.test(q))) {
    return { kind: "reject" };
  }

  // A question about articles ("how do you write an article?") must stay a conversation.
  if (QUESTION.test(q)) return null;
  if (STATUS_QUESTION.test(q)) return null;

  // Wanting an article means a WRITING word aimed at an article — not merely mentioning one.
  // "keyword nikal ke do for the next article" mentions an article and asks for nothing to be
  // written; requiring only ARTICLE_NOUN made that fall through to conversation, and Mr Lxwa
  // answered "main team ko order nahi de sakta" to a perfectly clear instruction.
  const refusesWriting = NO_WRITE.test(q);

  // Publish-what-exists is checked BEFORE writing, because "isko publish kar do" satisfies the
  // writing test on its own: WRITE_VERB lists "publish". That is how "no mujhe 30 min bad
  // published karna ha isko" — a plain instruction about the article that had just been
  // written — came through as an order to write another one.
  if (PUBLISH_VERB.test(q) && POINTS_AT_EXISTING.test(q) && !MAKES_A_NEW_ONE.test(q)) {
    return { kind: "publish" };
  }

  const wantsWriting = !refusesWriting && WRITE_VERB.test(q) && ARTICLE_NOUN.test(q);
  const asksForKeywords = RESEARCH_NOUN.test(q) && RESEARCH_VERB.test(q);

  // Research wins whenever keywords were asked for and nothing was asked to be written.
  // "keyword nikalo aur article bhi likho" asks for both, and the write path does both.
  if (asksForKeywords && !wantsWriting) return { kind: "research", topic: extractTopic(q) };
  if (!wantsWriting) return null;

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
  return isRealTopic(t) ? t : "";
}

/** A subject the keyword agent can actually research.
 *
 *  Guards two separate ways of ending up with nonsense. The literal string "null" is what a
 *  language model writes when it means the JSON value — it went straight through a length
 *  check, was handed to Mr. Keyword as a seed, and the customer watched their team spend real
 *  DataForSEO credits "Researching "null"" and offer eight keywords for it. The rest is the
 *  sentence-fragment case: "mujhe 30mmin bad ko apne webiset" is what survives cleaning a
 *  message that never named a subject, and researching it is no better.
 *
 *  Null is the honest answer to "what is this about?" when the answer is nothing. The boss
 *  agent picks a topic from the tenant's own niche in exactly that case. */
export function isRealTopic(t: string): boolean {
  const v = t.trim();
  if (v.length < 3 || v.length > 120) return false;
  if (/^(?:null|none|undefined|nil|nan|n\/?a|-+|\?+)$/i.test(v)) return false;
  // A subject is nouns. A message with a clock in it and pronouns around it is the request,
  // not the subject — and seeding research with the request is the bug this catches.
  if (/\d{1,4}\s*(?:m+in\w*|hours?|hrs?|ghant\w*|din|days?)\b/i.test(v)) return false;
  if (/\b(?:mujhe|mereko|mujhko|tum|aap|main|hume|humein|i|me|you|we)\b/i.test(v)) return false;
  // Needs at least one word of three letters or more that isn't a number.
  return /[\p{L}]{3,}/u.test(v);
}

/** Did the same sentence also ask for it to go live?
 *
 *  Separate from the intent because it is an ADJECTIVE on the order, not a different order:
 *  "ek article likh ke publish kar do" is one instruction with two halves, and reading it as
 *  either half alone loses the customer's actual meaning. Kept here, next to the patterns it
 *  shares, so there is one place where "publish" is defined. */
export function wantsAutoPublish(raw: string): boolean {
  const q = (raw ?? "").trim();
  if (!q) return false;
  if (NO_PUBLISH.test(q)) return false;
  return PUBLISH_VERB.test(q);
}

// "publish mat karna", "don't publish it", "sirf draft banao" — the opposite instruction, and
// it has to win. Publishing to a live website is the one action in this product that cannot be
// taken back, so an unclear sentence must never resolve towards doing it.
const NO_PUBLISH = new RegExp(
  [
    "\\b(?:nahi|nahin|mat|bina)\\b[^.!?]{0,40}?\\b(?:publish\\w*|live)\\b",
    "\\b(?:publish\\w*|live)\\b[^.!?]{0,20}?\\b(?:nahi|nahin|mat)\\b",
    // "no" is NOT in this list, and that is the whole point of the note. A user correcting
    // themselves opens with it — "no mujhe 30 min bad published karna ha isko" is "no, I meant
    // thirty minutes later", not "do not publish". Reading it as a refusal made the one message
    // in the transcript that most clearly asked to publish come out as asking not to. The
    // explicit "no publish" / "no need to publish" forms are matched on the next line instead.
    "\\b(?:don'?t|do not|without|never|skip|not)\\b[^.!?]{0,40}?\\bpublish\\w*",
    "\\bno\\s+(?:need\\s+to\\s+)?publish\\w*",
    "\\b(?:sirf|only|just)\\b[^.!?]{0,20}?\\b(?:draft|likh\\w*|write)\\b",
    "\\b(?:approval|approve|review)\\b[^.!?]{0,20}?\\b(?:ke liye|for|me|mein)\\b",
  ].join("|"),
  "i"
);
