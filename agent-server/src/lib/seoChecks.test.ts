/** Run: cd agent-server && npx tsx --test src/lib/seoChecks.test.ts
 *
 *  No network, no database. seoChecks.ts reaches env.ts (through dataforseo.ts and, via
 *  blueprint.ts, through supabase.ts) and env.ts THROWS on a missing DATABASE_URL rather than
 *  failing later and mysteriously — right for a server, wrong for a unit test — so the
 *  placeholders go in first and the module is imported dynamically after them, exactly as
 *  lib/dedupe.test.ts does it.
 *
 *  DATAFORSEO_* is emptied deliberately: that is what makes `dataForSeoConfigured()` false, and
 *  every test below therefore runs the free path with no HTTP call in it. The SERP checks are
 *  exercised by INJECTING a snapshot (`opts.serp`), which is the same code path a real fetch
 *  feeds, minus the fetch. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";
process.env.DATAFORSEO_LOGIN = "";
process.env.DATAFORSEO_PASSWORD = "";

const { runSeoChecks, summarizeSeo, SEO_PASS_SCORE } = await import("./seoChecks.js");
type Result = Awaited<ReturnType<typeof runSeoChecks>>;

const KW = "emergency plumber in Leeds";
const CLUSTER = [KW, "burst pipe repair", "boiler leak", "stopcock replacement"];

const PAGES = [
  { url: "https://leedsplumbing.co.uk/emergency", title: "Emergency call-out" },
  { url: "https://leedsplumbing.co.uk/boiler-repair", title: "Boiler repair" },
  { url: "https://leedsplumbing.co.uk/contact", title: "Contact" },
];

const PROFILE = {
  topic_clusters: [
    { name: "emergency plumbing", page_urls: ["https://leedsplumbing.co.uk/emergency"], centroid: null, size: 1 },
    { name: "boiler work", page_urls: ["https://leedsplumbing.co.uk/boiler-repair"], centroid: null, size: 1 },
  ],
} as any;

/* ---------------------------------------------------------------- fixtures -------------- */

/** Deterministic prose: varied sentence lengths, short paragraphs, every cluster keyword
 *  mentioned once, and the primary keyword used at a natural rate. */
function para(seed: number): string {
  const s = [
    `Most homeowners only think about their pipes when something goes wrong.`,
    `By then the water is usually already on the floor and the panic has started.`,
    `A quick check of the stopcock each spring saves a lot of that trouble.`,
    `Turn it off, turn it on again, and make sure it moves freely.`,
    `That is the whole job.`,
    `If the valve is seized, do not force it, because a snapped valve on a Sunday is a worse problem than a stiff one.`,
    `Note it down and have it swapped during a routine visit instead.`,
    `Insulating the pipework in the loft is the other cheap job worth doing.`,
    `Foam sleeves cost little and take an afternoon to fit.`,
    `Keep a towel and a bucket somewhere you can reach them in the dark.`,
  ];
  const rot = s.slice(seed % s.length).concat(s.slice(0, seed % s.length));
  return rot.slice(0, 3 + (seed % 2)).join(" ");
}

type Overrides = {
  title?: string;
  headings?: string[];
  extra?: string[];
  links?: string;
  paragraphsPerSection?: number;
  /** One keyword-bearing sentence per section, which is what puts the default fixture inside
   *  the natural density band. Turn it off to build an under-used draft. */
  keywordSentences?: boolean;
};

