/** Run: cd agent-server && npx tsx --test src/lib/articleReview.test.ts
 *
 *  The hard review (documnet/Article_Writing_Rules.md, every section forced). No network: links
 *  are checked by an injected function and the model is a fake keyed by step label, the same
 *  convention writerPipeline.test.ts uses.
 *
 *  The fixture is built, not typed, so every number the rules measure is exact: each section's
 *  answer is 44 words, and its sentence lengths (5,14,25 | 9,20,4,17 | 28,11,6,19) never put three
 *  sentences in a row within 5 words of each other. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { checkArticle, runArticleReview, splitArticle, assembleArticle, stampByline, REVIEW_MAX_ROUNDS } = await import("./articleReview.js");

const KW = "emergency plumber in Leeds";
const SITE = "https://example.com";
const NOW = new Date(Date.UTC(2026, 8, 13));
const LINKS = [
  { url: "https://example.com/emergency", title: "Emergency call-outs" },
  { url: "https://example.com/areas", title: "Areas we cover" },
  { url: "https://example.com/prices", title: "Prices" },
  { url: "https://www.watersafe.org.uk/", title: "WaterSafe register" },
  { url: "https://www.gov.uk/plumbing", title: "GOV.UK plumbing guidance" },
];
const INPUT = {
  title: "Emergency plumber in Leeds: what to do in the first hour",
  topic: KW,
  primaryKeyword: KW,
  siteUrl: SITE,
  author: "Leeds Plumbing Co",
  allowedLinks: LINKS,
};
const alwaysLive = async () => true;

const VOCAB = ["water", "pipe", "valve", "leak", "floor", "kitchen", "visit", "morning", "crew", "boiler", "tap", "drain", "bill", "house", "street", "engineer", "hour", "week", "ceiling", "radiator", "meter", "tank", "wall", "garden", "landlord", "tenant", "van", "toolkit", "sink", "hallway"];
let cursor = 0;

/** A sentence of exactly `n` words starting with `first`, optionally ending on a one-word link. */
function s(n: number, first: string, link?: string): string {
  const w = first.split(" ");
  while (w.length < n) w.push(VOCAB[cursor++ % VOCAB.length]);
  if (link) w[w.length - 1] = `[${w[w.length - 1]}](${link})`;
  return w.join(" ") + ".";
}

function section(h2: string, opener: string, extra: string[] = [], links: (string | undefined)[] = []): string {
  return [
    `## ${h2}`,
    ``,
    [s(5, opener), s(14, "Most"), s(25, "Crews")].join(" "),
    ``,
    ...extra,
    [s(9, "Leeds"), s(20, "Every", links[0]), s(4, "Call"), s(17, "Some")].join(" "),
    ``,
    [s(28, "Night"), s(11, "Our", links[1]), s(6, "Book"), s(19, "Engineers")].join(" "),
  ].join("\n");
}

const LIST_H2 = "How to prepare before the plumber arrives?";
const SECOND_H2 = "What counts as a plumbing emergency?";
const VERDICT_H2 = "What is our verdict on calling an emergency plumber?";

function goodArticle(): string {
  cursor = 0;
  return [
    `# ${INPUT.title}`,
    ``,
    [s(12, "An emergency plumber in Leeds"), s(5, "Speed"), s(22, "This")].join(" "),
    ``,
    section(`How fast does an ${KW} arrive?`, "Within", [], [LINKS[0].url, LINKS[3].url]),
    ``,
    section(SECOND_H2, "Water", [], [LINKS[1].url, LINKS[4].url]),
    ``,
    section(LIST_H2, "Five", [
      "- Turn off the main stopcock",
      "- Move rugs and boxes away",
      "- Switch off the boiler power",
      "- Open taps to drain pipes",
      "- Photograph the damage for insurance",
      "",
    ]),
    ``,
    section("What does a call-out cost in Leeds?", "Prices", ["| Time of call | Call-out fee |", "| --- | --- |", "| Weekday daytime | 65 pounds |", "| Evenings and weekends | 90 pounds |", ""], [LINKS[2].url]),
    ``,
    section(VERDICT_H2, "Call"),
    ``,
    `## Quick answers about emergency plumbers in Leeds`,
    ``,
    `- **Do they charge more at night?** Yes, overnight visits cost more than daytime ones.`,
    `- **Can they fix a burst pipe the same day?** Usually, once the water is isolated first.`,
    `- **Is a slow drip an emergency?** No, book it as a routine visit instead.`,
  ].join("\n");
}

const stamped = (body: string) => stampByline(body, NOW, INPUT.author);
const failing = <T extends { ok: boolean }>(checks: T[]) => checks.filter((c) => !c.ok);
const describe = (checks: { ok: boolean; id: string; section: string | null; detail: string }[]) =>
  failing(checks)
    .map((c) => `${c.id} @ ${c.section ?? "article"}: ${c.detail}`)
    .join("\n");

/* ---------------------------------------------------------------- the checks -------------- */

