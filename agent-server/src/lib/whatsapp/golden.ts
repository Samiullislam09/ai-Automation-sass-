/** Golden conversations for the WhatsApp reply engine — the scenarios a real customer actually puts
 *  it through, each with what a good answer MUST and MUST NOT do.
 *
 *  Why this file exists: until 2026-11-13 nothing tested reply QUALITY at all. The first customer
 *  chat that mattered (an ISO consultancy lead, 11:45–12:15) exposed four failures in thirty minutes:
 *  a stock apology looped four times, three price questions went unanswered, "who are you" got the
 *  pitch twice, and a Hinglish complaint was answered in English. Each of those is a scenario below,
 *  so none of them can come back unnoticed.
 *
 *  Two consumers:
 *   - golden.test.ts   — offline, every `npm test`: asserts on what the model would be TOLD (language,
 *                        signals, stage, handoff floor, the newest message being present). No network.
 *   - golden.live.ts   — run by hand against the real model: `npx tsx src/lib/whatsapp/golden.live.ts`.
 *                        Runs each scenario through decideReply's own prompt and applies the checks.
 *                        Run it before changing the prompt, and after. */
import type { Lang, Msg } from "./conversation.js";
import type { Passage } from "./knowledge.js";

export type Scenario = {
  id: string;
  /** What this protects, in a sentence — shown when it fails. */
  why: string;
  pricing: boolean;
  thread: Msg[];
  /** Passages the website lookup would have returned for this question (knowledge.ts). */
  knowledge?: Passage[];
  expect: {
    lang: Lang;
    /** The floor under the model: must a person be pulled in whatever it says? */
    handoff: boolean;
    /** Live: the MODEL itself must have asked for a person (beyond the code-enforced floor above). */
    modelHandoff?: boolean;
    /** Live: the reply must match every one of these … */
    replyMatches?: RegExp[];
    /** … and none of these. */
    replyAvoids?: RegExp[];
  };
};

const IN = (body: string, created_at?: string): Msg => ({ direction: "in", body, created_at });
const OUT = (body: string, created_at?: string): Msg => ({ direction: "out", body, created_at });

const OPENER = OUT("Hi, this is Sami from wca-global.com — we help companies get ISO 9001 certified. Is that something you are looking at this year?");

/** "I'll send it now" and its cousins — a promise of a file the bot cannot send. */
export const EMPTY_PROMISE = /\b(i'?ll|i will|let me|i am going to|i'm going to|sending)\b[^.?!]{0,40}\b(send|share|attach|email|forward)\b[^.?!]{0,40}\b(now|shortly|right away|in a moment|soon|today)\b/i;
export const SORRY_FOR_DELAY = /sorry for the delay|apolog(y|ies|ise|ize) for the delay/i;
export const DEVANAGARI = /[ऀ-ॿ]/;