function articleBody(o: Overrides = {}): string {
  const title = o.title ?? `Emergency plumber in Leeds: what to do in the first hour`;
  const headings = o.headings ?? [
    `## When you need an emergency plumber in Leeds`,
    `## What counts as an emergency`,
    `## Burst pipe repair, step by step`,
    `## Boiler leak and stopcock replacement`,
    `## What it costs and what to ask`,
  ];
  const parts = [
    `# ${title}`,
    ``,
    `If you need an emergency plumber in Leeds tonight, the first hour matters more than the price. This guide covers what to check before you call and what a fair response time looks like.`,
    ``,
  ];
  let seed = 0;
  const per = o.paragraphsPerSection ?? 5;
  const kwLine = [
    `A good emergency plumber in Leeds will isolate the water before touching anything else.`,
    `Ask any emergency plumber in Leeds what the call-out fee covers before they set off.`,
    `An emergency plumber in Leeds carries the fittings for this on the van.`,
    `The emergency plumber in Leeds you called should test the joint before leaving.`,
    `Keep the number of an emergency plumber in Leeds on the fridge, not in a drawer.`,
  ];
  headings.forEach((h, idx) => {
    parts.push(h, ``);
    if (o.keywordSentences !== false) parts.push(kwLine[idx % kwLine.length], ``);
    for (let i = 0; i < per; i++) parts.push(para(seed++), ``);
  });
  parts.push(
    o.links ??
      `Our [emergency call-out page](https://leedsplumbing.co.uk/emergency) lists the areas we cover, and our [boiler repair page](/boiler-repair) explains the rest. The [WaterSafe register](https://www.watersafe.org.uk/) is where to check any plumber's credentials.`,
    ``,
  );
  for (const line of o.extra ?? []) parts.push(line, ``);
  parts.push(`Call the office before the next cold snap and we will book a routine check.`);
  return parts.join("\n");
}

function good(): Parameters<typeof runSeoChecks>[0] {
  return {
    body: articleBody(),
    metaDescription: `Need an emergency plumber in Leeds? Here is what to check before you call, what a fair response time looks like, and how to avoid paying twice for one leak.`,
    slug: `emergency-plumber-in-leeds`,
  };
}

const OPTS = { keywords: CLUSTER, pages: PAGES, profile: PROFILE, siteUrl: "https://leedsplumbing.co.uk" };

function check(r: Result, id: string) {
  const c = r.checks.find((x) => x.id === id);
  assert.ok(c, `no check with id "${id}" — ids: ${r.checks.map((x) => x.id).join(", ")}`);
  return c!;
}

/* ---------------------------------------------------------------- the clean draft ------- */

test("a clean draft passes, with every check accounted for", async () => {
  const r = await runSeoChecks(good(), OPTS);
  assert.deepEqual(r.blockers, [], summarizeSeo(r));
  assert.deepEqual(r.warnings, [], summarizeSeo(r));
  assert.equal(r.score, 100, summarizeSeo(r));
  assert.equal(r.passed, true);
  assert.equal(r.primaryKeyword, KW);
  assert.ok(r.wordCount > 400, `wordCount=${r.wordCount}`);
  // The only issue on a clean draft is the schema suggestion, which is `info` and free.
  assert.deepEqual(r.issues.map((i) => i.id), ["schema-suggestion"]);
  assert.ok(r.checks.length >= 20, `only ${r.checks.length} checks ran`);
  // Every failing check hands over a fix a writer could act on — never an empty string.
  for (const i of r.issues) assert.ok(i.fix.length > 10, `${i.id} has no usable fix`);
  assert.ok(summarizeSeo(r).startsWith("SEO 100/100"));
});

/* ---------------------------------------------------------------- title ----------------- */

