/** Run: cd agent-server && npx tsx --test src/lib/leads/intentNews.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const news = await import("./intentNews.js");
const { buildIcp } = await import("./icp.js");
const { intentPoints, qualifyBuyer } = await import("./pipeline.js");

const icp = (() => {
  const r = buildIcp({ query: "manufacturers in Dubai" });
  if (!r.ok) throw new Error("icp");
  return r.icp;
})();

const NOW = new Date("2026-11-24T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toUTCString();

const RSS = (items: { title: string; link?: string; pub: string; source?: string }[]) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link ?? "https://news.example/a"}</link><pubDate>${i.pub}</pubDate><source url="x">${i.source ?? "Gulf News"}</source></item>`)
    .join("")}</channel></rss>`;

test("parseNewsRss splits the publisher off the headline and dates the item", () => {
  const items = news.parseNewsRss(RSS([{ title: "Emirates Steel opens new plant in Abu Dhabi - Gulf News", pub: daysAgo(3) }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].headline, "Emirates Steel opens new plant in Abu Dhabi");
  assert.equal(items[0].publisher, "Gulf News");
  assert.ok(items[0].at);
});

test("parseNewsRss skips items without a usable link or title", () => {
  const xml = `<rss><channel><item><title>No link</title></item><item><link>https://x.com</link></item></channel></rss>`;
  assert.deepEqual(news.parseNewsRss(xml), []);
});

const ITEMS = [
  { title: "t0", headline: "Emirates Steel opens new plant in Abu Dhabi", publisher: "Gulf News", link: "https://n/0", at: null },
  { title: "t1", headline: "Gulf News names its top ten factories", publisher: "Gulf News", link: "https://n/1", at: null },
  { title: "t2", headline: "Delta Pack wins packaging contract", publisher: "Zawya", link: "https://n/2", at: null },
];

test("validateFindings keeps only a company that is in the headline it points at", () => {
  const out = news.validateFindings(
    {
      items: [
        { i: 0, company: "Emirates Steel", event: "new-facility" },
        { i: 0, company: "Acme Corp", event: "expansion" }, // invented: not in headline 0
        { i: 1, company: "Gulf News", event: "other" }, // the outlet
        { i: 2, company: "Delta Pack", event: "weird" }, // unknown event -> other
        { i: 9, company: "Nobody", event: "launch" }, // index out of range
        { i: 2, company: "delta pack", event: "contract" }, // duplicate
      ],
    },
    ITEMS,
  );
  assert.deepEqual(out.map((f) => [f.company, f.event]), [["Emirates Steel", "new-facility"], ["Delta Pack", "other"]]);
});

test("validateFindings survives garbage", () => {
  assert.deepEqual(news.validateFindings(null, ITEMS), []);
  assert.deepEqual(news.validateFindings({ items: "x" }, ITEMS), []);
});

test("domainMatchesName: the company's own domain passes, a news site or lookalike does not", () => {
  assert.equal(news.domainMatchesName("Emirates Steel Industries LLC", "emiratessteel.com"), true);
  assert.equal(news.domainMatchesName("Delta Pack", "deltapack.ae"), true);
  assert.equal(news.domainMatchesName("Delta Pack", "www.deltapackaging.com"), true);
  assert.equal(news.domainMatchesName("Delta Pack", "gulfnews.com"), false);
  assert.equal(news.domainMatchesName("Delta Pack", "zawya.com"), false);
  assert.equal(news.domainMatchesName("", "x.com"), false);
});

test("newsFeedUrl carries the segment, the place and the region", () => {
  const u = news.newsFeedUrl("Manufacturers", "Dubai", "ae");
  assert.match(u, /^https:\/\/news\.google\.com\/rss\/search\?q=/);
  assert.match(decodeURIComponent(u), /"Manufacturers" "Dubai"/);
  assert.match(u, /gl=AE/);
});

function deps(over: Partial<Parameters<typeof news.newsIntentSearch>[2]> = {}) {
  const fetchImpl = (async () =>
    new Response(RSS([
      { title: "Emirates Steel opens new plant in Abu Dhabi - Gulf News", pub: daysAgo(3) },
      { title: "Delta Pack wins packaging contract - Zawya", pub: daysAgo(10) },
      { title: "Old Co expands - Gulf News", pub: daysAgo(200) }, // too old: filtered before the model sees it
    ]), { status: 200 })) as unknown as typeof fetch;
  return {
    fetchImpl,
    now: () => NOW,
    llmJson: async () => ({ items: [{ i: 0, company: "Emirates Steel", event: "new-facility" }, { i: 1, company: "Delta Pack", event: "contract" }] }),
    resolveWebsite: async (name: string) =>
      name === "Emirates Steel" ? { website: "https://emiratessteel.com", domain: "emiratessteel.com" } : { website: "https://zawya.com", domain: "zawya.com" },
    ...over,
  };
}

test("newsIntentSearch: needs a resolver; with none it is off and says why (no model call)", async () => {
  let called = false;
  const r = await news.newsIntentSearch(icp, 10, deps({ resolveWebsite: null, llmJson: async () => ((called = true), {}) }));
  assert.equal(r.candidates.length, 0);
  assert.match(r.note, /SERPER_API_KEY/);
  assert.equal(called, false);
});

test("newsIntentSearch: a verified company with a confirmed website becomes a dated news candidate; a wrong website is dropped", async () => {
  const r = await news.newsIntentSearch(icp, 10, deps());
  assert.deepEqual(r.candidates.map((c) => c.domain), ["emiratessteel.com"]); // zawya.com is not Delta Pack's domain
  const c = r.candidates[0];
  assert.equal(c.source, "news");
  assert.equal(c.intent?.kind, "news");
  assert.match(c.intent!.text, /Emirates Steel opens new plant/);
  assert.equal(c.intent!.url, "https://news.example/a");
  assert.ok(c.intent!.at);
});

test("newsIntentSearch: a feed or model failure is a note, not a throw", async () => {
  const down = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
  assert.match((await news.newsIntentSearch(icp, 10, deps({ fetchImpl: down }))).note, /HTTP 503/);
  const r = await news.newsIntentSearch(icp, 10, deps({ llmJson: async () => { throw new Error("model down"); } }));
  assert.equal(r.candidates.length, 0);
  assert.match(r.note, /could not read the headlines/);
});

test("newsIntentSearch honours the off switch", async () => {
  process.env.LEADS_NEWS_INTENT = "0";
  try {
    assert.match((await news.newsIntentSearch(icp, 10, deps())).note, /switched off/);
  } finally {
    delete process.env.LEADS_NEWS_INTENT;
  }
});

// ── scoring ──────────────────────────────────────────────────────────────────────────────────

test("intentPoints: news beats hiring, recent beats old, a year-old event earns nothing", () => {
  const at = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  assert.equal(intentPoints({ kind: "news", text: "x", url: null, at: at(5) }, NOW)?.points, 20);
  assert.equal(intentPoints({ kind: "news", text: "x", url: null, at: at(60) }, NOW)?.points, 12);
  assert.equal(intentPoints({ kind: "news", text: "x", url: null, at: at(200) }, NOW)?.points, 6);
  assert.equal(intentPoints({ kind: "hiring", text: "x", url: null, at: at(5) }, NOW)?.points, 14);
  assert.equal(intentPoints({ kind: "news", text: "x", url: null, at: at(400) }, NOW), null);
  assert.equal(intentPoints({ kind: "competitor-client", text: "x", url: null, at: null }, NOW)?.points, 12);
  assert.equal(intentPoints(undefined, NOW), null);
});

function researched(intent?: any) {
  return {
    candidate: { name: "Emirates Steel", website: "https://emiratessteel.com", domain: "emiratessteel.com", phone: null, address: null, categories: ["manufacturers"], source: "news", sourceRef: null, attribution: null, ...(intent ? { intent } : {}) },
    pages: [{ url: "https://emiratessteel.com", title: "", text: "" }],
    text: "We make steel. ".repeat(200),
    email: "info@emiratessteel.com",
    summary: { has_contact_form: true, recent_changes: [] },
  } as any;
}

test("qualifyBuyer: a cited event adds a 'buying-intent' component and lifts the no-signal cap", () => {
  const signals = [{ name: "exports", look_for: "zebra quantum", weight: 5 }]; // never on the page
  const without = qualifyBuyer(researched(), icp, signals, NOW);
  const withEvent = qualifyBuyer(researched({ kind: "news", text: "opens new plant", url: "https://n/0", at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }), icp, signals, NOW);
  assert.ok(without.score <= 55, `capped without intent, got ${without.score}`);
  assert.ok(withEvent.components.some((c) => c.id === "buying-intent" && c.points === 20));
  assert.ok(withEvent.score > without.score);
  assert.match(withEvent.components.find((c) => c.id === "buying-intent")!.why, /in the news 3d ago/);
});

test("qualifyBuyer: no intent, no intent component (existing scoring is unchanged)", () => {
  const q = qualifyBuyer(researched(), icp, [], NOW);
  assert.equal(q.components.some((c) => c.id === "buying-intent"), false);
});
