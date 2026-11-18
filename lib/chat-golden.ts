/** lib/chat-golden.ts — the golden set for the manager chat: real questions, in several languages, with what a good answer MUST and MUST NOT do.
 *
 *  WHY. Until now nothing tested the chat's QUALITY. A real client chat (2026-11-18) exposed it in ten messages: "I can't message your leads", a Google Analytics refusal for a
 *  question about WhatsApp leads, a keyword job started when the customer wanted to SEE the result, no way to read one lead's chat. Every one of those is a case below, so none
 *  of them can come back unnoticed — and the set keeps growing: a new complaint becomes a new case before it becomes a fix.
 *
 *  TWO LAYERS, because the chat works in two steps:
 *   ROUTING  — which tool does the model pick for this message? (any language; negation; "show me" vs "do it")
 *   ANSWERS  — given what that tool returned (a FIXED fixture below, not the production database), does the reply say the right thing, in the customer's language,
 *              without inventing a number? Run through the real prompt (lib/chat-prompt.ts) and the real chat model.
 *
 *  Two consumers, like lib/whatsapp/golden.ts:
 *   · lib/chat-golden.test.ts — offline, every test run: the data is sound (every expected tool exists, languages covered, the checks themselves work). No network.
 *   · lib/chat-golden.live.ts — by hand, against the real model: `npm run golden:chat`. Run it before a deploy that touches the chat, the tools or the prompt.
 *     A model's wording varies run to run, so it is a gate you run, not a flaky CI step. Exit code 1 on any failure. */
import { shapeLeadStats, shapeAutopilot, shapeKeywords, shapeLeadConversation } from "@/lib/chat-lead-tools";
import { shapeDataSources } from "@/lib/data-sources";

export type Lang = "en" | "hinglish" | "hi" | "es" | "ar" | "bn" | "fr";

/* ── ROUTING ─────────────────────────────────────────────────────────────────────────────── */

export type RoutingCase = { id: string; lang: Lang; message: string; expect: string[]; why: string };