test("title: missing blocks, wrong length warns, keyword position warns", async () => {
  const noTitle = await runSeoChecks({ body: articleBody().replace(/^# .*$/m, "") }, { keywords: CLUSTER });
  assert.equal(check(noTitle, "title-present").ok, false);
  assert.equal(check(noTitle, "title-present").severity, "block");
  assert.equal(noTitle.passed, false);

  const short = await runSeoChecks({ ...good(), metaTitle: "Plumber in Leeds" }, OPTS);
  const len = check(short, "title-length");
  assert.equal(len.ok, false);
  assert.equal(len.severity, "warn");
  assert.equal(len.value, "Plumber in Leeds".length);

  const long = await runSeoChecks(
    { ...good(), metaTitle: `The complete and exhaustive guide to hiring an emergency plumber in Leeds this winter` },
    OPTS,
  );
  assert.equal(check(long, "title-length").ok, false);
  // …and the keyword now starts well past character 30, which is its own warning.
  const pos = check(long, "title-keyword-position");
  assert.equal(pos.ok, false);
  assert.equal(pos.severity, "warn");
  assert.ok(Number(pos.value) > 30);
});

test("title without the keyword blocks", async () => {
  const r = await runSeoChecks({ ...good(), metaTitle: "What to do when a pipe bursts at night in Yorkshire" }, OPTS);
  const c = check(r, "title-keyword");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "block");
  assert.equal(r.passed, false);
  assert.ok(c.fix!.includes(KW));
});

test("no primary keyword: the keyword checks are skipped as info, not failed", async () => {
  const r = await runSeoChecks(good(), { pages: PAGES });
  for (const id of ["title-keyword", "keyword-density", "keyword-first-100"]) {
    const c = check(r, id);
    assert.equal(c.severity, "info");
    assert.equal(c.ok, true, `${id} should be skipped, not failed`);
  }
  assert.equal(r.primaryKeyword, null);
});

/* ---------------------------------------------------------------- meta ------------------ */

test("meta description: absent and over-long both warn, never block", async () => {
  const none = await runSeoChecks({ body: articleBody(), slug: "emergency-plumber-in-leeds" }, OPTS);
  const c = check(none, "meta-description");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "warn");
  assert.equal(c.value, 0);
  assert.equal(none.passed, true, summarizeSeo(none)); // one warning: 95, still over the mark

  const long = await runSeoChecks({ ...good(), metaDescription: "x".repeat(200) }, OPTS);
  assert.equal(check(long, "meta-description").ok, false);
  assert.equal(check(long, "meta-description").value, 200);
});

/* ---------------------------------------------------------------- headings -------------- */

test("two H1s block; one section blocks; two sections warn", async () => {
  const twoH1 = await runSeoChecks({ ...good(), body: articleBody() + "\n\n# A second title\n" }, OPTS);
  assert.equal(check(twoH1, "h1-unique").ok, false);
  assert.equal(check(twoH1, "h1-unique").severity, "block");
  assert.equal(twoH1.passed, false);

  const one = await runSeoChecks({ ...good(), body: articleBody({ headings: [`## Only section about an emergency plumber in Leeds`] }) }, OPTS);
  const c1 = check(one, "h2-count");
  assert.equal(c1.severity, "block");
  assert.equal(c1.ok, false);
  assert.equal(c1.value, 1);
  assert.equal(one.passed, false);

  const two = await runSeoChecks(
    { ...good(), body: articleBody({ headings: [`## Emergency plumber in Leeds`, `## Burst pipe repair and boiler leak`] }) },
    OPTS,
  );
  const c2 = check(two, "h2-count");
  assert.equal(c2.severity, "warn");
  assert.equal(c2.ok, false);
});

test("an H3 before the first H2 warns", async () => {
  const body = articleBody().replace("## When you need an emergency plumber in Leeds", "### A detail before any section");
  const r = await runSeoChecks({ ...good(), body }, OPTS);
  const c = check(r, "heading-order");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "warn");
});

test("keyword in no subheading warns; cluster coverage under half warns", async () => {
  const headings = [`## First thoughts`, `## Second thoughts`, `## Third thoughts`, `## Fourth thoughts`];
  const r = await runSeoChecks({ ...good(), body: articleBody({ headings }) }, OPTS);
  assert.equal(check(r, "keyword-in-heading").ok, false);
  assert.equal(check(r, "keyword-in-heading").severity, "warn");

  const cov = check(r, "secondary-keyword-coverage");
  assert.equal(cov.ok, false);
  assert.equal(cov.value, "0/3");
  assert.ok(cov.fix!.includes("burst pipe repair"));

  const noCluster = await runSeoChecks(good(), { ...OPTS, keywords: [KW] });
  assert.equal(check(noCluster, "secondary-keyword-coverage").severity, "info");
});

/* ---------------------------------------------------------------- keyword usage --------- */

test("a stuffed article is caught and blocked", async () => {
  const stuffing = Array.from({ length: 40 }, () => `The emergency plumber in Leeds is the emergency plumber in Leeds you want.`).join(" ");
  const r = await runSeoChecks({ ...good(), body: articleBody({ extra: [stuffing] }) }, OPTS);
  const c = check(r, "keyword-density");
  assert.equal(c.severity, "block");
  assert.equal(c.ok, false);
  assert.ok(Number(c.value) > 3.5, `density was ${c.value}%`);
  assert.equal(r.passed, false);
  assert.ok(c.fix!.match(/Cut the repetition/));
});

test("the keyword used once in a long article warns as under-used", async () => {
  const r = await runSeoChecks({ ...good(), body: articleBody({ paragraphsPerSection: 10, keywordSentences: false }) }, OPTS);
  const c = check(r, "keyword-density");
  assert.equal(c.severity, "warn");
  assert.equal(c.ok, false);
  assert.ok(Number(c.value) < 0.5, `density was ${c.value}%`);
});