test("a draft that meets every rule passes every check", async () => {
  const { passed, checks } = await checkArticle(stamped(goodArticle()), INPUT, alwaysLive);
  assert.equal(passed, true, describe(checks));
  assert.ok(checks.length > 40, "every section is checked against every rule, not a summary");
});

test("an em dash fails only the section it is in, and is fixed by rewriting that section", async () => {
  const body = stamped(goodArticle()).replace("\n\nWater ", "\n\nWater— ");
  const { passed, checks } = await checkArticle(body, INPUT, alwaysLive);
  assert.equal(passed, false);
  const bad = failing(checks);
  assert.deepEqual(bad.map((c) => [c.id, c.section, c.fix]), [["em-dash", SECOND_H2, "section"]], describe(checks));
});

test("a heading that is not a real question is failed", async () => {
  const body = stamped(goodArticle()).replace(`## ${SECOND_H2}`, "## Plumbing emergencies explained");
  const { checks } = await checkArticle(body, INPUT, alwaysLive);
  const c = failing(checks).find((x) => x.id === "question-heading");
  assert.ok(c, describe(checks));
  assert.equal(c!.section, "Plumbing emergencies explained");
});

test("an answer paragraph outside 40-58 words is failed", async () => {
  const body = stamped(goodArticle()).replace("\n\nWater ", "\n\nWater " + "tank ".repeat(30));
  const { checks } = await checkArticle(body, INPUT, alwaysLive);
  const c = failing(checks).find((x) => x.id === "snippet-answer");
  assert.ok(c, describe(checks));
  assert.match(c!.detail, /74 words/);
});

test("one banned filler word fails the section, with zero tolerance", async () => {
  const body = stamped(goodArticle()).replace(" Most ", " Moreover ");
  const { checks } = await checkArticle(body, INPUT, alwaysLive);
  const c = failing(checks).find((x) => x.id === "banned-phrases");
  assert.ok(c, describe(checks));
  assert.match(c!.detail, /"moreover"/);
  assert.equal(c!.section, `How fast does an ${KW} arrive?`);
});

test("a how-to heading needs a 5-8 item list of short items", async () => {
  const body = stamped(goodArticle()).replace("- Switch off the boiler power\n- Open taps to drain pipes\n", "");
  const { checks } = await checkArticle(body, INPUT, alwaysLive);
  const c = failing(checks).find((x) => x.id === "list-shape");
  assert.ok(c, describe(checks));
  assert.equal(c!.section, LIST_H2);
});

test("an article with no verdict section is failed as a whole-article rule", async () => {
  const body = stamped(goodArticle()).replace(`## ${VERDICT_H2}`, "## When is a leak worth a call-out?");
  const { checks } = await checkArticle(body, INPUT, alwaysLive);
  const c = failing(checks).find((x) => x.id === "verdict-section");
  assert.ok(c, describe(checks));
  assert.equal(c!.fix, "article");
});

test("a link that does not load is failed against the section it sits in", async () => {
  const { checks } = await checkArticle(stamped(goodArticle()), INPUT, async (url) => !url.includes("gov.uk"));
  const c = failing(checks).find((x) => x.id === "live-links");
  assert.ok(c, describe(checks));
  assert.equal(c!.section, SECOND_H2);
  assert.match(c!.detail, /gov\.uk/);
});

test("three sentences in a row of about the same length fail the rhythm rule", async () => {
  cursor = 0;
  const body = stamped([`# T`, ``, `## How long does it take?`, ``, [s(15, "First"), s(15, "Second"), s(14, "Third")].join(" ")].join("\n"));
  const { checks } = await checkArticle(body, INPUT, alwaysLive);
  const c = failing(checks).find((x) => x.id === "sentence-rhythm");
  assert.ok(c, describe(checks));
  assert.match(c!.detail, /15, 15 and 14 words/);
});

