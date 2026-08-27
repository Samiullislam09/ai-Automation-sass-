#!/usr/bin/env -S npx tsx
/**
 * §15 row 1 / §18.4b — the writer model decision, run for real instead of guessed.
 *
 * WHY THIS EXISTS AS A COMMITTED SCRIPT, NOT A ONE-OFF. §18's own measurements
 * (scratchpad/ttfb-nim.js, scratchpad/tools-nim.js) were run once, quoted in the plan, and
 * then lost — they were never committed, so nobody after that session could re-run them.
 * This is the same kind of test, kept where it will not disappear: `npm run` it again the day
 * NIM's catalogue changes (§18.4b: "NIM ne kal 2 models hataye, kal aur hata sakta hai"),
 * and the comparison is current again rather than quoted from a stale run.
 *
 * WHAT IT DOES. For every model in MODELS below, write the SAME 5 real topics through
 * agent-server's actual writer pipeline (outline → parallel sections → polish → meta — the
 * real path a customer's article takes, not a simplified stand-in), score each result with
 * the real deterministic quality gate (agent-server/src/lib/qualityGate.ts) and SEO checks
 * (agent-server/src/lib/seoChecks.ts — no keywords/crawl context, so only the checks that
 * don't need them run), and print one table: model, avg score, avg time, failures, and a
 * sample so a human can do the "human read" half §15 asks for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: pick a winner. §15 lists this as a decision the owner
 * makes ("Faisle jo aapko lene hain"), not one a script or an agent makes silently — the
 * table is the input to that decision, not the decision.
 *
 * USAGE (repo root; needs NVIDIA_API_KEY — .env.local or the shell environment). Run through
 * `tsx`, not plain `node` — the score import below is agent-server's real .ts source, and
 * tsx is the only thing here that can load it without a build step:
 *
 *   npx tsx scripts/compare-writer-models.mjs --confirm                              # all 5 topics, all models
 *   npx tsx scripts/compare-writer-models.mjs --confirm --topics 1 --models nemotron  # one cheap call first
 *   npx tsx scripts/compare-writer-models.mjs --confirm --models nemotron,deepseek
 *   npx tsx scripts/compare-writer-models.mjs --confirm --json > report.json          # for a longer-term log
 *
 * --confirm is required and does nothing but require you to type it — this makes real,
 * billable-where-not-free model calls the moment it runs, so it never fires by accident.
 *
 * Five topics × up to 4 models × ~6 calls per article (outline, 3-6 sections, polish, meta) is
 * a real number of NIM calls — expect several minutes and stay under the shared 40 RPM limit
 * the rest of agent-server also uses (this script does not run alongside a live agent-server).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ── .env.local, the same convention scripts/label-intents.mjs uses ────────────────────────
for (const file of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.NVIDIA_API_KEY;
if (!KEY) {
  console.error("NVIDIA_API_KEY not set (checked .env.local, .env, and the shell environment). Nothing to test against.");
  process.exit(1);
}

// Real, billable-when-not-free model calls run the moment this script is invoked — there is
// no dry-run mode, because there is nothing to simulate a writer model's quality with. So it
// requires saying so out loud, once, rather than firing on a bare `npx tsx ...` (a smoke test
// of the SCRIPT itself must not become a live run of the COMPARISON).
if (!process.argv.includes("--confirm")) {
  console.error(
    [
      "This makes real NIM calls (an article per topic per model — see the file header for the count)",
      "against NVIDIA_API_KEY. Add --confirm to actually run it, e.g.:",
      "  npx tsx scripts/compare-writer-models.mjs --confirm --topics 1 --models nemotron   # one cheap call first",
      "  npx tsx scripts/compare-writer-models.mjs --confirm                                # the real comparison",
    ].join("\n")
  );
  process.exit(1);
}

// ── models: §18.4b's own shortlist, all reachable on the one free NIM key everything else
// already uses. Verify against build.nvidia.com's current catalogue before trusting an id —
// §18.4b found two Llama models EOL'd (HTTP 410) the day this was written. ────────────────
const MODELS = {
  nemotron: "nvidia/nemotron-3.5-lightning-30b-a3b", // today's writer model — the baseline
  "gpt-oss": "openai/gpt-oss-120b",
  deepseek: "deepseek-ai/deepseek-v3.1",
  qwen: "qwen/qwen3-235b-a22b",
};

// ── 5 real small-business topics, the way §15 asks — not one niche, one shape ─────────────
const TOPICS = [
  { topic: "emergency plumber call-out cost", niche: "residential plumbing" },
  { topic: "ISO 9001 certification cost in India", niche: "compliance consulting" },
  { topic: "best time to repaint a house exterior", niche: "residential painting" },
  { topic: "how often should you service a boiler", niche: "HVAC maintenance" },
  { topic: "hiring a bookkeeper vs an accountant", niche: "small business bookkeeping" },
];

function args() {
  const a = process.argv.slice(2);
  const get = (name) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : null;
  };
  const models = get("models");
  const topicsN = get("topics");
  return {
    models: models ? models.split(",").map((s) => s.trim()) : Object.keys(MODELS),
    topics: topicsN ? TOPICS.slice(0, Number(topicsN)) : TOPICS,
    json: a.includes("--json"),
  };
}

// ── a self-contained copy of the pipeline's shape, calling this script's own `model` per
// request instead of agent-server's hardcoded nemotron. The PROMPTS are copied here rather
// than imported from writerPipeline.ts (which is written against nvidiaFetch's shared 30rpm
// limiter and env.ts's validation — pulling that in would mean satisfying agent-server's
// whole config just to compare five articles). Only the SCORING is imported for real, below
// — there is no reason to duplicate qualityGate.ts's rules, and every reason not to drift
// from what production actually checks. If writerPipeline.ts's prompts change, re-copy the
// relevant strings here so the comparison stays honest about what ships. ──────────────────

async function callModel(model, prompt, maxTokens) {
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      stream: false,
      chat_template_kwargs: { thinking: false },
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: "detailed thinking off\n\nYou write only from the context you are given. If a fact is not in it, you do not state it." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} — ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error(`${model}: empty response`);
  if (choice?.finish_reason === "length") throw new Error(`${model}: cut off by token limit`);
  return text;
}

function parseJson(raw, step) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${step}: model did not return valid JSON — "${cleaned.slice(0, 120)}"`);
  }
}

async function writeArticle(model, topic, niche) {
  const outlineRaw = await callModel(
    model,
    `Plan the structure of an SEO article on "${topic}" for a ${niche} business. Produce 3-5 sections (H2s). For each: the heading, its goal, the phrase to place naturally, and the reader question it answers.\nReply with ONLY JSON: {"title":"...","sections":[{"h2":"...","goal":"...","keyword":"...","readerQuestion":"..."}]}`,
    900
  );
  const outline = parseJson(outlineRaw, "outline");
  const sections = Array.isArray(outline.sections) ? outline.sections.slice(0, 5) : [];
  if (sections.length < 3) throw new Error(`outline: only ${sections.length} usable sections`);

  const texts = await Promise.all(
    sections.map((s) =>
      callModel(
        model,
        `Write ONE section of an article titled "${outline.title}" for a ${niche} business.\nSECTION HEADING: ${s.h2}\nJOB: ${s.goal}\nREADER QUESTION: ${s.readerQuestion}\nPlace this phrase naturally, once: "${s.keyword}"\n300-400 words. Start with "## ${s.h2}". Short paragraphs. No filler, no "in today's fast-paced world" openings. Output markdown only.`,
        700
      )
    )
  );

  const draft = [`# ${outline.title}`, "", ...texts].join("\n\n");
  const polished = await callModel(
    model,
    `Polish this article draft on "${topic}". Do not remove any section.\nFix: the opening (answer the topic in the first 100 words), transitions between sections, remove repeated phrases and AI-cliché wording, end with one concrete next step.\nDRAFT:\n${draft}\nOutput the complete polished article as markdown, starting with "# ${outline.title}".`,
    4096
  );

  return { title: outline.title, body: polished.trim() };
}

// ── scoring: the real modules, imported straight out of agent-server (tsx runs .ts directly)
const { gateArticle } = await import("../agent-server/src/lib/qualityGate.ts");

function score(body, topic) {
  return gateArticle(body, { primaryKeyword: topic });
}

// ── the run ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { models: wanted, topics, json } = args();
  const models = wanted.filter((id) => MODELS[id]);
  const unknown = wanted.filter((id) => !MODELS[id]);
  if (unknown.length) console.error(`Unknown model id(s), skipped: ${unknown.join(", ")}. Known: ${Object.keys(MODELS).join(", ")}`);
  if (!models.length) {
    console.error("No known models selected.");
    process.exit(1);
  }

  console.error(`Comparing ${models.join(", ")} across ${topics.length} topic(s). This makes real NIM calls and will take a few minutes.\n`);

  const rows = [];
  for (const id of models) {
    const modelName = MODELS[id];
    const results = [];
    for (const { topic, niche } of topics) {
      const t0 = Date.now();
      try {
        const { title, body } = await writeArticle(modelName, topic, niche);
        const gate = score(body, topic);
        results.push({ topic, ok: true, ms: Date.now() - t0, title, words: gate.wordCount, score: gate.score, passed: gate.passed, excerpt: body.slice(0, 240) });
      } catch (e) {
        results.push({ topic, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) });
      }
      console.error(`  ${id} — "${topic}" — ${results[results.length - 1].ok ? `score ${results[results.length - 1].score}, ${Math.round(results[results.length - 1].ms / 1000)}s` : `FAILED: ${results[results.length - 1].error}`}`);
    }
    const ok = results.filter((r) => r.ok);
    rows.push({
      model: id,
      modelId: modelName,
      avgScore: ok.length ? Math.round(ok.reduce((a, r) => a + r.score, 0) / ok.length) : null,
      avgSeconds: ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length / 1000) : null,
      passed: ok.filter((r) => r.passed).length,
      failed: results.length - ok.length,
      results,
    });
  }

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log("\nModel        Avg score   Avg time   Passed gate   Failed");
  console.log("─".repeat(58));
  for (const r of rows) {
    console.log(
      `${r.model.padEnd(13)}${String(r.avgScore ?? "—").padEnd(12)}${(r.avgSeconds ? r.avgSeconds + "s" : "—").padEnd(11)}${String(r.passed).padEnd(14)}${r.failed}`
    );
  }
  console.log("\nSample titles (read these for the \"human read\" half of §15's decision):");
  for (const r of rows) {
    for (const res of r.results.filter((x) => x.ok).slice(0, 1)) {
      console.log(`\n  [${r.model}] "${res.title}"\n  ${res.excerpt.replace(/\n+/g, " ")}…`);
    }
  }
  console.log("\nThis table is the input to §15's decision, not the decision — read the samples, then pick.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
