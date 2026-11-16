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
  "bohot", "lekin", "magar", "aur", "ya", "toh", "bhi", "karte", "karta", "karti", "karein", "kiya", "kiye", "karenge", "milta", "milti", "milte", "lagta", "lagti", "lagega", "lagegi", "dekha", "dekh", "dekhna", "hota", "hoti", "hote", "sakte", "sakta", "sakti", "waise", "isliye", "kyunki", "mehnga", "sasta", "zaroor", "pata", "chal", "chalega", "chalegi", "sirf", "sab", "kuch", "koi", "dena", "lena", "dedo", "dijiye", "kijiye", "bolo", "boliye",
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
  // The customer's last few messages that say enough to classify, newest first.
  const recent: Lang[] = [];
  for (let i = thread.length - 1; i >= 0 && recent.length < 3; i--) {
    if (thread[i].direction !== "in") continue;
    const l = classifyLanguage(thread[i].body);
    if (l) recent.push(l);
  }
  if (!recent.length) return "en";
  const [latest, ...before] = recent;
  // STICKY: a short English-looking line ("aur ISO 27001 bhi karte ho?") from someone who has been
  // writing Hinglish is still Hinglish — a few English nouns in a Hindi sentence do not make it
  // English, and switching language mid-chat reads as a different person (live sim, 2026-11-14).
  if (latest === "en" && before.length && before.filter((l) => l === "hinglish").length >= Math.ceil(before.length / 2)) {
    const last = [...thread].reverse().find((m) => m.direction === "in" && classifyLanguage(m.body));
    if (last && String(last.body).trim().split(/\s+/).length <= 7) return "hinglish";
  }
  return latest;
}

