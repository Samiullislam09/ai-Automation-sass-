/** LIVE check that the assistant UNDERSTANDS a message in any language — stop requests, price, address, buying — read by the
 *  REAL model, then through the same merge the server uses. By hand, not CI.
 *    cd agent-server && npx tsx src/lib/whatsapp/understanding.live.ts            # all
 *    cd agent-server && npx tsx src/lib/whatsapp/understanding.live.ts stop       # cases whose name contains "stop"
 *  Each case states what MUST be understood; the script prints PASS/FAIL. */
import "dotenv/config";
import { buildReplyPrompt, completeReplyJson, parseDecision } from "./decide.js";
import { mergeSignals, missingFromKeys } from "./conversation.js";

const BUSINESS = ["Business name: wca-global.com", "You write as: Sami from wca-global.com", "What we do: ISO consultancy — ISO 9001, 14001 and 45001 certification.", "Pricing: NOT PROVIDED to you."].join("\n");
const msg = (body: string) => [{ direction: "in" as const, body, created_at: new Date().toISOString() }];

type Want = { stop?: "yes" | "maybe" | "no"; price?: boolean; address?: boolean; commit?: boolean; angry?: boolean };
const CASES: [string, string, Want][] = [
  // STOP, in many forms
  ["stop en", "Please stop messaging me", { stop: "yes" }],
  ["stop hinglish", "bhai msg mat karo mujhe", { stop: "yes" }],
  ["stop spanish", "Por favor, no me escriban más", { stop: "yes" }],
  ["stop french", "Arrêtez de m'envoyer des messages", { stop: "yes" }],
  ["stop arabic", "لا ترسل لي رسائل بعد الآن", { stop: "yes" }],
  ["stop bengali", "আমাকে আর মেসেজ করবেন না", { stop: "yes" }],
  ["stop tamil", "எனக்கு மெசேஜ் அனுப்பாதீர்கள்", { stop: "yes" }],
  ["stop indirect", "wrong number, who gave you this number?", { stop: "yes" }],
  ["stop blunt", "chal nikal yahan se, block kar dunga", { stop: "yes" }],
  ["stop spam", "this is spam, I'm reporting you", { stop: "yes" }],
  ["stop hint", "not interested. don't contact again", { stop: "yes" }],
  ["not-stop price", "how much does ISO 9001 cost?", { stop: "no" }],
  ["not-stop hinglish ok", "ok thik hai, kal baat karte hain", { stop: "no" }],
  ["not-stop 'stop' word in other sense", "can you stop by our office tomorrow?", { stop: "no" }],
  // PRICE, address, buying in other languages
  ["price spanish", "¿Cuánto cuesta la certificación ISO 9001?", { price: true }],
  ["price french", "Quel est le tarif pour la certification ?", { price: true }],
  ["price arabic", "كم سعر الحصول على شهادة الأيزو؟", { price: true }],
  ["price bengali", "ISO সার্টিফিকেশনের দাম কত?", { price: true }],
  ["address spanish", "¿Dónde está su oficina? Necesito la dirección", { address: true }],
  ["address arabic", "ما هو عنوان مكتبكم؟", { address: true }],
  ["commit spanish", "Perfecto, empecemos. Envíenme la factura.", { commit: true }],
  ["commit hindi", "ठीक है, काम शुरू कर दीजिए, मैं पेमेंट कर रहा हूँ", { commit: true }],
  ["not-commit", "I'll think about it and let you know", { commit: false }],
  ["angry german", "Das ist Betrug, ihr seid Idioten", { angry: true }],
];

const filter = process.argv[2] ?? "";
let failed = 0;
for (const [name, text, want] of CASES.filter(([n]) => n.includes(filter))) {
  const built = buildReplyPrompt({ business: BUSINESS, pricingProvided: false, lead: { company: "Acme", city: "Dubai" }, thread: msg(text), knowledge: [] });
  const problems: string[] = [];
  let shown = "";
  try {
    const d = parseDecision(await completeReplyJson(built.user, built.system));
    const sig = mergeSignals(built.signals, d.read);
    const gaps = missingFromKeys(d.asks_missing ?? [], built.factsText);
    const stopped = d.stop === "yes" || d.intent === "stop";
    shown = `stop=${d.stop} intent=${d.intent} price=${sig.price} angry=${sig.angry} address-gap=${gaps.length > 0} commit=${d.commit} conf=${d.confidence}`;
    if (want.stop === "yes" && !stopped) problems.push("should be a stop request");
    if (want.stop === "no" && (stopped || d.stop === "maybe")) problems.push("must NOT be treated as a stop request");
    if (want.price && !sig.price) problems.push("price not understood");
    if (want.address && !gaps.length) problems.push("address request not understood");
    if (want.commit === true && !(d.commit && d.confidence >= 0.8)) problems.push("buying commitment not understood");
    if (want.commit === false && d.commit) problems.push("must NOT be a commitment");
    if (want.angry && !sig.angry) problems.push("anger not understood");
  } catch (e: any) {
    problems.push(`model call failed: ${e?.message}`);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name.padEnd(34)} “${text}”\n      ${shown}${problems.length ? "\n      ✗ " + problems.join("; ") : ""}`);
}
console.log(failed ? `\n${failed} case(s) failed` : "\nAll cases understood");
process.exit(failed ? 1 : 0);
