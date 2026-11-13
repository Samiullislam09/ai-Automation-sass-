/** Phase 1 (WhatsApp reply quality) — what we can KNOW about a conversation without asking a model.
 *
 *  Everything here is a pure function of the transcript: no database, no clock, no network. That is
 *  deliberate. Three things the model used to be left to guess — which language the customer is
 *  writing in, what they are actually asking for, and whether a person has to step in — are cheap to
 *  establish deterministically, and when the model gets them wrong the customer notices at once
 *  (replying in English to someone typing Hinglish; dodging a price question; promising a document
 *  nobody can send). So they are computed here, handed to the model as FACTS it must respect, and the
 *  escalation rules are enforced in code afterwards rather than trusted to the model's mood.
 *
 *  Found in the client chat of 2026-11-13: three price questions never answered, "kaha chale jate ho?"
 *  answered with a stock apology, and no owner alert anywhere. */

export type Lang = "en" | "hinglish" | "hi" | "ur";

export type Msg = { direction: "in" | "out"; body: string; created_at?: string | null };

/* ── language ────────────────────────────────────────────────────────────────────────────── */

/** Roman-script Hindi/Urdu words that are NOT also ordinary English words. "main", "do", "me", "to"
 *  are left out on purpose — they would make plain English look like Hinglish. */
const HINGLISH = new Set([
  "hai", "hain", "hoga", "hogi", "tha", "thi", "kya", "kaise", "kaisa", "kab", "kitna", "kitne", "kitni", "kyun", "kyu", "kiyun", "kiyoun",
  "kahan", "kaha", "kaun", "kon", "nahi", "nahin", "nhi", "mujhe", "mujhko", "mera", "meri", "mere", "aap", "aapka", "aapki", "aapke", "tum",
  "tumhara", "tumhare", "hum", "humara", "humein", "bhej", "bhejo", "bhejna", "batao", "bata", "batana", "karo", "karna", "karke", "kare", "kar",
  "chahiye", "chahie", "chahta", "chahti", "jaldi", "abhi", "theek", "thik", "acha", "accha", "achha", "haan", "han", "ji", "bhai", "yaha", "yahan",
  "wahan", "wala", "wali", "wale", "matlab", "bilkul", "samajh", "samjha", "paise", "rupay", "rupaye", "zyada", "kitna", "itna", "itne", "bahut",
  "bohot", "lekin", "magar", "aur", "ya", "toh", "bhi", "sirf", "sab", "kuch", "koi", "dena", "lena", "dedo", "dijiye", "kijiye", "bolo", "boliye",
  "dekho", "dekhiye", "milega", "milegi", "hoon", "hu", "ho", "chale", "jate", "jata", "raha", "rahi", "rahe", "pe", "ka", "ki", "ke", "ko", "se",
  "mein", "ne", "kal", "aaj", "pehle", "baad", "phir", "fir", "bas", "sahi", "galat", "dikhao", "dikha", "samay", "waqt", "der", "jawab", "jawaab",
]);
/** Of those, the ones short enough to appear in English by accident ("ka", "ke", "se", "pe", "ho", "ya",
 *  "ji") count for less: they only help once something stronger is already there. */
const WEAK = new Set(["pe", "ka", "ki", "ke", "ko", "se", "ho", "ya", "ji", "ne", "han", "hu", "ye", "wo", "aur", "bhi", "sab", "kar", "to"]);

const DEVANAGARI = /[ऀ-ॿ]/g;
const ARABIC = /[؀-ۿݐ-ݿ]/g;

function tokens(text: string): string[] {
  return String(text).toLowerCase().replace(/['’]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** Classify ONE message. Returns null when it says too little to tell (an "ok", an emoji, a
 *  "[Voice message]" placeholder) — the caller then looks at an earlier message. */
export function classifyLanguage(text: string): Lang | null {
  const t = String(text ?? "").trim();
  if (!t || t.startsWith("[")) return null;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (!letters) return null;
  const dev = (t.match(DEVANAGARI) ?? []).length;
  const ara = (t.match(ARABIC) ?? []).length;
  if (dev / letters.length > 0.3) return "hi";
  if (ara / letters.length > 0.3) return "ur";

  const toks = tokens(t);
  if (toks.length < 2) return null;
  let strong = 0, weak = 0;
  for (const w of toks) {
    if (!HINGLISH.has(w)) continue;
    if (WEAK.has(w)) weak++; else strong++;
  }
  // Two real Hindi words, or one real word plus the function words around it, is Hinglish; a lone
  // "ji" or "ho" in an English sentence is not.
  if (strong >= 2 || (strong >= 1 && weak >= 1 && toks.length <= 8) || strong / toks.length >= 0.25) return "hinglish";
  return "en";
}

/** The language to answer in: that of the customer's MOST RECENT message that says enough to tell.
 *  "Ok" / a thumbs-up / a voice-note placeholder never flips it. Defaults to English. */
export function detectLanguage(thread: Msg[]): Lang {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].direction !== "in") continue;
    const l = classifyLanguage(thread[i].body);
    if (l) return l;
  }
  return "en";
}

