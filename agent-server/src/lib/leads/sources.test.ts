/** Run: cd agent-server && npx tsx --test src/lib/leads/sources.test.ts
 *
 *  The manners half of the pipeline: robots.txt, and a paid source being optional. No network —
 *  every test injects its own `fetch`. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const {
  __resetSourceCaches,
  apolloConfigured,
  describeSources,
  discover,
  fetchPageForResearch,
  loadRobots,
  parseRobots,
  placesConfigured,
  robotsAllows,
} = await import("./sources.js");
const { buildIcp } = await import("./icp.js");

/** A `fetch` that answers from a map of url → [status, body, contentType]. */
function fakeFetch(routes: Record<string, [number, string, string?]>, seen: string[] = []) {
  return (async (input: any) => {
    const url = String(input);
    seen.push(url);
    const hit = routes[url];
    if (!hit) return new Response("not found", { status: 404 });
    const [status, body, type] = hit;
    return new Response(body, { status, headers: { "content-type": type ?? "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}

// ── robots.txt parsing ──────────────────────────────────────────────────────────────────────

test("parseRobots reads the group that applies to us, and the star group otherwise", () => {
  const txt = [
    "User-agent: Googlebot",
    "Disallow: /private",
    "",
    "User-agent: *",
    "Disallow: /admin",
    "Allow: /admin/public",
    "Crawl-delay: 2",
  ].join("\n");

  const rules = parseRobots(txt);
  assert.deepEqual(rules.disallow, ["/admin"]);
  assert.deepEqual(rules.allow, ["/admin/public"]);
  assert.equal(rules.crawlDelayMs, 2000);
  assert.equal(rules.missing, false);
});

test("a group naming us wins over the star group", () => {
  const txt = ["User-agent: *", "Disallow:", "", "User-agent: MrLxwaLeadBot", "Disallow: /"].join("\n");
  const rules = parseRobots(txt);
  assert.deepEqual(rules.disallow, ["/"]);
  assert.equal(robotsAllows(rules, "/about"), false);
});

test("an empty Disallow means nothing is disallowed — not that everything is", () => {
  const rules = parseRobots(["User-agent: *", "Disallow:"].join("\n"));
  assert.deepEqual(rules.disallow, []);
  assert.equal(robotsAllows(rules, "/anything"), true);
});

test("longest match wins, and Allow beats Disallow at the same length", () => {
  const rules = parseRobots(["User-agent: *", "Disallow: /wp-", "Allow: /wp-content/uploads"].join("\n"));
  assert.equal(robotsAllows(rules, "/wp-admin"), false);
  assert.equal(robotsAllows(rules, "/wp-content/uploads/menu.pdf"), true);
  assert.equal(robotsAllows(rules, "/about"), true);
});

test("the two wildcards robots.txt actually has", () => {
  const rules = parseRobots(["User-agent: *", "Disallow: /*.pdf$", "Disallow: /search/*/print"].join("\n"));
  assert.equal(robotsAllows(rules, "/menu.pdf"), false);
  assert.equal(robotsAllows(rules, "/menu.pdf.html"), true);
  assert.equal(robotsAllows(rules, "/search/x/print"), false);
});

test("no robots.txt means allowed; a broken one (5xx) means stay out", async () => {
  __resetSourceCaches();
  const absent = await loadRobots("https://a.example", fakeFetch({}));
  assert.equal(absent.missing, true);
  assert.equal(robotsAllows(absent, "/"), true);

  __resetSourceCaches();
  const broken = await loadRobots("https://b.example", fakeFetch({ "https://b.example/robots.txt": [503, "oops"] }));
  assert.deepEqual(broken.disallow, ["/"]);
  assert.equal(robotsAllows(broken, "/"), false);
});

// ── reading a stranger's page ───────────────────────────────────────────────────────────────

test("fetchPageForResearch asks robots.txt first and REFUSES when told to", async () => {
  __resetSourceCaches();
  const seen: string[] = [];
  const result = await fetchPageForResearch(
    "https://shy.example/about",
    fakeFetch({ "https://shy.example/robots.txt": [200, "User-agent: *\nDisallow: /"] }, seen)
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /robots\.txt disallows/);
  // Only robots.txt was ever requested — the page itself was not touched.
  assert.deepEqual(seen, ["https://shy.example/robots.txt"]);
});

test("fetchPageForResearch strips the page to readable text", async () => {
  __resetSourceCaches();
  const html = "<html><head><title>Al Safa</title></head><body><script>x=1</script><h1>Al Safa</h1><p>Lebanese food in Jumeirah.</p></body></html>";
  const result = await fetchPageForResearch("https://ok.example", fakeFetch({ "https://ok.example/": [200, html] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.title, "Al Safa");
  assert.equal(result.page.text, "Al Safa Lebanese food in Jumeirah.");
  assert.ok(!result.page.text.includes("x=1"), "script contents are not page text");
});

test("fetchPageForResearch gives a readable reason instead of throwing", async () => {
  __resetSourceCaches();
  const gone = await fetchPageForResearch("https://gone.example", fakeFetch({}));
  assert.equal(gone.ok, false);
  assert.match(gone.ok ? "" : gone.reason, /HTTP 404/);

  __resetSourceCaches();
  const pdf = await fetchPageForResearch("https://pdf.example", fakeFetch({ "https://pdf.example/": [200, "%PDF", "application/pdf"] }));
  assert.equal(pdf.ok, false);
  assert.match(pdf.ok ? "" : pdf.reason, /not a web page/);

  const nonsense = await fetchPageForResearch("mailto:someone@example.com", fakeFetch({}));
  assert.equal(nonsense.ok, false);
});

// ── the source layer degrades instead of failing ────────────────────────────────────────────

test("a paid source is optional, exactly like DataForSEO: absent keys are a note, not an error", async () => {
  __resetSourceCaches();
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.APOLLO_API_KEY;
  assert.equal(placesConfigured(), false);
  assert.equal(apolloConfigured(), false);

  const icp = buildIcp({ query: "restaurants in Dubai", count: 5 });
  assert.equal(icp.ok, true);
  if (!icp.ok) return;

  const rows = Array.from({ length: 16 }, (_, i) => ({
    osm_type: "node",
    osm_id: i,
    name: `Restaurant ${i}`,
    display_name: `Restaurant ${i}, Jumeirah, Dubai`,
    category: "amenity",
    type: "restaurant",
    extratags: { website: `https://r${i}.example`, phone: `+9715000000${i}` },
    namedetails: { name: `Restaurant ${i}` },
  }));

  const seen: string[] = [];
  const result = await discover(icp.icp, 5, {
    fetchImpl: (async (input: any) => {
      seen.push(String(input));
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  // OpenStreetMap answered; the two paid sources reported themselves as skipped, with the env
  // var a user has to set and the reason they were not used.
  // 16 rows came back but discover() only ever asks OpenStreetMap for 3x what the caller wants
  // (5 -> 15), because the pipeline drops leads with no website and needs the headroom. The 16th
  // row is left on the floor on purpose: over-fetching is bounded, not unbounded.
  assert.equal(result.candidates.length, 15);
  assert.equal(result.candidates[0].domain, "r0.example");
  assert.equal(result.candidates[0].attribution, "© OpenStreetMap contributors (ODbL)");

  const byId = Object.fromEntries(result.reports.map((r) => [r.id, r]));
  assert.equal(byId.osm.used, true);
  assert.equal(byId.osm.found, 15);
  assert.equal(byId.places.wired, false);
  assert.deepEqual(byId.places.envVars, ["GOOGLE_PLACES_API_KEY"]);
  assert.match(byId.places.note, /no GOOGLE_PLACES_API_KEY/);
  assert.equal(byId.apollo.wired, false);
  assert.deepEqual(byId.apollo.envVars, ["APOLLO_API_KEY"]);

  // One request for the first search term, which already filled the quota — the throttle and
  // the cache exist so a re-run of the same search costs nothing.
  assert.equal(seen.length, 1);
  assert.match(seen[0], /nominatim\.openstreetmap\.org/);

  const again = await discover(icp.icp, 5, {
    fetchImpl: (async () => {
      throw new Error("the cache should have answered this");
    }) as unknown as typeof fetch,
  });
  assert.equal(again.candidates.length, 15);

  assert.match(describeSources(result.reports).join(" | "), /OpenStreetMap: 15 found/);
});

test("a source that fails is a report line, not a dead run", async () => {
  __resetSourceCaches();
  const icp = buildIcp({ query: "restaurants in Dubai", count: 2 });
  assert.equal(icp.ok, true);
  if (!icp.ok) return;

  const result = await discover(icp.icp, 2, {
    fetchImpl: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.reports.find((r) => r.id === "osm")!.found, 0);
});

test("a key on its own does not make a seam wired — it says so instead", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  try {
    __resetSourceCaches();
    assert.equal(placesConfigured(), true);
    const icp = buildIcp({ query: "restaurants in Dubai", count: 1 });
    assert.equal(icp.ok, true);
    if (!icp.ok) return;
    const result = await discover(icp.icp, 1, {
      fetchImpl: (async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    });
    const places = result.reports.find((r) => r.id === "places")!;
    assert.equal(places.configured, true);
    assert.equal(places.wired, false);
    assert.match(places.note, /not wired yet/);
  } finally {
    delete process.env.GOOGLE_PLACES_API_KEY;
  }
});
