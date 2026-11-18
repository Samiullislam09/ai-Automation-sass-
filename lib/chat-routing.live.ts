/** LIVE check: which tool does the REAL model pick for the questions a client actually asked (chat of 2026-11-18)?
 *    npx tsx lib/chat-routing.live.ts            (needs NVIDIA_API_KEY in .env.local)
 *  By hand, not CI. Prints PASS/FAIL per question; exit 1 on any failure. */
import { readFileSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* file not there */ }
}

const action = (id: string, phrases: string[], input: any = {}) => ({ id, phrases, input, irreversible: false, estimated_seconds: 30, needs: [], provides: id });
const agent = (id: string, name: string, description: string, actions: any[]) => ({ id, name, version: "1", description, enabled: true, healthy: true, office: { room: id, ico: "x", color: "#fff" }, actions });
const REGISTRY: any = {
  capabilities: "", problems: [], fetchedAt: Date.now(), stale: false,
  agents: [
    agent("keyword", "Mr. Keyword", "Researches keywords.", [action("find_keywords", ["keywords do", "keyword research karo"], { topic: "string?" })]),
    agent("leads", "Mr. Lead", "Finds leads.", [action("find_leads", ["leads dhundo", "find leads"], { query: "string?" })]),
    agent("writer", "Mr. Writer", "Writes articles.", [action("write_article", ["article likho"], { topic: "string?" })]),
    agent("image", "Mr. Image", "Makes images.", [action("make_image", ["image banao"], { prompt: "string?" })]),
  ],
};

// [question, the tool(s) that are acceptable]
const CASES: [string, string[]][] = [
  // ── the client chat of 2026-11-18
  ["Kiya tum hamare leads se bat kr sakte ho ?", ["lookup_autopilot", "answer_question"]],
  ["Can you communicate with our leads?", ["lookup_autopilot", "answer_question"]],
  ["Is main se whatapp par kitne log ha", ["lookup_lead_stats"]],
  ["kitne leads ke paas whatsapp number hai", ["lookup_lead_stats"]],
  ["Apne abhi jo keyword nikala ha usko chat pe do", ["lookup_keywords"]],
  ["Konsa keyword ha", ["lookup_keywords"]],
  ["ab mere liya ek keyword research kar do best", ["find_keywords"]],
  ["sainiul ki chat history do", ["lookup_lead_conversation"]],
  ["is sainiul lead se kya baat hui uska summary do", ["lookup_lead_conversation"]],
  ["kya hamara leads ka kaam khud chal raha hai? meeting auto set hoti hai?", ["lookup_autopilot"]],
  ["Hamare kitne leads hain", ["lookup_lead_stats", "lookup_outreach"]],
  ["ek image banao black friday ke liye", ["make_image"]],
  ["leads dhundo 10 hamare liye", ["find_leads"]],
  // ── numbers we may or may not be able to see (used to be a keyword refusal before the model)
  ["site pe kitne log aaye is hafte", ["lookup_data_sources", "lookup_analytics"]],
  ["mere instagram pe kitne followers hain", ["lookup_data_sources"]],
  ["how much revenue did we make this month", ["lookup_data_sources"]],
  ["¿cuántos seguidores tengo en redes sociales?", ["lookup_data_sources"]],
  // ── everyday questions that used to be gated by keyword lists
  ["kitne article likhe hain abhi tak", ["lookup_content"]],
  ["site pe kya issue hai", ["lookup_site_audit"]],
  ["agla article kab aayega", ["lookup_schedule"]],
  ["hamari company ke baare mein kya pata hai tumhe", ["lookup_business_profile"]],
  ["hi", ["answer_question"]],
  ["thanks bhai", ["answer_question"]],
  // ── orders about content that already exists, in other languages
  ["isko reject kar do ye draft theek nahi", ["reject_draft"]],
  ["retira el artículo de la web por favor", ["take_down_article"]],
  ["wo booking cancel kar do", ["cancel_booking"]],
  ["isko publish kar do", ["publish_existing"]],
  ["publish mat karna abhi, sirf draft rakho", ["answer_question", "write_article"]],
  ["اكتب لي مقالا عن الشهادات", ["write_article"]],
  ["আমার লিডদের সাথে কথা বলতে পারো?", ["lookup_autopilot", "answer_question"]],
  // ── the autopilot: control and questions
  ["autopilot on karo", ["manage_autopilot"]],
  ["sab kuch automatic chalu kar do leads ka", ["manage_autopilot"]],
  ["pause everything, stop messaging leads for now", ["manage_autopilot"]],
  ["roz 20 leads dhundo", ["manage_autopilot"]],
  ["messages sirf subah 10 se shaam 6 ke beech bhejo", ["manage_autopilot"]],
  ["follow-up band kar do", ["manage_autopilot"]],
  ["activa el piloto automático de leads", ["manage_autopilot"]],
  ["autopilot kaisa chal raha hai", ["lookup_autopilot"]],
  ["kya sab kuch auto chal raha hai", ["lookup_autopilot"]],
  ["roz subah 9 baje article banao", ["manage_schedule"]],
  ["abhi 10 leads dhundo", ["find_leads"]],
];

async function main() {
  const { extractIntent } = await import("./chat-brain-intent");
  let failed = 0;
  for (const [q, ok] of CASES) {
    const plan: any = await extractIntent(q, REGISTRY, { tz: "Asia/Dubai" });
    const name = String(plan?.action ?? "?");
    const pass = ok.includes(name);
    if (!pass) failed++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${q}\n      -> ${name}   (wanted ${ok.join(" | ")})`);
  }
  console.log(failed ? `\n${failed} routed wrongly` : "\nAll routed correctly");
  process.exit(failed ? 1 : 0);
}
main();