test("keyword missing from the first 100 words blocks", async () => {
  const body = articleBody().replace(
    `If you need an emergency plumber in Leeds tonight, the first hour matters more than the price. This guide covers what to check before you call and what a fair response time looks like.`,
    [
      `The first hour matters more than the price when water is coming through a ceiling.`,
      para(1),
      para(2),
      para(3),
      para(4),
    ].join(" "),
  );
  const r = await runSeoChecks({ ...good(), body }, OPTS);
  const c = check(r, "keyword-first-100");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "block");
  assert.equal(r.passed, false);
});

/* ---------------------------------------------------------------- links ----------------- */

test("no internal links warns but never blocks, and the draft still passes", async () => {
  const r = await runSeoChecks({ ...good(), body: articleBody({ links: `The [WaterSafe register](https://www.watersafe.org.uk/) lists approved plumbers.` }) }, OPTS);
  const c = check(r, "internal-links");
  assert.equal(c.severity, "warn");
  assert.equal(c.ok, false);
  assert.equal(c.value, 0);
  assert.deepEqual(r.blockers, [], summarizeSeo(r));
  assert.equal(r.passed, true, summarizeSeo(r));
  // Nothing to verify (there are no internal links), so that check reports itself skipped;
  // "no link into this article's own cluster" is still true, and is still only a warning.
  assert.equal(check(r, "internal-links-resolve").severity, "info");
  assert.equal(check(r, "internal-links-cluster").severity, "warn");
  assert.equal(check(r, "internal-links-cluster").ok, false);
});

test("an internal link to a page we never crawled blocks", async () => {
  const links = `See our [pricing page](/prices-2024) and our [emergency call-out page](https://leedsplumbing.co.uk/emergency).`;
  const r = await runSeoChecks({ ...good(), body: articleBody({ links }) }, OPTS);
  const c = check(r, "internal-links-resolve");
  assert.equal(c.severity, "block");
  assert.equal(c.ok, false);
  assert.equal(c.value, 1);
  assert.ok(c.fix!.includes("/prices-2024"));
  assert.equal(r.passed, false);

  // With no crawled pages supplied there is nothing to check against, and we say so rather
  // than blocking on evidence we do not have.
  const blind = await runSeoChecks({ ...good(), body: articleBody({ links }) }, { keywords: CLUSTER });
  assert.equal(check(blind, "internal-links-resolve").severity, "info");
});

test("links that miss the article's own topic cluster warn; sources are checked separately", async () => {
  const links = `See our [contact page](https://leedsplumbing.co.uk/contact) and our [boiler repair page](/boiler-repair).`;
  const r = await runSeoChecks({ ...good(), body: articleBody({ links }) }, OPTS);
  const c = check(r, "internal-links-cluster");
  assert.equal(c.severity, "warn");
  assert.equal(c.ok, false);
  assert.ok(c.detail.includes("emergency plumbing"));

  // Those two links are internal, so nothing points outward any more.
  const ext = check(r, "external-links");
  assert.equal(ext.ok, false);
  assert.equal(ext.severity, "warn");
  assert.equal(ext.value, 0);

  // Without a profile the cluster preference cannot be judged and is skipped.
  const noProfile = await runSeoChecks(good(), { ...OPTS, profile: null });
  assert.equal(check(noProfile, "internal-links-cluster").severity, "info");
});

/* ---------------------------------------------------------------- images, slug ---------- */

test("an image with no alt text warns; no images at all is skipped", async () => {
  const r = await runSeoChecks({ ...good(), body: articleBody({ extra: [`![](https://leedsplumbing.co.uk/hero.jpg)`] }) }, OPTS);
  const c = check(r, "image-alt");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "warn");
  assert.equal(c.value, "0/1");

  const withAlt = await runSeoChecks(
    { ...good(), body: articleBody({ extra: [`![A plumber tightening a stopcock under a sink](https://leedsplumbing.co.uk/hero.jpg)`] }) },
    OPTS,
  );
  assert.equal(check(withAlt, "image-alt").ok, true);
  assert.equal(check(await runSeoChecks(good(), OPTS), "image-alt").severity, "info");
});