export const LANG_INSTRUCTION: Record<Lang, string> = {
  en: "Write in simple, natural English.",
  hinglish: "The customer types HINGLISH, so your reply MUST be Hinglish too — Hindi written in ROMAN letters mixed with common English words, exactly as they type. Not plain English, not Devanagari, not formal Hindi. Example of the register: \"Samajh gaya — ISO 9001 mein usually 3-4 mahine lagte hain. Aapki company mein kitne log hain?\"",
  hi: "Write in Hindi, in Devanagari script, simple everyday words.",
  ur: "Write in Urdu in the same script they used (Roman Urdu if they type in Roman letters). Keep it simple and respectful.",
};

/* ── what they are asking for ───────────────────────────────────────────────────────────── */

export type Signals = {
  price: boolean;
  /** Wants details / a document: an outline, brochure, proposal, "send me…". */
  details: boolean;
  /** Names a document we cannot attach (outline, brochure, proposal, pdf, deck, quote). */
  document: boolean;
  /** Complaining about how long we take to answer. */
  delayComplaint: boolean;
  whoAreYou: boolean;
  /** Asking whether they are talking to a bot / a human. */
  botQuestion: boolean;
  angry: boolean;
  wantsCall: boolean;
};

const norm = (t: string) => ` ${String(t).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9ऀ-ॿ؀-ۿ\s]/g, " ").replace(/\s+/g, " ")} `;
const has = (t: string, words: string[]) => words.some((w) => t.includes(` ${w} `));
const hasAny = (t: string, re: RegExp) => re.test(t);

/** Read the signals off ONE customer message (the latest). Deliberately generous on the verbs and
 *  strict on the nouns: a false "price" only means the model is told to lead with the price. */
export function detectSignals(text: string): Signals {
  const t = norm(text);
  const price =
    has(t, ["price", "prices", "pricing", "cost", "costs", "rate", "rates", "fee", "fees", "charge", "charges", "quote", "quotation", "budget", "kimat", "keemat", "daam", "paise", "rupay", "rupaye", "rs", "aed", "inr"]) ||
    hasAny(t, /\bhow much\b|\bkitna (lagega|hoga|paisa)\b|\bkitne (ka|paise|rupay)\b|कीमत|दाम|कितना|कितने|रेट|फीस/);
  const document = has(t, ["outline", "brochure", "proposal", "pdf", "deck", "catalog", "catalogue", "profile", "presentation", "document", "documents", "quotation"]);
  const details =
    document ||
    has(t, ["details", "detail", "information", "info", "scope", "timeline", "jankari", "bhejo", "bhej do", "send"]) ||
    hasAny(t, /\bsend me\b|\bshare (it|the|your)\b|\btell me (more|about)\b|\bgive me (some )?(info|details)\b|जानकारी|भेजो/);
  const delayComplaint = hasAny(t, /\b(why|kyun|kiyun|kiyoun)\b.*\b(late|slow|time|der|delay|wait)\b|\bkaha(n)? chale\b|\bder (kyun|kiyun|kiyoun)\b|\bitna (time|der)\b|\bno reply\b|\bnot replying\b|\bignoring\b|\bwaiting\b|\breply (pe|par).*(time|der)\b|\bslow\b/);
  const whoAreYou = hasAny(t, /\bwho (are|r) (you|u)\b|\bwho is this\b|\b(aap|tum|ap) (kaun|kon)\b|\bkaun ho\b|\bkon ho\b|कौन/);
  const botQuestion = hasAny(t, /\bare (you|u) (a |an )?(bot|ai|robot|human|real|machine|chatgpt)\b|\bis this (a |an )?(bot|ai|automated)\b|\b(bot|robot) (ho|hai)\b|\breal (person|insaan|human)\b/);
  const angry = has(t, ["scam", "fraud", "cheat", "cheating", "spam", "stupid", "useless", "waste", "bakwas", "bakwaas", "bekar", "idiot", "nonsense", "worst", "harass", "harassing", "irritating", "annoying", "pagal", "fake"]) || hasAny(t, /\b(report|block|complain)\b.*\b(you|u|this|number)\b|\b(irritate|irritated|annoyed|frustrated)\b/);
  const wantsCall = hasAny(t, /\bcall me\b|\b(call|phone) (karo|kar do|kijiye)\b|\bcan we (talk|speak|call)\b|\btalk to (someone|a person|your)\b|\bspeak (to|with)\b|\bhuman agent\b|\bbaat karni\b/);
  return { price, details, document, delayComplaint, whoAreYou, botQuestion, angry, wantsCall };
}