export const LANG_INSTRUCTION: Record<Lang, string> = {
  en: "Reply in the SAME language the customer's last message is written in. English if they wrote English — but if they wrote another language (Spanish, French, Arabic, Bengali, Tamil, anything), answer in THAT language, in simple natural words. Never switch the customer to English.",
  hinglish: "The customer types HINGLISH, so your reply MUST be Hinglish too — Hindi written in ROMAN letters mixed with common English words, exactly as they type. Not plain English, not Devanagari, not formal Hindi. Example of the register: \"Samajh gaya — ISO 9001 mein usually 3-4 mahine lagte hain. Aapki company mein kitne log hain?\"",
  hi: "Write in Hindi, in Devanagari script, simple everyday words.",
  ur: "Write in the same language and script the customer used (Urdu, Arabic, Persian — Roman Urdu if they type in Roman letters). Keep it simple and respectful.",
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
export function mustHandOff(s: Signals, pricingProvided: boolean, unverified: string[] = [], detailGaps: string[] = []): { yes: boolean; reason: string } {
  if (s.angry) return { yes: true, reason: "customer sounds upset" };
  if (s.delayComplaint) return { yes: true, reason: "customer complained about slow replies" };
  if (s.wantsCall) return { yes: true, reason: "customer wants to talk to a person" };
  if (s.document) return { yes: true, reason: "asked for a document the assistant cannot send" };
  if (s.price && !pricingProvided) return { yes: true, reason: "asked for the price — none is set" };
  if (unverified.length) return { yes: true, reason: `asked about ${unverified.join(", ")} — nothing in our facts about it` };
  if (detailGaps.length) return { yes: true, reason: `asked for ${detailGaps.join(", ")} — not in our facts` };
  return { yes: false, reason: "" };
}

/** A reply that tells the customer what we do NOT do or cover ("we don't offer X", "X isn't one of the
 *  standards we cover"). Returns a short description of the claim, or null. Such a statement is only
 *  safe when the facts say so in so many words, and a model that has seen a list of offerings tends to
 *  treat a missing item as a "no" — measured on the live model, 2026-11-14 (kb-missing: "ISO 27001
 *  isn't one of the standards we cover directly", with no source for it). Positive claims are not
 *  caught here: they are usually the facts being repeated, which is the point of giving them. */
export function riskyClaim(reply: string): string | null {
  const t = String(reply ?? "").toLowerCase().replace(/[’]/g, "'");
  const m =
    t.match(/\b(?:we|our team|the team)\s+(?:currently\s+|do\s+)?(?:don't|do not|doesn't|cannot|can't|no longer|never)\s+(?:currently\s+|really\s+|actually\s+|directly\s+)?(?:offer|provide|cover|support|certify|do|work|handle|deal)\b[^.?!]*/) ??
    t.match(/\b[^.?!]*\b(?:isn't|is not|aren't|are not)\s+(?:one of |something |part of |among )[^.?!]*\bwe\b[^.?!]*/) ??
    t.match(/\b(?:we|that)\s+(?:is|are)?\s*(?:not|n't)\s+(?:available|offered|supported|covered)\b[^.?!]*/) ??
    t.match(/\b(?:isn't|is not|aren't|are not)\s+in our (?:scope|range|offering|portfolio|list)\b[^.?!]*/) ??
    t.match(/(?:focus|specialise|specialize)[^.?!]*[—–-]\s*not \w[^.?!]*/);
  return m ? m[0].trim().slice(0, 90) : null;
}


/* ── things asked about that we have no facts for ───────────────────────────────────────── */

/** Specific things in a customer's question that appear NOWHERE in what the assistant has been told:
 *  a standard number ("27001"), a place after "in/across/serve…" ("Saudi Arabia"). A model that
 *  has seen a list of offerings treats a missing item as a "no" and invents the rest — live, 2026-11-14:
 *  "Do you certify ISO 27001 in Saudi Arabia?" was answered "We focus on 9001, 14001, 45001 — not
 *  27001 … we do work with companies in Saudi Arabia", none of it in the facts. Telling the model to
 *  be careful did not stop it (it failed 3 runs in 4), so the check is made in code and the model is
 *  told the result as a fact.
 *
 *  `factsText` is everything we may state: the business brief, the website passages, and OUR OWN
 *  earlier messages. The customer's own words are deliberately not in it — their saying "Saudi" does not
 *  make it something we know about ourselves. `ignore` is the customer's own company and city. */
/** Words that introduce a numbered standard or code: "ISO 27001", "IEC 62304", "SOC 2". */
const CODE_WORDS = new Set(["iso", "iec", "en", "bs", "soc", "pci", "sa", "ohsas", "din", "ieee", "rfc", "gmp", "haccp", "itil", "cmmi", "as", "nz", "gdpr", "hipaa", "fda", "ce", "ul"]);

export function unverifiedTerms(question: string, factsText: string, ignore: string[] = []): string[] {
  const q = String(question ?? "");
  const facts = ' ' + String(factsText ?? '').toLowerCase();
  const skip = new Set(ignore.flatMap((s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const found: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim();
    const l = t.toLowerCase();
    if (!t || skip.has(l) || found.some((f) => f.toLowerCase() === l)) return;
    if (facts.includes(l)) return;
    found.push(t);
  };
  // Numbers that NAME a standard or a code: attached to letters ("ISO27001") or following one of the
  // words that introduce one ("ISO 27001", "SOC 2022"). A bare amount is not one — a customer saying a
  // competitor charges "3500" is quoting a price, not asking about a standard (live sim, 2026-11-14:
  // it was flagged as unverified and a person was alerted for nothing).
  const words = q.split(/\s+/);
  words.forEach((w, i) => {
    const clean = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9-]+$/g, "");
    if (/^[A-Za-z]{2,6}\d{3,}[\w-]*$/.test(clean)) { add(clean); return; }
    if (/^\d{3,}[\w-]*$/.test(clean)) {
      const prev = (words[i - 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (CODE_WORDS.has(prev)) add(clean);
    }
  });
  // A place or scope named right after a preposition of coverage: "in Saudi Arabia", "across the GCC".
  const scope = /\b(?:in|across|within|throughout|serve|serving|cover|covering|operate in|work in|available in|deliver to|ship to|office in|branch in|based in)\s+(?:the\s+)?((?:[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)|[A-Z]{2,})/g;
  for (const m of q.matchAll(scope)) for (const w of m[1].split(/\s+/)) add(w);
  return found.slice(0, 4);
}

/** Words that mean "a person will confirm" / "I do not have that" — the only honest thing to say about
 *  something we have no facts on. */
export const CONFIRM_LANG = /(team member|colleague|someone (from|on) (our|the) team|will confirm|let me confirm|confirm (this|that|it|whether)|check (this|that|it|with)|don't have that|do not have that|not sure|verify|get back to you|follow up)|(team (ka|ke) (member|sadasya|koi)|confirm kar|pata karke|check karke|team se)|(पुष्टि|टीम)/i;

/** Does the reply say something about an unverified term in a sentence that is not a question and does
 *  not defer to a person? That is an assertion with no source. */
export function assertsUnverified(reply: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const sentences = String(reply ?? "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  return sentences.some((s) => {
    const l = s.toLowerCase();
    const mentions = terms.some((t) => l.includes(t.toLowerCase()));
    return mentions && !s.endsWith("?") && !CONFIRM_LANG.test(s);
  });
}

/** The safe line used when a rewrite still states something unverified: acknowledge, defer, move on. */
export function confirmLine(lang: Lang, terms: string[]): string {
  const what = terms.join(" / ");
  switch (lang) {
    case "hinglish": return `Achha sawal — ${what} ke baare mein main team se confirm karwa deta hoon, aapko jaldi bata denge. Tab tak, aapki company ko kis cheez ki sabse zyada zaroorat hai?`;
    case "hi": return `अच्छा सवाल — ${what} के बारे में मैं टीम से पुष्टि करवा देता हूँ, वे आपको जल्द बताएँगे। तब तक, आपको सबसे ज़्यादा किस चीज़ की ज़रूरत है?`;
    case "ur": return `Achha sawal — ${what} ke baare mein main team se confirm karwa deta hoon, woh aap ko jald bata denge. Tab tak, aap ko sab se zyada kis cheez ki zaroorat hai?`;
    default: return `Good question — I'll have a team member confirm ${what} for you and get back to you shortly. In the meantime, what matters most to you?`;
  }
}


/* ── company details the assistant cannot know ──────────────────────────────────────────── */

const DETAIL_TOPICS: { key: DetailKey; label: string; ask: RegExp; have: RegExp }[] = [
  {
    key: "address",
    label: "our office address",
    ask: /\b(address|headquarters?|head office|branch|where (is|are) (your|ur) office|office (kaha|kahan|kidhar|location)|(your|aapka|tumhara|aapki|tumhari) office|location)\b/i,
    have: /\b(street|road|tower|building|p\.?o\.? ?box|plot|floor|suite|located (at|in)|headquartered|our office (is|at|in)|(unit|office|shop|villa|flat)\s*#?\d+)\b|\baddress\s*[:\-–]\s*\S|\b[A-Z]\d{1,3}[-–]\d{2,4}\b/i,
  },
  {
    key: "phone",
    label: "our phone number / email",
    ask: /((your|aapka|tumhara|aapki|tumhari|company|boss|owner|manager|sir)\s+(phone|number|email|e-mail|mobile|contact)|\b(phone|contact) (number|details)\b|\bemail (id|address)\b|\bcall (karne ka|kaise karun) number\b)/i,
    have: /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{8,}/,
  },
  {
    key: "hours",
    label: "our working hours",
    ask: /\b(timings?|opening hours|working hours|office hours|open on|closed on|kab (tak )?(khula|open|milte))\b/i,
    have: /\b(opening hours|working hours|office hours|\d\s?(am|pm)\b.*\b(mon|tue|sun|sat|daily)|(mon|sun|sat)\w*\s*[-–]\s*\w+)/i,
  },
  {
    key: "licence",
    label: "our licence / registration details",
    ask: /\b(licen[cs]e|trn|vat number|gst|registration (number|no)|trade licen[cs]e|accredited by|accreditation)\b/i,
    have: /\b(licen[cs]e|trn|registration (number|no)|accredited|accreditation)\b/i,
  },
];

export type DetailKey = "address" | "phone" | "hours" | "licence";
export const DETAIL_KEYS: DetailKey[] = ["address", "phone", "hours", "licence"];

/** The same check, but the asking was recognised by the MODEL (in any language) instead of by the keyword list above: of the
 *  detail kinds it says were asked for, the ones our facts do not hold. */
export function missingFromKeys(keys: readonly string[], factsText: string): string[] {
  const facts = String(factsText ?? "");
  return DETAIL_TOPICS.filter((t) => keys.includes(t.key) && !t.have.test(facts)).map((t) => t.label);
}

/** The customer's message as the MODEL read it (any language) merged with the keyword reading (English / Hinglish): a signal
 *  counts if either saw it. The keywords stay as a backup; the model is what makes every other language work. */
export function mergeSignals(kw: Signals, model?: Partial<Signals> | null): Signals {
  const m = model ?? {};
  return {
    price: kw.price || !!m.price, details: kw.details || !!m.details, document: kw.document || !!m.document,
    delayComplaint: kw.delayComplaint || !!m.delayComplaint, whoAreYou: kw.whoAreYou || !!m.whoAreYou, botQuestion: kw.botQuestion || !!m.botQuestion,
    angry: kw.angry || !!m.angry, wantsCall: kw.wantsCall || !!m.wantsCall,
  };
}

/** Things about the BUSINESS ITSELF that the customer asked for and that appear nowhere in the facts —
 *  an address, a phone number, opening hours, a licence number. A model asked for an office address will
 *  produce one: live sim, 2026-11-14, "tumhara office kaha hai? address bhejo" was answered with an
 *  office in "Business Bay, Dubai" that exists in no fact we hold. These are never guessed. */
export function missingDetails(question: string, factsText: string): string[] {
  const q = String(question ?? "");
  const facts = String(factsText ?? "");
  return DETAIL_TOPICS.filter((t) => t.ask.test(q) && !t.have.test(facts)).map((t) => t.label);
}

/** What the customer is told when the assistant is asked to arrange a call but there is nothing to
 *  arrange it with (no calendar connected, no booking link): honest, and it asks the one thing that helps
 *  a person book it. It must never promise slots that are not going to arrive. */
export const MEETING_FALLBACK: Record<Lang, string> = {
  en: "Happy to arrange a call — a team member will reach out to fix a time. Which part of the day suits you best: morning, afternoon or evening?",
  hinglish: "Zaroor — hamari team ka member aapse contact karke time fix kar lega. Aapke liye din ka kaunsa time theek rahega: subah, dopahar ya shaam?",
  hi: "ज़रूर — हमारी टीम का सदस्य आपसे संपर्क करके समय तय कर लेगा। दिन का कौन सा समय आपके लिए ठीक रहेगा: सुबह, दोपहर या शाम?",
  ur: "Zaroor — hamari team ka member aap se rabta karke waqt tay kar lega. Din ka kaunsa waqt theek rahega: subah, dopahar ya shaam?",
};

/** One short confirmation when someone asks us to stop. Silence after "band karo" reads as being ignored. */
export const OPT_OUT_ACK: Record<Lang, string> = {
  en: "Understood — I won't message you again. If you ever need us, just write.",
  hinglish: "Samajh gaya — aage se aapko message nahi karunga. Kabhi zaroorat ho to bas likh dena.",
  hi: "समझ गया — अब आगे आपको संदेश नहीं भेजूँगा। कभी ज़रूरत हो तो बस लिख देना।",
  ur: "Samajh gaya — ab aap ko message nahi karunga. Kabhi zaroorat ho to bas likh dena.",
};


/* ── "I cannot share the price" — said plainly, never replaced by a made-up number ─────── */

const AMOUNT_IN_REPLY = /(?:\b(?:aed|usd|inr|sar|pkr|eur|gbp|qar|kwd|bhd|omr|rs\.?)\s?\d|[$€£₹]\s?\d|\d[\d,.]*\s?(?:aed|usd|inr|sar|pkr|eur|gbp|rs\b|dirhams?|rupees?|riyals?|dollars?|lakh|lac))/i;

/** A currency amount in a reply. When the business has published no price, ANY amount in a reply is invented. */
export function containsPriceAmount(text: string): boolean {
  return AMOUNT_IN_REPLY.test(String(text ?? ""));
}

const PRICE_WORD = String.raw`(?:price|prices|pricing|cost|rate|rates|quote|quotation|fee|fees|figure|kimat|qeemat|keemat|daam|rate|कीमत|प्राइस|रेट)`;
const SAYS_UNAVAILABLE = new RegExp(
  [
    String.raw`(?:can't|cannot|can not|unable to|not able to|won't be able to|don't have|do not have)[^.?!]{0,40}${PRICE_WORD}`,
    String.raw`${PRICE_WORD}[^.?!]{0,40}(?:not available|can't be shared|cannot be shared|not something i can|isn't available)`,
    String.raw`(?:abhi|filhaal|is waqt)[^.?!]{0,30}${PRICE_WORD}[^.?!]{0,30}(?:nahi|nahin)`,
    String.raw`${PRICE_WORD}[^.?!]{0,30}(?:nahi|nahin)\s+(?:bata|de|share|bol|keh)`,
    String.raw`(?:नहीं बता|नहीं दे)[^.?!]{0,30}`,
  ].join("|"),
  "i",
);

/** Does the reply say, in so many words, that the price cannot be shared right now? */
export function statesPriceUnavailable(text: string): boolean {
  return SAYS_UNAVAILABLE.test(String(text ?? ""));
}

/** What is said when a customer asks the price and the business has published none: clear, one next step,
 *  and no figure. */
export const PRICE_UNAVAILABLE_PHRASE: Record<Lang, string> = {
  en: "I can't share the price right now",
  hinglish: "Abhi main aapko price nahi bata sakta",
  hi: "अभी मैं आपको कीमत नहीं बता सकता",
  ur: "Abhi main aap ko qeemat nahi bata sakta",
};

export const PRICE_UNKNOWN_LINE: Record<Lang, string> = {
  en: "I can't share the price right now — our team will send you an exact quote. To get it right, could you tell me a little about what you need?",
  hinglish: "Abhi main aapko price nahi bata sakta — hamari team aapko exact quote bhejegi. Sahi quote ke liye aap apni requirement thodi batayenge?",
  hi: "अभी मैं आपको कीमत नहीं बता सकता — हमारी टीम आपको सटीक कोटेशन भेजेगी। सही कोटेशन के लिए क्या आप अपनी ज़रूरत थोड़ी बताएँगे?",
  ur: "Abhi main aap ko qeemat nahi bata sakta — hamari team aap ko exact quote bhejegi. Sahi quote ke liye aap apni zaroorat thori batayenge?",
};


/* ── arranging a call when there is no calendar to arrange it with ──────────────────────── */

/** Said once we know WHEN they would like the call. It promises only what is then made true: the owner is alerted
 *  (autoReply.ts) with this preference and asked to send a time and a link. */
/** LAST-RESORT acknowledgement, used only when the model's own reply was empty or broke a rule (carried an invented time or link).
 *  The model normally writes this itself, in whatever language the customer used; these lines exist for the four languages we
 *  hold wording for, and English for any other. It promises only what is then made true: the team is alerted. */
export const MEETING_ACK: Record<Lang, (label: string) => string> = {
  en: (l) => `Noted${l ? ` — ${l}` : ""}. Our team will confirm the exact time and send the meeting link here shortly.`,
  hinglish: (l) => `Theek hai${l ? ` — ${l}` : ""}. Hamari team exact time confirm karke meeting link yahin bhej degi.`,
  hi: (l) => `ठीक है${l ? ` — ${l}` : ""}। हमारी टीम सही समय तय करके मीटिंग लिंक यहीं भेज देगी।`,
  ur: (l) => `Theek hai${l ? ` — ${l}` : ""}. Hamari team exact waqt confirm karke meeting link yahin bhej degi.`,
};

/* ── short, like a person texting ───────────────────────────────────────────────────────── */

/** Anything longer than this, or with more than three sentences, reads as an email, not a chat. Measured on a real
 *  chat (2026-11-14): replies of 325, 202, 172, 390 and 247 characters — paragraphs a customer does not read. */
export const MAX_CHAT_CHARS = 260;

export function tooLongForChat(text: string): boolean {
  const t = String(text ?? "").trim();
  return t.length > MAX_CHAT_CHARS || t.split(/(?<=[.!?])\s+/).filter(Boolean).length > 3;
}

/** A long message as the two or three short ones a person would have sent. Cut at sentence ends, never mid-sentence unless a
 *  single sentence is itself too long (then at the last comma or space). At most `maxParts`; any remainder joins the last. */
export function splitForChat(text: string, max = 200, maxParts = 3): string[] {
  const sentences = String(text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    let rest = s;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(", ", max);
      if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
      if (cut < 1) cut = max;
      pieces.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) pieces.push(rest);
  }
  const parts: string[] = [];
  for (const p of pieces) {
    const last = parts[parts.length - 1];
    if (last && last.length + 1 + p.length <= max) parts[parts.length - 1] = `${last} ${p}`;
    else parts.push(p);
  }
  while (parts.length > maxParts) { const tail = parts.pop()!; parts[parts.length - 1] += ` ${tail}`; }
  return parts;
}

/* ── not asking for a call in every message ─────────────────────────────────────────────── */

const CALL_WORDS = /\b(call|meeting|demo|time slots?|quick chat|catch[- ]?up)\b/i;
const sentences = (t: string) => String(t ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** Does this message ask whether they would like a call / meeting / demo? */
export function offersCall(text: string): boolean {
  return sentences(text).some((s) => s.endsWith("?") && CALL_WORDS.test(s));
}

/** The same message without its call-offering question(s). Returns the original if nothing else is left. */
export function stripCallOffer(text: string): string {
  const kept = sentences(text).filter((s) => !(s.endsWith("?") && CALL_WORDS.test(s)));
  return kept.length ? kept.join(" ").trim() : String(text ?? "");
}


/* ── things a model says that a real assistant must not ─────────────────────────────────── */

const TIME_WORDS = /\b(\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}\s?baje|tomorrow|tonight|today at|kal|aaj (shaam|raat|subah)|next (week|monday)|(mon|tues?|wednes|thurs?|fri|satur|sun)day)\b/i;

/** A call/meeting proposed at a specific time ("tomorrow 10 AM", "Mon-Fri 10-4"). The assistant cannot
 *  see a calendar, so a time it names is one nobody has checked. */
export function proposesTime(text: string): boolean {
  return sentences(text).some((s) => CALL_WORDS.test(s) && TIME_WORDS.test(s));
}

/** The reply without its sentences that propose a time for a call. */
export function stripTimeProposals(text: string): string {
  const kept = sentences(text).filter((s) => !(CALL_WORDS.test(s) && TIME_WORDS.test(s)));
  return kept.join(" ").trim();
}

/** Small talk answered as if the assistant had a life: "Haan dekha, kya match tha!", "last over tak
 *  gaya". It is an assistant: it has watched, eaten and visited nothing. */
export function claimsExperience(text: string): boolean {
  const t = String(text ?? "").trim();
  return (
    /^(haan|ha|yes|yeah|yep|ji)\b[^.?!]{0,70}\b(dekh|dekha|watched|saw|match|game|film|movie|khaya|khana|trip|gaya|gayi|ghuma|visited)/i.test(t) ||
    /\b(i|main|maine|mai)\s+(also |bhi |too )?(watched|saw|visited|ate|went|travell?ed|dekha|dekh|khaya|gaya|gayi|ghuma)\b/i.test(t) ||
    /\b(last over|super over|so good|kya match|what a match|loved it)\b/i.test(t)
  );
}

/** What is said instead: honest about being an assistant, warm, and back to their need. */
export const SMALLTALK_DEFLECT: Record<Lang, string> = {
  en: "Ha, I'm only the assistant here, so I can't say 😄 — anyway, back to what you need. What can I help you with?",
  hinglish: "Main yahan sirf assistant hoon, is baare mein kuch keh nahi sakta 😄 — chaliye aapke kaam ki baat par wapas aate hain. Aap kis cheez mein help chahte hain?",
  hi: "मैं यहाँ सिर्फ़ असिस्टेंट हूँ, इस बारे में कुछ कह नहीं सकता 😄 — चलिए आपके काम की बात पर वापस आते हैं। आपको किस चीज़ में मदद चाहिए?",
  ur: "Main yahan sirf assistant hoon, is baare mein kuch keh nahi sakta 😄 — chaliye aap ke kaam ki baat par wapas aate hain. Aap ko kis cheez mein madad chahiye?",
};

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

export function signalsBrief(s: Signals, pricingProvided: boolean, lang: Lang = "en", unverified: string[] = [], detailGaps: string[] = []): string[] {
  const out: string[] = [];
  if (unverified.length) out.push(`They asked about ${unverified.join(", ")}, which appear NOWHERE in the facts you were given. Do NOT say whether we do or do not handle it, do NOT say where we operate, and do NOT infer anything from what we do list. Say plainly that a team member will confirm, then ask ONE useful question. Set handoff true.`);
  if (detailGaps.length) out.push(`They asked for ${detailGaps.join(" and ")}, which is NOT in the facts you were given. Do NOT make it up — no street, area, building, phone number, email, timings or licence number. Say plainly that a team member will share it, then ask ONE useful question. Set handoff true.`);
  if (s.whoAreYou) out.push("They are asking WHO YOU ARE — follow the 'who you are' rule.");
  if (s.botQuestion) out.push("They are asking whether you are a bot/AI — answer honestly (you are the team's AI assistant; a person can join any time).");
  if (s.price) out.push(pricingProvided
    ? "They are asking about PRICE — state the pricing from the facts in your FIRST sentence."
    : `They are asking about PRICE and the business has published NO price you may quote. Your FIRST sentence must say clearly that you cannot share the price right now, in THEIR language, e.g. "${PRICE_UNAVAILABLE_PHRASE[lang]}" — and the WHOLE reply stays in that one language. Give NO number, NO range, NO 'starting from' and NO estimate of any kind. Then say a team member will send an exact quote, and ask ONE question about what they need so the quote is right. Set handoff true.`);
  if (s.document) out.push("They want a DOCUMENT (outline/brochure/proposal). You cannot attach files: give the useful content in 2-4 short lines now and say a team member will share the full document. Set handoff true.");
  else if (s.details) out.push("They want DETAILS — give real content now, in this message.");
  if (s.delayComplaint) out.push(`They are complaining about slow replies — open with exactly this apology, in their language: "${APOLOGY[lang]}" — then, in the SAME language, answer their actual question in the same message. Set handoff true.`);
  if (s.angry) out.push("They sound UPSET — be human and calm, acknowledge it in one line, solve the actual problem. Set handoff true.");
  if (s.wantsCall) out.push("They want to TALK to a person — say a team member will contact them, ask for the best time. Set handoff true.");
  return out;
}
