/** LIVE check that arranging a call works in any language, read by the REAL model (no keyword lists involved).
 *    cd agent-server && npx tsx src/lib/whatsapp/callLanguages.live.ts
 *  Prints, for each customer message, what the model understood (call.stage / when) and what it would send. By hand, not CI. */
import "dotenv/config";
import { buildReplyPrompt, decideFromPrompt } from "./decide.js";

const BUSINESS = [
  "Business name: wca-global.com",
  "You write as: Sami from wca-global.com",
  "What we do: ISO consultancy — ISO 9001, 14001 and 45001 certification.",
  "Pricing: priced per quote — from $2,400 to $18,000 depending on the package",
].join("\n");

type T = { direction: "in" | "out"; body: string; created_at: string };
let n = 0;
const m = (direction: "in" | "out", body: string): T => ({ direction, body, created_at: new Date(Date.UTC(2026, 10, 15, 10, n++)).toISOString() });

const CASES: { name: string; thread: T[] }[] = [
  { name: "Hinglish: 'Aj rat ko' after being asked when", thread: [m("in", "mujhe ek call karni hai"), m("out", "Zaroor — kaunsa din theek rahega, aur subah, dopahar ya shaam?"), m("in", "Aj rat ko")] },
  { name: "Hinglish: 'Abhi possible ha ?'", thread: [m("in", "call kar sakte hain?"), m("out", "Bilkul — kab free ho aap?"), m("in", "Abhi possible ha ?")] },
  { name: "Spanish: asks for a call", thread: [m("in", "Hola, ¿podemos hacer una llamada?")] },
  { name: "Spanish: gives a time", thread: [m("in", "Hola, ¿podemos hacer una llamada?"), m("out", "Claro, ¿qué día y en qué momento del día le viene bien?"), m("in", "mañana por la tarde")] },
  { name: "Arabic: right now", thread: [m("in", "أريد مكالمة"), m("out", "بالتأكيد، متى يناسبك؟"), m("in", "الآن لو سمحت")] },
  { name: "Bengali: tonight", thread: [m("in", "আমি একটা কল করতে চাই"), m("out", "অবশ্যই, কোন দিন আর দিনের কোন সময় আপনার সুবিধা হবে?"), m("in", "আজ রাতে")] },
  { name: "English: vague after two asks", thread: [m("in", "can we talk?"), m("out", "Sure — which day suits you?"), m("in", "not sure"), m("out", "No problem — morning, afternoon or evening?"), m("in", "idk, whenever")] },
];

for (const c of CASES) {
  const built = buildReplyPrompt({ business: BUSINESS, pricingProvided: true, lead: { company: "Acme", city: "Dubai" }, thread: c.thread as any, knowledge: [] });
  try {
    const d = await decideFromPrompt(built);
    console.log(`\n${c.name}\n  customer : ${c.thread[c.thread.length - 1].body}\n  call     : ${d.call?.stage} / ${d.call?.when ?? "-"}   intent=${d.intent} team-alert=${d.needs_human} pref=${d.meeting_pref ?? "-"}\n  reply    : ${d.reply}\n  notes    : ${(d.notes ?? []).join("; ") || "-"}`);
  } catch (e: any) {
    console.log(`\n${c.name}\n  FAILED: ${e?.message}`);
  }
}
