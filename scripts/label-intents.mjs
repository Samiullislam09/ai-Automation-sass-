#!/usr/bin/env node
/**
 * Auto-label every real user chat message with an intent, into `intent_eval`.
 *
 * WHY. The new intent engine (rebuild plan §5.1) is an LLM, and an LLM is judged, not trusted.
 * The judge is this set: every message a real person typed into the chat, labelled once by
 * the model here and then checked by a person on /app/eval. lib/eval/README.md explains the
 * labels and the accuracy gate.
 *
 * USAGE (repo root; reads .env.local for NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * NVIDIA_API_KEY, optional CHAT_MODEL):
 *
 *   node scripts/label-intents.mjs --dry-run --limit 10   # print 10 labels, write nothing
 *   node scripts/label-intents.mjs                        # label everything not yet labelled
 *   node scripts/label-intents.mjs --limit 50
 *
 * Messages already in intent_eval are skipped, so it can be re-run as the chat grows.
 * Service role on purpose: it writes rows for every tenant, and RLS would hide them.
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
dns.setDefaultResultOrder("ipv4first");

// ── env ────────────────────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const nim = process.env.NVIDIA_API_KEY;
const MODEL = process.env.CHAT_MODEL || "openai/gpt-oss-120b";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function die(msg) { console.error("✕ " + msg); process.exit(1); }
if (!url || !svc) die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local)");
if (!nim) die("NVIDIA_API_KEY is required (.env.local)");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const limitIx = args.indexOf("--limit");
const LIMIT = limitIx >= 0 ? Number(args[limitIx + 1]) : DRY ? 10 : Infinity;
if (!(LIMIT > 0)) die("--limit needs a positive number");
const CONCURRENCY = 4;
const RETRIES = 3;

// ── label schema (mirror of lib/eval/intent-labels.ts — keep both in step) ────────────────
const INTENTS = ["write_article", "find_keywords", "plan_topics", "publish", "schedule", "cancel", "reject",
  "status", "connect", "question", "chitchat", "followup", "other"];
const DELIVERIES = ["approvals", "publish", "chat"];
const FOLLOWUP_KINDS = ["confirm", "deny", "choose", "change"];

const SYSTEM = `You label messages that users typed to "Mr Lxwa", the manager of a small AI marketing team (keyword research, article writing, SEO, publishing to their WordPress site). Users write English, Hinglish or Roman Urdu. Reply with ONE JSON object and nothing else.

Schema:
{
  "intent": ${INTENTS.map((i) => `"${i}"`).join(" | ")},
  "topic": string | null,
  "delivery": "approvals" | "publish" | "chat" | null,
  "when": string | null,
  "is_followup": boolean,
  "followup_kind": "confirm" | "deny" | "choose" | "change" | null,
  "ambiguous": boolean,
  "notes": string
}

Intents:
- write_article: they want a NEW article/blog/post written now (also "likh ke publish kar do" — writing wins over publishing).
- find_keywords: keyword or topic research only. "keywords for my next article" is find_keywords unless they also ask for the article. "article nahi likhna" / "sirf keywords" is always find_keywords, never write_article.
- plan_topics: "run the team", "kaam shuru karo", "is hafte ka content plan karo" — start general work, no specific topic.
- publish: push something that ALREADY exists live ("isko publish kar do", "publish the last one"). Nothing new is written.
- schedule: change the recurring timetable or automation ("roz subah 9 baje 3 article", "automation band kar do", "daily 2 posts").
- cancel: call off something booked ("cancel kar do", "wo schedule hata do", "rok do").
- reject: throw away a draft ("reject kar do", "delete this draft").
- status: checking on work or on their own current setup ("kya update hai", "article likha?", "kitne article bane", "mera schedule kya hai", "mera plan kya hai", "kitne tokens bache") — a lookup of THEIR state, not general knowledge.
- connect: connecting or changing the website / WordPress / Google / integrations.
- question: asking how something works, what the product does, SEO advice, pricing, "kya tum X kar sakte ho".
- chitchat: hi, hello, thanks, ok, testing, small talk.
- followup: the message is ONLY meaningful as a reply to the previous assistant turn: "haan", "yes", "mat karna", "nahi", "pehla wala", "2", "solar ki jagah wind". Set is_followup=true and followup_kind. If the reply also carries a full new order ("haan, aur solar pe likho"), use the order's intent and still set is_followup=true.
- other: none of the above (pasted URL alone, gibberish, complaint with no request).

Rules:
- Negation decides: "mat likho", "don't write", "publish mat karna" is never write_article / publish. "publish mat karna" replying to a publish question = followup/deny; said on its own about a pending order = cancel only if it names something booked, otherwise "other" with a note.
- topic: ONLY the subject ("ISO 9001 certification", "local SEO for dentists"). Never the request words (article, blog, keyword, content) and never the whole sentence. null if none.
- delivery: "publish" if they say to publish/live/site pe daal do; "approvals" if they say draft/review/approval; "chat" for keywords/brief/answers wanted in the chat; null when not said. For write_article with nothing said, null (do not guess).
- when: copy the time phrase exactly as written ("30 min baad", "kal 9 baje", "tomorrow morning"), else null. Do not compute a time.
- ambiguous: true when two readings are reasonable. Explain in notes (one short sentence). notes may be "" otherwise.
- Never invent an intent outside the list. When unsure between an action and non-action, prefer the non-action (question/status/other) and set ambiguous=true.`;

// ── supabase REST ─────────────────────────────────────────────────────────────────────────
const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
const rest = (p, init) => fetch(url + "/rest/v1/" + p, { ...init, headers: { ...H, ...(init?.headers || {}) } });

async function fetchAll(pathBase) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await rest(pathBase, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) die(`read failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const messages = await fetchAll("chat_messages?select=id,conversation_id,tenant_id,role,content,kind,created_at&order=conversation_id,created_at");
// The table may not exist yet (018 not applied). A dry run can still show labels; a real run
// would fail on the first write with a clear message, so say so up front.
const evalProbe = await rest("intent_eval?select=message_id&limit=1");
if (!evalProbe.ok && !DRY) die(`intent_eval is not readable (${evalProbe.status}) — apply supabase/migrations/018_intent_eval.sql first`);
if (!evalProbe.ok) console.warn(`! intent_eval not readable (${evalProbe.status}); dry run continues as if it were empty\n`);
const done = new Set(evalProbe.ok ? (await fetchAll("intent_eval?select=message_id")).map((r) => r.message_id) : []);

// Pair each user turn with the assistant turn just before it in the same conversation.
// Team-report "events" are skipped for both sides — nobody said them.
const candidates = [];
let prior = null, lastConv = null;
for (const m of messages) {
  if (m.conversation_id !== lastConv) { prior = null; lastConv = m.conversation_id; }
  if (m.kind === "event") continue;
  if (m.role === "assistant") { prior = m; continue; }
  if (m.role !== "user") continue;
  if (!done.has(m.id) && String(m.content).trim()) candidates.push({ ...m, prior_assistant: prior?.content ?? null });
  prior = null; // a user turn without an assistant reply in between is not a follow-up to it
}
const todo = candidates.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(`${messages.length} chat rows · ${candidates.length} user messages not yet labelled · labelling ${todo.length}${DRY ? " (dry run)" : ""}\n`);

// ── model ─────────────────────────────────────────────────────────────────────────────────
const modelParams = /gpt-oss/i.test(MODEL) ? { reasoning_effort: "low" }
  : /nemotron/i.test(MODEL) ? { chat_template_kwargs: { thinking: false } } : {};

function normalize(raw) {
  if (!raw || typeof raw !== "object" || !INTENTS.includes(raw.intent)) return null;
  const str = (v) => { const s = String(v ?? "").trim(); return s && s.toLowerCase() !== "null" ? s.slice(0, 200) : null; };
  return {
    intent: raw.intent,
    topic: str(raw.topic),
    delivery: DELIVERIES.includes(raw.delivery) ? raw.delivery : null,
    when: str(raw.when),
    is_followup: raw.is_followup === true || raw.intent === "followup",
    followup_kind: FOLLOWUP_KINDS.includes(raw.followup_kind) ? raw.followup_kind : null,
    ambiguous: raw.ambiguous === true,
    notes: str(raw.notes) ?? "",
  };
}

async function label(msg) {
  const user = [
    msg.prior_assistant ? `Previous assistant turn:\n${String(msg.prior_assistant).slice(0, 500)}\n` : "Previous assistant turn: (none)\n",
    `User message:\n${String(msg.content).slice(0, 800)}`,
  ].join("\n");
  let lastErr = "";
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${nim}` },
        body: JSON.stringify({
          model: MODEL, stream: false, temperature: 0, max_tokens: 400, ...modelParams,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) { lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`; if (res.status === 429 || res.status >= 500) { await sleep(1500 * attempt); continue; } break; }
      const data = await res.json();
      const raw = String(data?.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const out = normalize(parsed);
      if (out) return out;
      lastErr = `unusable reply: ${raw.slice(0, 120)}`;
    } catch (e) {
      lastErr = e?.message ?? String(e);
      await sleep(1000 * attempt);
    }
  }
  return { error: lastErr };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── run, 4 at a time ──────────────────────────────────────────────────────────────────────
const results = new Array(todo.length);
let next = 0, failed = 0;
async function worker() {
  while (next < todo.length) {
    const i = next++;
    const m = todo[i];
    const r = await label(m);
    results[i] = r;
    if (r.error) { failed++; console.log(`✕ ${m.id}  ${JSON.stringify(m.content.slice(0, 60))}  ${r.error}`); continue; }
    if (DRY) {
      console.log(`— prior: ${m.prior_assistant ? JSON.stringify(m.prior_assistant.slice(0, 100)) : "(none)"}`);
      console.log(`  user : ${JSON.stringify(m.content.slice(0, 160))}`);
      console.log(`  label: ${JSON.stringify(r)}\n`);
    } else {
      const up = await rest("intent_eval?on_conflict=message_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          message_id: m.id, tenant_id: m.tenant_id, text: m.content, prior_assistant: m.prior_assistant,
          auto_label: r, auto_model: MODEL, status: "auto",
        }),
      });
      if (!up.ok) { failed++; console.log(`✕ write failed for ${m.id}: ${up.status} ${await up.text()}`); continue; }
      console.log(`✓ ${r.intent.padEnd(14)} ${JSON.stringify(m.content.slice(0, 70))}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

// ── summary ───────────────────────────────────────────────────────────────────────────────
const counts = {};
for (const r of results) if (r && !r.error) counts[r.intent] = (counts[r.intent] ?? 0) + 1;
console.log("\nintent            count");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(18)}${v}`);
console.log(`${"failed".padEnd(18)}${failed}`);
console.log(`\n${todo.length - failed} labelled${DRY ? " (nothing written — drop --dry-run to write)" : ""}, model ${MODEL}.`);
if (failed) process.exit(2);
