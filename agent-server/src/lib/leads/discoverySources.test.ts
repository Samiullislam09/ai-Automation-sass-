/** Run: cd agent-server && npx tsx --test src/lib/leads/discoverySources.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const ds = await import("./discoverySources.js");
const { buildIcp } = await import("./icp.js");

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
}

const icp = (() => {
  const r = buildIcp({ query: "manufacturers in Dubai" });
  if (!r.ok) throw new Error("icp");
  return r.icp;
})();

function serviceReturning(items: unknown[], calls: { url: string; body: any }[] = []): typeof fetch {
  return (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, items, pages_read: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
}

test("directoryTemplates keeps only http(s) templates that carry {q}", () => {
  const t = ds.directoryTemplates({
    LEADS_DIRECTORY_URLS: "https://d.example/s?q={q}&loc={geo}, ftp://bad/{q} https://nope.example/list https://e.example/find/{q}",
  } as any);
  assert.deepEqual(t, ["https://d.example/s?q={q}&loc={geo}", "https://e.example/find/{q}"]);
});

test("fillTemplate url-encodes the query and the place", () => {
  assert.equal(ds.fillTemplate("https://d.example/s?q={q}&loc={geo}", "steel & iron", "Abu Dhabi"), "https://d.example/s?q=steel%20%26%20iron&loc=Abu%20Dhabi");
  assert.equal(ds.fillTemplate("https://d.example/s?q={q}&loc={geo}", "x", null), "https://d.example/s?q=x&loc=");
});

test("directoryQueries: the segment first, expanded phrases after, deduped and capped", () => {
  const withExtra = { ...icp, industry: "Manufacturers", expandedTerms: ["factories", "manufacturers", "Exporters", "fabricators"] };
  assert.deepEqual(ds.directoryQueries(withExtra, 3), ["Manufacturers", "factories", "Exporters"]);
});

test("pickCompetitors: all when few, a rotating window when many", () => {
  assert.deepEqual(ds.pickCompetitors(["a.com", "b.com"], 3), ["a.com", "b.com"]);
  const sites = ["a.com", "b.com", "c.com", "d.com"];
  const day0 = ds.pickCompetitors(sites, 2, new Date(0));
  const day1 = ds.pickCompetitors(sites, 2, new Date(86_400_000));
  assert.equal(day0.length, 2);
  assert.notDeepEqual(day0, day1);
});

test("directorySearch is off with a reason when Scrapling or the templates are missing", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: undefined, LEADS_DIRECTORY_URLS: "https://d.example/s?q={q}" }, async () => {
    const r = await ds.directorySearch(icp, 10);
    assert.equal(r.candidates.length, 0);
    assert.match(r.note, /SCRAPLING_SERVICE_URL/);
  });
  await withEnv({ SCRAPLING_SERVICE_URL: "http://svc", LEADS_DIRECTORY_URLS: undefined }, async () => {
    const r = await ds.directorySearch(icp, 10);
    assert.match(r.note, /LEADS_DIRECTORY_URLS/);
  });
});

test("directorySearch turns listed companies into candidates, drops no-website rows and dupes", async () => {
  ds.__resetDiscoveryCache();
  await withEnv({ SCRAPLING_SERVICE_URL: "http://svc", LEADS_DIRECTORY_URLS: "https://d.example/s?q={q}&loc={geo}", LEADS_DIRECTORY_MAX_QUERIES: "1" }, async () => {
    const calls: { url: string; body: any }[] = [];
    const items = [
      { name: "Gulf Steel", website: "https://gulfsteel.ae", domain: "gulfsteel.ae", source_url: "x" },
      { name: "Logo Only", website: null, domain: null, source_url: "x" },
      { name: "Gulf Steel Again", website: "https://gulfsteel.ae", domain: "gulfsteel.ae", source_url: "x" },
    ];
    const r = await ds.directorySearch(icp, 10, serviceReturning(items, calls));
    assert.deepEqual(r.candidates.map((c) => [c.name, c.domain, c.source]), [["Gulf Steel", "gulfsteel.ae", "directory"]]);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].body.url.startsWith("https://d.example/s?q="));
    assert.match(calls[0].body.url, /loc=Dubai/);
  });
});

test("directorySearch reports the service's own refusal instead of throwing", async () => {
  ds.__resetDiscoveryCache();
  await withEnv({ SCRAPLING_SERVICE_URL: "http://svc", LEADS_DIRECTORY_URLS: "https://d2.example/s?q={q}" }, async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, reason: "this directory is not on the allowed list" }), { status: 200 })) as unknown as typeof fetch;
    const r = await ds.directorySearch(icp, 10, fetchImpl);
    assert.equal(r.candidates.length, 0);
    assert.match(r.note, /allowed list/);
  });
});

test("competitorClientsSearch: never offers back the competitor or the tenant's own site", async () => {
  ds.__resetDiscoveryCache();
  await withEnv({ SCRAPLING_SERVICE_URL: "http://svc" }, async () => {
    const items = [
      { name: "Rival", website: "https://rival.com", domain: "rival.com", source_url: "x" },
      { name: "Me", website: "https://mine.com", domain: "mine.com", source_url: "x" },
      { name: "Emirates Steel", website: "https://emiratessteel.com", domain: "emiratessteel.com", source_url: "x" },
    ];
    const r = await ds.competitorClientsSearch(["rival.com"], "mine.com", 10, serviceReturning(items));
    assert.deepEqual(r.candidates.map((c) => c.domain), ["emiratessteel.com"]);
    assert.equal(r.candidates[0].source, "clients");
    assert.match(r.candidates[0].attribution ?? "", /client of rival\.com/);
  });
});

test("competitorClientsSearch says so when there are no competitor sites yet", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: "http://svc" }, async () => {
    const r = await ds.competitorClientsSearch([], null, 10);
    assert.equal(r.candidates.length, 0);
    assert.match(r.note, /no competitor sites/);
  });
});