export const SCENARIOS: Scenario[] = [
  {
    id: "who-are-you",
    why: "'Who are you?' must be answered with who we are and what we do for THEM — not the opener's pitch pasted again.",
    pricing: false,
    thread: [OPENER, IN("Ok"), IN("Who are you ?")],
    expect: { lang: "en", handoff: false, replyAvoids: [EMPTY_PROMISE, SORRY_FOR_DELAY], replyMatches: [/wca-global|ISO|certif/i] },
  },
  {
    id: "price-given",
    why: "A price question is answered with the price in the first sentence when we hold one.",
    pricing: true,
    thread: [OPENER, IN("Yes interested"), OUT("Great — which standard are you after?"), IN("ISO 9001. Give me price")],
    expect: { lang: "en", handoff: false, replyMatches: [/\d/], replyAvoids: [EMPTY_PROMISE, SORRY_FOR_DELAY] },
  },
  {
    id: "price-not-set",
    why: "No price on file: say so honestly, ask the ONE qualifying detail, and pull the owner in — never stall with 'sending shortly'.",
    pricing: false,
    thread: [OPENER, IN("Yes interested"), OUT("Great — which standard are you after?"), IN("ISO 9001. Give me price")],
    expect: { lang: "en", handoff: true, replyMatches: [/\?/], replyAvoids: [EMPTY_PROMISE, SORRY_FOR_DELAY] },
  },
  {
    id: "send-outline",
    why: "The bot cannot attach files. It must put the substance in the message and flag a person — the exact failure of 2026-11-13.",
    pricing: false,
    thread: [OPENER, IN("Ok give me some information about iso"), OUT("Sure — ISO 9001 is the quality-management standard. Want the one-page outline?"), IN("Yaha pe vejo jaldi, send the outline")],
    expect: { lang: "hinglish", handoff: true, replyAvoids: [EMPTY_PROMISE, SORRY_FOR_DELAY] },
  },
  {
    id: "delay-complaint-hinglish",
    why: "A Hinglish complaint gets a Hinglish, five-word apology and a real answer in the same message — not a stock English apology.",
    pricing: false,
    thread: [OPENER, IN("Ok give me some information about iso"), OUT("ISO 9001 helps companies improve quality. Want the outline?"), IN("Tum message karke kaha chale jate ho ? Reply pe itna time kiyoun")],
    expect: { lang: "hinglish", handoff: true, replyAvoids: [EMPTY_PROMISE, DEVANAGARI] },
  },
  {
    id: "price-hinglish",
    why: "Roman-Hindi in, Roman-Hindi out.",
    pricing: true,
    thread: [OPENER, IN("haan batao, iska price kitna hoga bhai")],
    expect: { lang: "hinglish", handoff: false, replyAvoids: [DEVANAGARI, EMPTY_PROMISE], replyMatches: [/\d/] },
  },
  {
    id: "price-devanagari",
    why: "Devanagari in, Devanagari out.",
    pricing: true,
    thread: [OPENER, IN("आपकी कीमत क्या है")],
    expect: { lang: "hi", handoff: false, replyMatches: [DEVANAGARI] },
  },
  {
    id: "ok-does-not-flip-language",
    why: "A bare 'Ok' says nothing about language — keep the language of the last real message.",
    pricing: false,
    thread: [OPENER, IN("mujhe iso certification chahiye, kitna time lagega"), OUT("Usually 3-4 mahine. Aapki company mein kitne log hain?"), IN("Ok")],
    expect: { lang: "hinglish", handoff: false },
  },
  {
    id: "are-you-a-bot",
    why: "Asked sincerely, the bot says it is the team's AI assistant — it never claims to be human.",
    pricing: false,
    thread: [OPENER, IN("Are you a bot?")],
    expect: { lang: "en", handoff: false, replyAvoids: [/\bI am (a )?(real )?(human|person)\b/i, /\bI'?m (a )?(real )?(human|person)\b/i], replyMatches: [/AI|assistant|team/i] },
  },
  {
    id: "angry",
    why: "An upset customer is met by a human tone, not the pitch — and the owner is alerted.",
    pricing: true,
    thread: [OPENER, IN("This is a scam. Stop spamming me, waste of time")],
    expect: { lang: "en", handoff: true, replyAvoids: [EMPTY_PROMISE] },
  },
  {
    id: "wants-a-person",
    why: "'Call me' means a person must act — flagged, not deflected.",
    pricing: true,
    thread: [OPENER, IN("Can we talk on a call? please call me")],
    expect: { lang: "en", handoff: true },
  },
  {
    id: "voice-note",
    why: "A voice note cannot be heard: say so kindly and ask for text. Never pretend to have understood it.",
    pricing: false,
    thread: [OPENER, IN("[Voice message]")],
    expect: { lang: "en", handoff: false, replyMatches: [/type|text|write|call/i] },
  },
  {
    id: "kb-answerable",
    why: "A question the website answers is answered from the website — specifically, not with a generic sentence.",
    pricing: false,
    thread: [OPENER, IN("How long does ISO 14001 take and what do you need from us?")],
    knowledge: [
      { url: "https://wca-global.com/iso-14001", title: "ISO 14001", score: 0.9, text: "ISO 14001 implementation typically takes 4 to 6 months depending on the size of the organisation and how mature its environmental controls already are." },
      { url: "https://wca-global.com/iso-14001", title: "ISO 14001", score: 0.8, text: "What we need from you: a nominated management representative, a list of your sites and processes, and access to your existing environmental permits and records." },
    ],
    expect: { lang: "en", handoff: false, replyMatches: [/4\s*(to|-|–)\s*6|four to six/i, /month/i], replyAvoids: [EMPTY_PROMISE, SORRY_FOR_DELAY] },
  },
  {
    id: "kb-missing",
    why: "A question neither the brief nor the website answers is NOT answered from general knowledge: say a team member will confirm, and flag it.",
    pricing: false,
    thread: [OPENER, IN("Do you also certify companies in Saudi Arabia for ISO 27001?")],
    knowledge: [
      { url: "https://wca-global.com/iso-14001", title: "ISO 14001", score: 0.4, text: "ISO 14001 implementation typically takes 4 to 6 months depending on the size of the organisation." },
    ],
    expect: { lang: "en", handoff: true, replyAvoids: [EMPTY_PROMISE, /\b(yes|yeah|sure)[,!. ]+(we|i)\b.*27001/i, /\bwe (do|can) (certify|offer|provide)\b.*(27001|saudi)/i], replyMatches: [/team|confirm|check/i] },
  },
];
