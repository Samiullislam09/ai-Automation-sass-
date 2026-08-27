/** Run: cd agent-server && npx tsx --test src/lib/qualityGate.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateArticle, summarizeGate, AI_CLICHES } from "./qualityGate.js";

const KW = "emergency plumber in Leeds";

/** Deterministic filler prose with varied sentence lengths, no clichés, no figures. */
function para(seed: number): string {
  const s = [
    `Most homeowners only think about their pipes when something goes wrong, and by then the water is already on the floor.`,
    `A quick check of the stopcock each spring saves a lot of that panic.`,
    `Turn it off, turn it on again, and make sure it moves freely without any stiffness or leaking around the spindle.`,
    `That is the whole job.`,
    `If the valve is seized, do not force it, because a snapped stopcock on a Sunday evening is exactly the kind of call nobody enjoys making.`,
    `Instead, note it down and have it replaced during a routine visit when the water can be isolated properly at the mains.`,
    `Insulating exposed pipework in the loft and garage is the other cheap job that prevents most winter burst pipes.`,
    `Foam sleeves cost very little and take an afternoon to fit.`,
  ];
  // Rotate the sentence order and alternate 3/4 sentences so every paragraph is distinct.
  const rot = s.slice(seed % s.length).concat(s.slice(0, seed % s.length));
  return rot.slice(0, 3 + (Math.floor(seed / s.length) % 2)).join(" ");
}

function goodArticle(): string {
  const parts = [
    `# Finding an emergency plumber in Leeds you can actually trust`,
    ``,
    `When you need an ${KW}, the first hour matters more than the price. This guide covers what to check before you call, what a reasonable response time looks like, and how to avoid paying twice for the same leak.`,
    ``,
  ];
  const headings = [
    `## What counts as a plumbing emergency`,
    `## How fast should an emergency plumber in Leeds arrive`,
    `## What to do while you wait`,
    `## Questions to ask before you agree to the work`,
    `## Preventing the next one`,
  ];
  let seed = 0;
  for (const h of headings) {
    parts.push(h, ``);
    for (let i = 0; i < 3; i++) parts.push(para(seed++), ``);
  }
  parts.push(`Our [emergency call-out page](https://example.com/emergency) explains the areas we cover.`, ``);
  parts.push(`If your stopcock is stiff or you have a slow drip that will not stop, book a routine visit before it becomes an emergency — call us today or contact the office online.`);
  return parts.join("\n");
}

test("good ~900-word article passes with a high score", () => {
  const body = goodArticle();
  const g = gateArticle(body, { primaryKeyword: KW });
  assert.ok(g.wordCount >= 850 && g.wordCount <= 1100, `wordCount=${g.wordCount}`);
  assert.equal(g.passed, true, summarizeGate(g));
  assert.ok(g.score >= 85, summarizeGate(g));
  assert.deepEqual(g.reasons, []);
  assert.ok(g.checks.length >= 10);
  assert.equal(g.links, 1);
  assert.ok(summarizeGate(g).startsWith(`QA ${g.score}/100`));
});

test("placeholder slot blocks", () => {
  const body = goodArticle().replace("first hour matters", "first hour [INSERT KEYWORD] matters");
  const g = gateArticle(body, { primaryKeyword: KW });
  assert.equal(g.passed, false);
  assert.ok(g.reasons.some((r) => /placeholder/i.test(r)), g.reasons.join("; "));
  const c = g.checks.find((c) => c.id === "placeholders");
  assert.equal(c?.ok, false);
  assert.equal(c?.severity, "block");
});

test("cliche-stuffed article blocks at >= 6 hits, warns at 3", () => {
  const cliches = AI_CLICHES.slice(0, 6).join(". ") + ".";
  const blocked = gateArticle(goodArticle() + "\n\n" + cliches, { primaryKeyword: KW });
  assert.equal(blocked.passed, false);
  const c = blocked.checks.find((c) => c.id === "ai-cliches");
  assert.equal(c?.severity, "block");
  assert.ok(blocked.reasons.some((r) => /AI-cliché/.test(r)));

  const three = AI_CLICHES.slice(0, 3).join(". ") + ".";
  const warned = gateArticle(goodArticle() + "\n\n" + three, { primaryKeyword: KW });
  assert.equal(warned.passed, true, summarizeGate(warned));
  assert.ok(warned.warnings.some((w) => /AI-cliché/.test(w)), warned.warnings.join("; "));
});

test("duplicate paragraph blocks", () => {
  const dup = para(1);
  const body = goodArticle() + "\n\n" + dup + "\n\n" + dup;
  const g = gateArticle(body, { primaryKeyword: KW });
  assert.equal(g.passed, false);
  assert.ok(g.reasons.some((r) => /repeated/.test(r)), g.reasons.join("; "));
});

test("short article blocks", () => {
  const body = `# Short\n\n## One\n\nToo short.\n\n## Two\n\nStill short.\n\n## Three\n\nNope.`;
  const g = gateArticle(body);
  assert.equal(g.passed, false);
  assert.ok(g.reasons.some((r) => /only \d+ words/.test(r)));
  assert.ok(g.score < 100);
});

test("missing primary keyword blocks; keyword not in H2 only warns", () => {
  const g = gateArticle(goodArticle(), { primaryKeyword: "boiler servicing" });
  assert.equal(g.passed, false);
  assert.ok(g.reasons.some((r) => /boiler servicing/.test(r)));
  const h2 = g.checks.find((c) => c.id === "keyword-in-h2");
  assert.equal(h2?.severity, "warn");
});

test("v1 shape is preserved and score maths hold", () => {
  const g = gateArticle(goodArticle(), { primaryKeyword: KW, metaTitle: "x", metaDescription: "y" });
  for (const k of ["wordCount", "sections", "links", "passed", "reasons"]) assert.ok(k in g, k);
  // Two bad meta fields => two warnings => -10 from whatever the clean score was.
  const clean = gateArticle(goodArticle(), { primaryKeyword: KW });
  assert.equal(g.score, clean.score - 10);
  assert.equal(g.passed, true, summarizeGate(g));
});