/* ── where the conversation is ──────────────────────────────────────────────────────────── */

export type Stage = "first_reply" | "returning" | "engaged";

/** first_reply: their first answer to our opener. returning: they went quiet for a day or more and are
 *  back. engaged: mid-conversation. */
export function conversationStage(thread: Msg[]): Stage {
  const inbound = thread.filter((m) => m.direction === "in");
  if (inbound.length <= 1) return "first_reply";
  const n = thread.length;
  const last = thread[n - 1];
  const prev = thread[n - 2];
  if (last?.created_at && prev?.created_at) {
    const gapH = (Date.parse(last.created_at) - Date.parse(prev.created_at)) / 3_600_000;
    if (Number.isFinite(gapH) && gapH >= 24 && last.direction === "in") return "returning";
  }
  return "engaged";
}

export const STAGE_GUIDE: Record<Stage, string> = {
  first_reply:
    "This is their FIRST reply to our opening message. Make it count: answer what they actually said, say in one line what we do and why it matters to THEM, then ask ONE question to understand their need.",
  returning:
    "They had gone quiet and are now back. Welcome them back in a few words (no guilt, no 'finally'), then answer what they asked.",
  engaged:
    "You are mid-conversation. Continue naturally and move one step closer to a decision: the next qualifying question, a concrete detail, or a quick call — never a generic blurb.",
};

/* ── escalation, enforced in code ───────────────────────────────────────────────────────── */

/** Should a person be pulled in, whatever the model said? True for: an angry customer, a complaint
 *  about our slowness, a request for a document we cannot send, and a price question when we hold no
 *  pricing. The model's own `handoff` flag is honoured too (decide.ts); this is the floor under it. */
export function mustHandOff(s: Signals, pricingProvided: boolean): { yes: boolean; reason: string } {
  if (s.angry) return { yes: true, reason: "customer sounds upset" };
  if (s.delayComplaint) return { yes: true, reason: "customer complained about slow replies" };
  if (s.wantsCall) return { yes: true, reason: "customer wants to talk to a person" };
  if (s.document) return { yes: true, reason: "asked for a document the assistant cannot send" };
  if (s.price && !pricingProvided) return { yes: true, reason: "asked for the price — none is set" };
  return { yes: false, reason: "" };
}

/** The facts line handed to the model. Only signals that are TRUE are mentioned. */
/** What the customer is told when the assistant genuinely cannot produce an answer in time (the
 *  model timed out or failed). It promises ONLY what is then made true: autoReply.ts flags the lead
 *  "needs you" and alerts the owner in the same breath, so "a team member will get back to you" is
 *  a promise somebody has actually been asked to keep. Sent at most once per silence — never a
 *  second time to the same unanswered customer. */
export const HOLDING: Record<Lang, string> = {
  en: "Thanks for your message — a team member will get back to you shortly.",
  hinglish: "Aapka message mil gaya — hamari team ka member jaldi aapko jawab dega.",
  hi: "आपका संदेश मिल गया — हमारी टीम का सदस्य जल्द ही आपको जवाब देगा।",
  ur: "Aapka paigham mil gaya — hamari team ka member jald aap ko jawab dega.",
};

const APOLOGY: Record<Lang, string> = {
  en: "Sorry for the wait.",
  hinglish: "Sorry, der ho gayi.",
  hi: "माफ़ कीजिए, देर हो गई।",
  ur: "Maazrat, der ho gayi.",
};

export function signalsBrief(s: Signals, pricingProvided: boolean, lang: Lang = "en"): string[] {
  const out: string[] = [];
  if (s.whoAreYou) out.push("They are asking WHO YOU ARE — follow the 'who you are' rule.");
  if (s.botQuestion) out.push("They are asking whether you are a bot/AI — answer honestly (you are the team's AI assistant; a person can join any time).");
  if (s.price) out.push(pricingProvided
    ? "They are asking about PRICE — state the pricing from the facts in your FIRST sentence."
    : "They are asking about PRICE and no pricing was given to you — say honestly it depends on their situation, ask the ONE detail you need, and say a team member will send the exact figure. Set handoff true.");
  if (s.document) out.push("They want a DOCUMENT (outline/brochure/proposal). You cannot attach files: give the useful content in 2-4 short lines now and say a team member will share the full document. Set handoff true.");
  else if (s.details) out.push("They want DETAILS — give real content now, in this message.");
  if (s.delayComplaint) out.push(`They are complaining about slow replies — open with exactly this apology, in their language: "${APOLOGY[lang]}" — then, in the SAME language, answer their actual question in the same message. Set handoff true.`);
  if (s.angry) out.push("They sound UPSET — be human and calm, acknowledge it in one line, solve the actual problem. Set handoff true.");
  if (s.wantsCall) out.push("They want to TALK to a person — say a team member will contact them, ask for the best time. Set handoff true.");
  return out;
}