test("slug: length, casing, a year in it, and the missing keyword all warn", async () => {
  const r = await runSeoChecks({ ...good(), slug: "Best_Emergency_Plumbers_You_Can_Call_In_Leeds_And_Yorkshire_In_2024_Guide" }, OPTS);
  const c = check(r, "slug");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "warn");
  assert.ok(c.detail.includes("not lowercase-hyphenated"));
  assert.ok(c.detail.includes("contains a year"));

  assert.equal(check(await runSeoChecks({ ...good(), slug: undefined }, OPTS), "slug").severity, "info");
});

/* ---------------------------------------------------------------- readability ----------- */

test("long sentences and long paragraphs warn independently", async () => {
  // Capitalised because the sentence splitter needs a sentence to START like one — twelve of
  // these against a short article puts a third of it past the 30-word line.
  const monster = "Word " + Array.from({ length: 39 }, (_, i) => `padding${i}`).join(" ") + ".";
  const wall = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of a paragraph that simply refuses to end anywhere near a phone screen.`).join(" ");

  const longSentences = await runSeoChecks(
    { ...good(), body: articleBody({ paragraphsPerSection: 1, extra: Array.from({ length: 12 }, () => monster) }) },
    OPTS,
  );
  assert.equal(check(longSentences, "readability-sentences").ok, false);
  assert.equal(check(longSentences, "readability-sentences").severity, "warn");

  const longParas = await runSeoChecks({ ...good(), body: articleBody({ extra: [wall + " " + wall] }) }, OPTS);
  const p = check(longParas, "readability-paragraphs");
  assert.equal(p.ok, false);
  assert.ok(Number(p.value) > 150, `longest paragraph was ${p.value} words`);
});

/* ---------------------------------------------------------------- depth + schema -------- */

test("a thin article warns on depth; the schema suggestion is info and free", async () => {
  const thin = await runSeoChecks({ ...good(), body: articleBody({ paragraphsPerSection: 1 }) }, OPTS);
  const c = check(thin, "content-depth");
  assert.equal(c.ok, false);
  assert.equal(c.severity, "warn");
  assert.ok(Number(c.value) < 900);

  const schema = check(await runSeoChecks(good(), OPTS), "schema-suggestion");
  assert.equal(schema.severity, "info");
  assert.equal(schema.value, "Article");

  const faqHeadings = [
    `## What is an emergency plumber in Leeds?`,
    `## How fast should they arrive?`,
    `## Why does a burst pipe repair cost what it does?`,
    `## When is a boiler leak an emergency?`,
    `## Do I need a stopcock replacement?`,
  ];
  const faq = await runSeoChecks({ ...good(), body: articleBody({ headings: faqHeadings }) }, OPTS);
  assert.equal(check(faq, "schema-suggestion").value, "FAQPage");
});

/* ---------------------------------------------------------------- scoring --------------- */

test("scoring: 100 − 25 per blocker − 5 per warning, and info costs nothing", async () => {
  const clean = await runSeoChecks(good(), OPTS);
  assert.equal(clean.score, 100);
  assert.ok(clean.issues.some((i) => i.severity === "info"), "the info issue is present and still 100");

  // One warning: the meta description is gone.
  const oneWarn = await runSeoChecks({ ...good(), metaDescription: undefined }, OPTS);
  assert.equal(oneWarn.warnings.length, 1, oneWarn.warnings.join("; "));
  assert.equal(oneWarn.score, 95);

  // One blocker (keyword out of the title) on top of that.
  const blocked = await runSeoChecks({ ...good(), metaDescription: undefined, metaTitle: "A guide to burst pipes at night" }, OPTS);
  assert.equal(blocked.blockers.length, 1, blocked.blockers.join("; "));
  assert.equal(blocked.score, 100 - 25 - blocked.warnings.length * 5);
  assert.equal(blocked.passed, false);

  // The floor is 0, never negative.
  const wreck = await runSeoChecks({ body: "nothing" }, { keywords: CLUSTER, pages: PAGES });
  assert.equal(wreck.score, 0);
  assert.equal(wreck.passed, false);
});

