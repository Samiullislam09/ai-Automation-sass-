/** Names a chat from what it is about, the way a person would label a folder.
 *
 *  A chat used to be named with the first 80 characters of its first message, so a conversation
 *  that opened with "hi" or "ho" was called "hi" or "ho" forever. Now:
 *   - a greeting or a throwaway word names nothing (the title is left empty), so the next real
 *     request names the chat instead;
 *   - a request that is clearly an article / keyword / lead / schedule / audit job is named for
 *     the job, with the topic when one was given ("Article: ISO 9001 certification cost");
 *   - anything else becomes a short, tidy sentence-case title.
 *  Works on English and Hinglish, because that is how this product is used. */

const GREETING = /^(h+i+|he+l+o+|hlo+|hey+|hy|yo|ok+|okay|ho|hm+|haan|han|test|testing|thanks?|thx|\?+|\.+|!+)$/i;
const FILLER = /^(?:(?:please|plz|pls|kindly|can you|could you|would you|will you|hey|hi|hello|helo|hlo|ok|okay|mujhe|mere liye|ek)\b[\s,!.:-]*)+/i;

const JOBS: { test: RegExp; label: string; topic?: boolean }[] = [
  // first: "schedule a post" is a scheduling job, not an article job
  { test: /\b(schedule|remind|booking|book)\b/i, label: "Scheduling" },
  // "article", "artical" and the other spellings people type
  { test: /\b(art[a-z]{0,3}(?:cle|cal)|blog|post)\b/i, label: "Article", topic: true },
  { test: /\bkeyword/i, label: "Keyword research", topic: true },
  { test: /\blead/i, label: "Lead generation", topic: true },
  { test: /\baudit\b/i, label: "Site audit" },
  { test: /\bwhats?app\b/i, label: "WhatsApp" },
  { test: /\b(image|picture|photo|thumbnail)\b/i, label: "Image", topic: true },
  { test: /\b(publish|approve|approval)\b/i, label: "Publishing" },
];

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s"'“”‘’`*_#>-]+|[\s"'“”‘’`*_?!.,:;-]+$/g, "").trim();
}

function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:-]+$/, "")}…`;
}

/** True for a title that tells you nothing ("hi", "ho", "ok", empty). */
export function isWeakTitle(title: string | null | undefined): boolean {
  const t = tidy(title ?? "");
  if (t.length < 4) return true;
  if (GREETING.test(t)) return true;
  return false;
}

/** The title for a chat's first real message, or null when the message names nothing yet. */
export function chatTitle(question: string): string | null {
  let q = tidy(question);
  if (!q || GREETING.test(q)) return null;

  q = tidy(q.replace(FILLER, ""));
  if (q.length < 4 || GREETING.test(q)) return null;

  for (const job of JOBS) {
    if (!job.test.test(q)) continue;
    if (!job.topic) return job.label;
    // "write an article about X", "article on X", "keywords for X"
    const m = q.match(/\b(?:about|on|for|regarding|ke bare mein|ke baare mein|par)\s+(.{3,})$/i);
    const topic = m ? tidy(m[1]!.replace(/^(?:my|our|the|a|an|mere|meri)\s+/i, "")) : "";
    if (topic && !/^(website|site|business|company|blog)$/i.test(topic)) return `${job.label}: ${clip(sentenceCase(topic), 46)}`;
    return job.label === "Article" ? "New article" : job.label;
  }
  return clip(sentenceCase(q), 52);
}

/** What the history list shows for a stored title (older chats were named by their first word). */
export function displayChatTitle(title: string | null | undefined): string {
  if (isWeakTitle(title)) return "Quick chat";
  return clip(sentenceCase(tidy(title ?? "")), 60);
}