test("no real outside sources on file: the external-link rule is skipped, never met with an invented URL", async () => {
  const noSources = { ...INPUT, allowedLinks: LINKS.slice(0, 3) };
  const body = stamped(goodArticle()).replace(`(${LINKS[3].url})`, "").replace(`(${LINKS[4].url})`, "").replace(/\[(\w+)\]\(?/g, (m, w) => (m.endsWith("(") ? m : w));
  const { checks } = await checkArticle(body, noSources, alwaysLive);
  const c = checks.find((x) => x.id === "external-links")!;
  assert.equal(c.ok, true);
  assert.equal(c.skipped, true);
});

test("the byline is stamped by code, once, however many times it is stamped", () => {
  const once = stamped(goodArticle());
  const twice = stamped(once);
  assert.equal(twice, once);
  assert.equal(twice.split("\n").filter((l) => l.startsWith("*Last updated:")).length, 1);
  assert.match(twice, /\*Last updated: 13 September 2026 · By Leeds Plumbing Co\*/);
  const split = splitArticle(twice);
  assert.equal(split.parts.length, 7, "the introduction plus six sections");
  assert.equal(assembleArticle(split), assembleArticle(splitArticle(goodArticle())));
});

/* ---------------------------------------------------------------- the loop ---------------- */

function fakeComplete(handlers: Record<string, (prompt: string) => string>) {
  const calls: { label: string; prompt: string }[] = [];
  const fn = async (prompt: string, opts?: { maxTokens?: number; label?: string }) => {
    const label = opts?.label ?? "?";
    calls.push({ label, prompt });
    const h = handlers[label];
    if (!h) throw new Error(`fakeComplete: no handler for "${label}"`);
    return h(prompt);
  };
  return { fn, calls };
}

const partOf = (prompt: string) => prompt.split("PART TO REWRITE:\n<<<\n")[1].split("\n>>>")[0];
const passAudit = () => JSON.stringify({ passed: true, issues: [] });

test("a failing section is rewritten on its own, re-checked, and the review passes", async () => {
  const events: { kind: string; payload: any }[] = [];
  const { fn, calls } = fakeComplete({
    "writer.section-rewrite": (p) => partOf(p).replace(/—/g, "-"),
    "writer.humanize-audit": passAudit,
  });
  const out = await runArticleReview(goodArticle().replace("\n\nWater ", "\n\nWater— "), INPUT, {
    complete: fn,
    checkLink: alwaysLive,
    now: () => NOW,
    onEvent: (kind, payload) => events.push({ kind, payload }),
  });

  assert.equal(out.passed, true, out.failures.join("\n"));
  assert.equal(out.rounds, 2);
  assert.equal(out.sectionRewrites, 1);
  const rewrites = calls.filter((c) => c.label === "writer.section-rewrite");
  assert.equal(rewrites.length, 1, "only the one failing section is rewritten");
  assert.match(rewrites[0].prompt, /No em dashes: 1 em dash/);
  assert.ok(!out.body.includes("—"));

  const kinds = events.map((e) => `${e.kind}${e.payload.status ? `:${e.payload.status}` : ""}${e.payload.stage ? `:${e.payload.stage}` : ""}`);
  assert.deepEqual(kinds, [
    "review_round:rules",
    "review_result:rules",
    "section_rewrite:rewriting",
    "section_rewrite:done",
    "section_revised",
    "review_round:rules",
    "review_result:rules",
    "review_round:humanize",
    "review_result:humanize",
    "review_final",
  ]);
  assert.equal(events[1].payload.passed, false);
  assert.equal(events[2].payload.section, SECOND_H2);
  assert.equal(events[4].payload.replaces, SECOND_H2);
  assert.equal(events[events.length - 1].payload.passed, true);
});

test("a line the independent reviewer flags is mapped to its section and only that section is rewritten", async () => {
  const body = goodArticle();
  const quote = body.split(`## ${LIST_H2}\n\n`)[1].split(".")[0];
  let audits = 0;
  const { fn, calls } = fakeComplete({
    "writer.section-rewrite": (p) => partOf(p),
    "writer.humanize-audit": () =>
      ++audits === 1
        ? JSON.stringify({ passed: false, issues: [{ rule: "Missing experience signal", quote, fix: "Add one concrete scenario from real practice." }] })
        : passAudit(),
  });
  const out = await runArticleReview(body, INPUT, { complete: fn, checkLink: alwaysLive, now: () => NOW });

  assert.equal(out.passed, true, out.failures.join("\n"));
  const rewrites = calls.filter((c) => c.label === "writer.section-rewrite");
  assert.equal(rewrites.length, 1);
  assert.ok(rewrites[0].prompt.includes(`## ${LIST_H2}`));
  assert.match(rewrites[0].prompt, /Missing experience signal/);
});

test("a section the model cannot fix stops after the round cap and does not pass", async () => {
  const events: { kind: string; payload: any }[] = [];
  const { fn, calls } = fakeComplete({
    "writer.section-rewrite": (p) => partOf(p),
    "writer.humanize-audit": passAudit,
  });
  const out = await runArticleReview(goodArticle().replace("\n\nWater ", "\n\nWater— "), INPUT, {
    complete: fn,
    checkLink: alwaysLive,
    now: () => NOW,
    onEvent: (kind, payload) => events.push({ kind, payload }),
  });

  assert.equal(out.passed, false);
  assert.equal(out.rounds, REVIEW_MAX_ROUNDS);
  assert.equal(calls.filter((c) => c.label === "writer.section-rewrite").length, REVIEW_MAX_ROUNDS - 1);
  assert.ok(out.failures.some((f) => f.includes("em dash")), out.failures.join("\n"));
  const final = events[events.length - 1];
  assert.equal(final.kind, "review_final");
  assert.equal(final.payload.passed, false);
});

test("if the independent reviewer cannot run, the article does not pass on its silence", async () => {
  const { fn } = fakeComplete({
    "writer.humanize-audit": () => {
      throw new Error("NVIDIA timed out");
    },
  });
  const out = await runArticleReview(goodArticle(), INPUT, { complete: fn, checkLink: alwaysLive, now: () => NOW });
  assert.equal(out.passed, false);
  assert.equal(out.rounds, 2);
  assert.match(out.auditError ?? "", /NVIDIA timed out/);
});