export const ROUTING: RoutingCase[] = [
  // ── the real client chat, 2026-11-18
  { id: "leads-can-you-hinglish", lang: "hinglish", message: "Kiya tum hamare leads se bat kr sakte ho ?", expect: ["lookup_autopilot", "answer_question"], why: "was answered 'I can't message your leads' — the product's biggest feature" },
  { id: "leads-can-you-en", lang: "en", message: "Can you communicate with our leads?", expect: ["lookup_autopilot", "answer_question"], why: "same question in English" },
  { id: "whatsapp-count", lang: "hinglish", message: "Is main se whatapp par kitne log ha", expect: ["lookup_lead_stats"], why: "was refused as a Google Analytics question" },
  { id: "whatsapp-count-2", lang: "hinglish", message: "kitne leads ke paas whatsapp number hai", expect: ["lookup_lead_stats"], why: "no tool counted them" },
  { id: "keyword-show", lang: "hinglish", message: "Apne abhi jo keyword nikala ha usko chat pe do", expect: ["lookup_keywords"], why: "started ANOTHER keyword job instead of showing the result" },
  { id: "keyword-which", lang: "hinglish", message: "Konsa keyword ha", expect: ["lookup_keywords"], why: "same failure, another phrasing" },
  { id: "keyword-new", lang: "hinglish", message: "ab mere liya ek keyword research kar do best", expect: ["find_keywords"], why: "a NEW research request must still start the work" },
  { id: "lead-history", lang: "hinglish", message: "sainiul ki chat history do", expect: ["lookup_lead_conversation"], why: "no tool read one lead's conversation" },
  { id: "lead-summary", lang: "hinglish", message: "is sainiul lead se kya baat hui uska summary do", expect: ["lookup_lead_conversation"], why: "same failure, another phrasing" },
  { id: "auto-running", lang: "hinglish", message: "kya hamara leads ka kaam khud chal raha hai? meeting auto set hoti hai?", expect: ["lookup_autopilot"], why: "no way to ask whether the chain runs" },
  { id: "leads-count", lang: "hinglish", message: "Hamare kitne leads hain", expect: ["lookup_lead_stats", "lookup_outreach"], why: "lead numbers" },
  { id: "image-order", lang: "hinglish", message: "ek image banao black friday ke liye", expect: ["make_image"], why: "an order stays an order" },
  { id: "find-leads-order", lang: "hinglish", message: "leads dhundo 10 hamare liye", expect: ["find_leads"], why: "an order stays an order" },
  // ── numbers we may or may not see (used to be a keyword refusal before the model)
  { id: "traffic-hinglish", lang: "hinglish", message: "site pe kitne log aaye is hafte", expect: ["lookup_data_sources", "lookup_analytics"], why: "traffic is real only if Google is connected" },
  { id: "followers-hinglish", lang: "hinglish", message: "mere instagram pe kitne followers hain", expect: ["lookup_data_sources"], why: "nothing reads social platforms" },
  { id: "revenue-en", lang: "en", message: "how much revenue did we make this month", expect: ["lookup_data_sources"], why: "no revenue tracking" },
  { id: "followers-es", lang: "es", message: "¿cuántos seguidores tengo en redes sociales?", expect: ["lookup_data_sources"], why: "worked in no language but English/Hinglish before" },
  // ── everyday questions that keyword lists used to gate
  { id: "articles-count", lang: "hinglish", message: "kitne article likhe hain abhi tak", expect: ["lookup_content"], why: "content numbers" },
  { id: "site-issues", lang: "hinglish", message: "site pe kya issue hai", expect: ["lookup_site_audit"], why: "audit findings" },
  { id: "next-article", lang: "hinglish", message: "agla article kab aayega", expect: ["lookup_schedule"], why: "the timetable" },
  { id: "about-us", lang: "hinglish", message: "hamari company ke baare mein kya pata hai tumhe", expect: ["lookup_business_profile"], why: "Site Brain" },
  { id: "greeting", lang: "en", message: "hi", expect: ["answer_question"], why: "a greeting is not a status request" },
  { id: "thanks", lang: "hinglish", message: "thanks bhai", expect: ["answer_question"], why: "small talk" },
  // ── orders about content that already exists, in other languages
  { id: "reject-hinglish", lang: "hinglish", message: "isko reject kar do ye draft theek nahi", expect: ["reject_draft"], why: "was a keyword list" },
  { id: "takedown-es", lang: "es", message: "retira el artículo de la web por favor", expect: ["take_down_article"], why: "no keyword list knew Spanish" },
  { id: "cancel-booking", lang: "hinglish", message: "wo booking cancel kar do", expect: ["cancel_booking"], why: "calling off a booking" },
  { id: "publish-existing", lang: "hinglish", message: "isko publish kar do", expect: ["publish_existing"], why: "publishing what exists" },
  { id: "publish-negated", lang: "hinglish", message: "publish mat karna abhi, sirf draft rakho", expect: ["answer_question", "write_article"], why: "negation: this once cost a customer's booked article" },
  { id: "write-ar", lang: "ar", message: "اكتب لي مقالا عن الشهادات", expect: ["write_article"], why: "any language" },
  { id: "leads-can-you-bn", lang: "bn", message: "আমার লিডদের সাথে কথা বলতে পারো?", expect: ["lookup_autopilot", "answer_question"], why: "any language" },
  // ── the autopilot: control and questions
  { id: "ap-on", lang: "hinglish", message: "autopilot on karo", expect: ["manage_autopilot"], why: "one switch" },
  { id: "ap-auto", lang: "hinglish", message: "sab kuch automatic chalu kar do leads ka", expect: ["manage_autopilot"], why: "one switch" },
  { id: "ap-pause", lang: "en", message: "pause everything, stop messaging leads for now", expect: ["manage_autopilot"], why: "one switch" },
  { id: "ap-perday", lang: "hinglish", message: "roz 20 leads dhundo", expect: ["manage_autopilot"], why: "a standing setting, not a one-off find_leads" },
  { id: "ap-hours", lang: "hinglish", message: "messages sirf subah 10 se shaam 6 ke beech bhejo", expect: ["manage_autopilot"], why: "sending hours" },
  { id: "ap-followup", lang: "hinglish", message: "follow-up band kar do", expect: ["manage_autopilot"], why: "one part only" },
  { id: "ap-es", lang: "es", message: "activa el piloto automático de leads", expect: ["manage_autopilot"], why: "any language" },
  { id: "ap-status", lang: "hinglish", message: "autopilot kaisa chal raha hai", expect: ["lookup_autopilot"], why: "a question is a lookup, not a change" },
  { id: "ap-status-2", lang: "hinglish", message: "kya sab kuch auto chal raha hai", expect: ["lookup_autopilot"], why: "same failure, another phrasing" },
  { id: "schedule-set", lang: "hinglish", message: "roz subah 9 baje article banao", expect: ["manage_schedule"], why: "the article timetable, not the lead chain" },
  { id: "find-now", lang: "hinglish", message: "abhi 10 leads dhundo", expect: ["find_leads"], why: "a one-off, not a standing setting" },
  { id: "leads-fr", lang: "fr", message: "Peux-tu écrire à mes leads sur WhatsApp ?", expect: ["lookup_autopilot", "answer_question"], why: "any language" },
];

