/** LIVE golden conversations — runs every scenario in golden.ts through the REAL model.
 *
 *    cd agent-server && npx tsx src/lib/whatsapp/golden.live.ts            # all scenarios
 *    cd agent-server && npx tsx src/lib/whatsapp/golden.live.ts price      # ids containing "price"
 *
 *  Needs the same NVIDIA keys the server uses (agent-server/.env). Not part of `npm test`: it costs a
 *  model call per scenario and a model's wording varies run to run, so it is a gate you run BY HAND —
 *  before and after any change to the reply prompt (decide.ts) — not a flaky CI step. Exit code 1 if
 *  any scenario fails, so it can also gate a deploy script.
 *
 *  It applies exactly the production path: buildReplyPrompt → completeJson(system) → parseDecision →
 *  the code-enforced handoff floor. Nothing is sent anywhere and nothing is written to a database. */
import "dotenv/config";
import { SCENARIOS } from "./golden.js";
import { buildReplyPrompt, parseDecision, REPLY_LLM } from "./decide.js";
import { completeJson } from "../llm.js";

const BUSINESS_WITH_PRICE = [
  "Business name: wca-global.com",
  "You write as: Sami from wca-global.com",
  "What we do: ISO consultancy — we help companies implement and get certified for standards like ISO 9001, 14001 and 45001.",
  "We offer: ISO 9001 certification, ISO 14001, ISO 45001, internal audits, staff training",
  "Pricing: priced per quote — AED 4,000-9,000 for ISO 9001, depends on company size",
  "Proven facts: 300+ companies certified; certification typically takes 3-4 months",
].join("\n");
const BUSINESS_NO_PRICE = BUSINESS_WITH_PRICE.replace(/Pricing:.*/, "Pricing: NOT PROVIDED to you.");

const HINGLISH_REPLY = /\b(hai|hain|aap|aapka|aapki|aapke|apka|apki|ke|ka|ki|ko|kya|nahi|batao|bataiye|karo|kar|karenge|mein|se|ek|toh|abhi|bilkul|theek|ji|haan|kijiye|dijiye|liye|bhi|aur|hamara|hamari|pe|par|bhej|dunga|denge|chahiye|sakte|sakta|hota|hoti)\b/i;
const filter = process.argv[2] ?? "";
let failed = 0;

for (const sc of SCENARIOS.filter((s) => s.id.includes(filter))) {
  const built = buildReplyPrompt({
    business: sc.pricing ? BUSINESS_WITH_PRICE : BUSINESS_NO_PRICE,
    pricingProvided: sc.pricing,
    lead: { company: "Acme Trading", city: "Dubai" },
    thread: sc.thread,
  });
  const problems: string[] = [];
  let reply = "";
  try {
    const raw = await completeJson<Record<string, unknown>>(built.user, { system: built.system, ...REPLY_LLM });
    const d = parseDecision(raw);
    reply = d.reply;
    const needsHuman = d.needs_human || built.handoffFloor.yes;
    if (sc.expect.handoff && !needsHuman) problems.push("a person should have been pulled in, was not");
    if (d.action !== "reply") problems.push(`expected a reply, got action="${d.action}"`);
    if (reply.length > 500) problems.push(`too long (${reply.length} chars) for WhatsApp`);
    for (const re of sc.expect.replyMatches ?? []) if (!re.test(reply)) problems.push(`should match ${re}`);
    // "Reply in their language" is not met by English that merely avoids Devanagari: a Hinglish
    // customer's reply must itself contain Hinglish (found live 2026-11-13 — the model answered the
    // Hinglish complaint in plain English and the Devanagari-only check let it through).
    if (sc.expect.lang === "hinglish" && !HINGLISH_REPLY.test(reply)) problems.push("customer writes Hinglish but the reply is plain English");
    for (const re of sc.expect.replyAvoids ?? []) if (re.test(reply)) problems.push(`must not match ${re}`);
  } catch (e: any) {
    problems.push(`model call failed: ${e?.message}`);
  }
  const ok = problems.length === 0;
  if (!ok) failed++;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${sc.id}  [${built.lang}]`);
  console.log(`  last customer line: ${[...sc.thread].reverse().find((m) => m.direction === "in")?.body}`);
  console.log(`  reply: ${reply || "(none)"}`);
  for (const p of problems) console.log(`  ✖ ${p}   — ${sc.why}`);
}

console.log(`\n${failed ? `${failed} scenario(s) FAILED` : "All scenarios passed"}`);
process.exit(failed ? 1 : 0);