test("passed is false on any block, and on a warning-only draft under the pass mark", async () => {
  const r = await runSeoChecks({ ...good(), metaTitle: "A guide to burst pipes at night" }, OPTS);
  assert.ok(r.blockers.length > 0);
  assert.equal(r.passed, false);

  // Six warnings and not one blocker: 70, under SEO_PASS_SCORE. Plan §17.2 sends this back to
  // the writer, so it must not report itself as passed to a step that would publish it.
  const warnOnly = await runSeoChecks(
    {
      // Nothing here is fatal: the keyword is in the title and the opening, there are three
      // sections, the density is inside the band. It is simply mediocre in six or seven
      // different ways at once.
      body: articleBody({
        headings: [`## First thoughts`, `## Second thoughts`, `## Third thoughts`],
        links: `Nothing links anywhere at all from this draft.`,
        keywordSentences: false,
      }),
      metaTitle: `Emergency plumber in Leeds`,
    },
    OPTS,
  );
  assert.deepEqual(warnOnly.blockers, [], summarizeSeo(warnOnly));
  assert.ok(warnOnly.score < SEO_PASS_SCORE, summarizeSeo(warnOnly));
  assert.equal(warnOnly.passed, false);
});

/* ---------------------------------------------------------------- SERP ------------------ */

test("with DataForSEO unconfigured the SERP checks are absent, and the result says so", async () => {
  const r = await runSeoChecks(good(), OPTS);
  assert.equal(r.serpCompared, false);
  assert.match(r.serpNote, /DataForSEO is not configured/);
  for (const id of ["serp-word-count", "serp-topic-coverage"]) {
    assert.equal(check(r, id).severity, "info", `${id} must not score anything without SERP data`);
    assert.equal(check(r, id).ok, true);
  }
  // The rule-of-thumb depth check runs instead — and it is the one that scores.
  assert.notEqual(check(r, "content-depth").severity, "info");
  assert.equal(summarizeSeo(r).endsWith("no SERP comparison"), true);
});

test("with a SERP snapshot: the median replaces the rule of thumb, and missing topics are named", async () => {
  const snapshot = {
    keyword: KW,
    fetchedAt: Date.now(),
    results: [
      { url: "https://a.example/1", title: "A", wordCount: 1800, h2s: ["What does it cost?", "Callout charges explained"] },
      { url: "https://b.example/2", title: "B", wordCount: 2000, h2s: ["Typical cost of a callout", "Insurance and who pays"] },
      { url: "https://c.example/3", title: "C", wordCount: 2200, h2s: ["Cost per hour", "Insurance claims"] },
      { url: "https://d.example/4", title: "D", wordCount: null, h2s: [] },
    ],
  };
  const r = await runSeoChecks(good(), { ...OPTS, serp: snapshot });
  assert.equal(r.serpCompared, true);

  const wc = check(r, "serp-word-count");
  assert.equal(wc.severity, "warn");
  assert.equal(wc.ok, false, "our ~600 words against a 2000 median must fail");
  assert.ok(wc.detail.includes("2000"), wc.detail);
  assert.ok(wc.fix!.includes("more words"));

  // The rule of thumb steps aside when there is a measured median.
  assert.equal(check(r, "content-depth").severity, "info");

  const topics = check(r, "serp-topic-coverage");
  assert.equal(topics.ok, false);
  assert.ok(topics.detail.includes("insurance"), topics.detail);
  assert.ok(topics.fix!.includes("of 3 top results"), topics.fix!);
  // "cost" is in our own headings, so it is not reported as a gap.
  assert.ok(!topics.detail.includes('"cost"'), topics.detail);
});

test("a SERP snapshot too thin to take a median from is skipped, not reported", async () => {
  const snapshot = {
    keyword: KW,
    fetchedAt: Date.now(),
    results: [
      { url: "https://a.example/1", title: "A", wordCount: 1800, h2s: ["Cost"] },
      { url: "https://b.example/2", title: "B", wordCount: null, h2s: [] },
    ],
  };
  const r = await runSeoChecks(good(), { ...OPTS, serp: snapshot });
  assert.equal(r.serpCompared, false);
  assert.match(r.serpNote, /too few to take a median/);
  assert.equal(check(r, "serp-word-count").severity, "info");
  assert.notEqual(check(r, "content-depth").severity, "info");
});

test("a SERP fetch that throws is not fatal — the on-page score still stands", async () => {
  const r = await runSeoChecks(good(), {
    ...OPTS,
    fetchSerp: async () => {
      throw new Error("402 Payment Required");
    },
  });
  assert.equal(r.serpCompared, false);
  assert.match(r.serpNote, /402 Payment Required/);
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
});