/* ── ANSWERS: fixtures (fixed data, never the production database) ───────────────────────── */

const LEADS = [
  { id: "1", company: "Sainiul Traders", name: "Sainiul", whatsapp: "+91 76024 68881", stage: "meeting_scheduled", wa_status: "yes", needs_attention: true },
  { id: "2", company: "Falcon Mechanical", whatsapp: "+971 50 123 4567", stage: "replied", wa_status: "yes" },
  { id: "3", company: "Alfam Packing", phone: "0504608157", stage: "contacted", wa_status: "yes" },
  { id: "4", company: "No Number Ltd", stage: "approved" },
  { id: "5", company: "Gone Ltd", whatsapp: "+44 20 7946 0000", stage: "invalid", wa_status: "no" },
  { id: "6", company: "Pending Co", phone: "+971 4 000 1111", stage: "approved" },
];
export const FIXTURE_STATS = shapeLeadStats(LEADS);
const AUTOPILOT_PARTLY_OFF = shapeAutopilot({
  stats: FIXTURE_STATS,
  leadSchedule: { enabled: true, frequency: "daily", time_of_day: "09:00", timezone: "Asia/Dubai", count: 10, last_run_at: "2026-11-18T05:00:00Z" },
  whatsapp: { connected: true, autoReply: true },
  settings: { outbound_enabled: true, followups_enabled: true, send_start: 9, send_end: 21, meeting_reminders: true, daily_summary: true },
  teamNumbers: 0,
  googleCalendar: "connected",
});
const KEYWORDS = shapeKeywords([], [{
  action: "Keywords for ISO 9001 transition", created_at: "2026-11-18T15:14:00Z",
  detail: { topic: "ISO 9001:2025 transition checklist", researchOnly: true, searchDataAvailable: false, recommended: "iso 9001 2025 transition checklist uae", recommendedWhy: "closest match to the topic",
    relatedKeywords: [{ keyword: "iso 9001 2025 transition checklist uae" }, { keyword: "iso 9001 gap analysis template uae" }] },
}]);
const CONVERSATION = shapeLeadConversation(LEADS[0] as any, [
  { direction: "in", body: "Give me price", created_at: "2026-11-13T14:55:00Z" },
  { direction: "out", body: "ISO 9001 certification starts from $2,400 for one site. How many employees do you have?", created_at: "2026-11-13T15:00:00Z", answered_by: "brain" },
  { direction: "in", body: "3 employees, one site in West Bengal", created_at: "2026-11-13T15:02:00Z" },
  { direction: "out", body: "Essential fits you. Would a short call help?", created_at: "2026-11-13T15:03:00Z", answered_by: "brain" },
  { direction: "in", body: "Aj rat ko", created_at: "2026-11-14T11:28:00Z" },
], [{ status: "scheduled", start_at: "2026-11-14T16:00:00Z", meet_link: "https://meet.google.com/abc-defg-hij" }]);
const NO_SOURCES = shapeDataSources({ ga4: false, gsc: false, social: [] });

/** What each check looks for. `must` all match; `mustNot` none match. Plain regexes over the reply text. */
export type AnswerCase = {
  id: string; lang: Lang; message: string; tool: string; fixture: unknown; why: string;
  must?: RegExp[]; mustNot?: RegExp[];
  /** The reply must be written in this script (checked by character ranges, not by wording). */
  script?: "latin" | "arabic" | "bengali" | "devanagari";
  maxChars?: number;
  /** Every number in the reply must appear in the fixture, or be one of the numbers the customer typed. */
  noInventedNumbers?: boolean;
};

const CANNOT_MESSAGE = /\b(i can(?:'|’)?t|i cannot|i am not able|i'm not able|unable to|nahi kar sakta|nahi kar sakti|can't communicate)\b[^.?!\n]{0,50}\b(message|messag|leads?|communicat|talk|baat)/i;

export const ANSWERS: AnswerCase[] = [
  { id: "ans-leads-can-you", lang: "hinglish", message: "Kiya tum hamare leads se bat kr sakte ho ?", tool: "lookup_autopilot", fixture: AUTOPILOT_PARTLY_OFF, why: "the headline failure: it said it could not",
    must: [/whatsapp/i], mustNot: [CANNOT_MESSAGE], maxChars: 600 },
  { id: "ans-leads-can-you-en", lang: "en", message: "Can you communicate with our leads?", tool: "lookup_autopilot", fixture: AUTOPILOT_PARTLY_OFF, why: "same, English",
    must: [/whatsapp/i], mustNot: [CANNOT_MESSAGE], maxChars: 600, script: "latin" },
  { id: "ans-missing-team", lang: "en", message: "is everything set up for my leads to reach me when they want a call?", tool: "lookup_autopilot", fixture: AUTOPILOT_PARTLY_OFF, why: "the autopilot tool says no team number is set; the answer must say so",
    must: [/(team|number)/i], mustNot: [/everything is (set up|fine|ready)/i], script: "latin" },
  { id: "ans-whatsapp-count", lang: "hinglish", message: "Is main se whatapp par kitne log ha", tool: "lookup_lead_stats", fixture: FIXTURE_STATS, why: "was a Google Analytics refusal",
    // 5 leads have a number on file, 3 are confirmed on WhatsApp: either figure is a correct answer to "kitne log".
    must: [/\b(5|3)\b/], mustNot: [/google analytics/i, /connect google/i], noInventedNumbers: true },
  { id: "ans-leads-total", lang: "en", message: "how many leads do we have in total?", tool: "lookup_lead_stats", fixture: FIXTURE_STATS, why: "the total, exactly",
    must: [/\b6\b/], noInventedNumbers: true, script: "latin" },
  { id: "ans-keyword-show", lang: "hinglish", message: "Apne abhi jo keyword nikala ha usko chat pe do", tool: "lookup_keywords", fixture: KEYWORDS, why: "must show the result, not start a job",
    must: [/iso 9001 2025 transition checklist uae/i], mustNot: [/(shuru kar|started|starting|queued)/i] },
  { id: "ans-keyword-no-volume", lang: "en", message: "what is the search volume of that keyword?", tool: "lookup_keywords", fixture: KEYWORDS, why: "volume was not measured: it must say so, not make one up",
    mustNot: [/\b\d{2,}(,\d{3})*\s*(searches|per month|monthly)/i], noInventedNumbers: true, script: "latin" },
  { id: "ans-lead-summary", lang: "hinglish", message: "sainiul ki chat history ka summary do", tool: "lookup_lead_conversation", fixture: CONVERSATION, why: "one lead's conversation, summarised only from what was said",
    // No invented-number check here: the fixture holds the call as "16:00Z", and a reply that says "4 PM" or "14 Nov" is converting, not inventing.
    must: [/(2,?400|price)/i], mustNot: [/(^|[^\d,])[5-9]\d{3}([^\d]|$)/] },
  { id: "ans-followers-es", lang: "es", message: "¿cuántos seguidores tengo en Instagram?", tool: "lookup_data_sources", fixture: NO_SOURCES, why: "must say it cannot see this, in Spanish, with no invented number",
    must: [/\b(no (puedo|tengo|se pueden|es posible)|no me es posible|no está disponible|no hay)\b/i], mustNot: [/\b\d{2,}\b/], script: "latin" },
  { id: "ans-traffic-en", lang: "en", message: "how many people visited our site this week?", tool: "lookup_data_sources", fixture: NO_SOURCES, why: "Google is not connected: say that, with the way to fix it",
    must: [/(not connected|connect|cannot|can't|don't have)/i], mustNot: [/\b\d{2,}\b\s*(visitors|people|users|sessions)/i], script: "latin" },
  { id: "ans-autopilot-bn", lang: "bn", message: "আমার লিডদের সাথে কথা বলতে পারো?", tool: "lookup_autopilot", fixture: AUTOPILOT_PARTLY_OFF, why: "any language: the reply is in Bengali",
    script: "bengali" },
  { id: "ans-autopilot-ar", lang: "ar", message: "هل يمكنك التواصل مع العملاء المحتملين؟", tool: "lookup_autopilot", fixture: AUTOPILOT_PARTLY_OFF, why: "any language: the reply is in Arabic",
    script: "arabic" },
  { id: "ans-autopilot-fr", lang: "fr", message: "Peux-tu écrire à mes leads sur WhatsApp ?", tool: "lookup_autopilot", fixture: AUTOPILOT_PARTLY_OFF, why: "any language: French, and not 'I cannot'",
    must: [/(oui|whatsapp)/i], mustNot: [/je ne peux pas/i], script: "latin" },
  { id: "ans-greeting", lang: "en", message: "hi", tool: "answer_question", fixture: null, why: "a greeting gets a greeting: short, no report, no numbers",
    maxChars: 160, mustNot: [/\d/, /(leads|articles|published|approval|schedule)/i], script: "latin" },
];

/* ── the checks themselves (pure; unit-tested) ───────────────────────────────────────────── */

const SCRIPT: Record<NonNullable<AnswerCase["script"]>, RegExp> = {
  latin: /[A-Za-zÀ-ÿ]/,
  arabic: /[؀-ۿ]/,
  bengali: /[ঀ-৿]/,
  devanagari: /[ऀ-ॿ]/,
};
const OTHER_SCRIPTS = /[؀-ۿঀ-৿ऀ-ॿ]/;

/** Numbers in a text, as digits only (so "2,400" and "2400" compare equal). */
export function numbersIn(text: string): string[] {
  return (String(text).replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []);
}

/** The problems with a reply, as sentences. Empty = it passes. */
export function checkAnswer(c: AnswerCase, reply: string): string[] {
  const problems: string[] = [];
  const r = String(reply ?? "").trim();
  if (!r) return ["the reply is empty"];
  for (const re of c.must ?? []) if (!re.test(r)) problems.push(`should match ${re}`);
  for (const re of c.mustNot ?? []) if (re.test(r)) problems.push(`must not match ${re}`);
  if (c.maxChars && r.length > c.maxChars) problems.push(`too long (${r.length} > ${c.maxChars} characters)`);
  if (c.script === "latin") {
    if (OTHER_SCRIPTS.test(r)) problems.push("answered in a different script than the customer wrote in");
  } else if (c.script && !SCRIPT[c.script].test(r)) problems.push(`should be written in ${c.script} script`);
  if (c.noInventedNumbers) {
    const allowed = new Set([...numbersIn(JSON.stringify(c.fixture ?? "")), ...numbersIn(c.message)]);
    for (const n of numbersIn(r)) if (!allowed.has(n)) problems.push(`states ${n}, which is not in the data it was given`);
  }
  return problems;
}
