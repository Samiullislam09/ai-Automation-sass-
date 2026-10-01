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
  serperConfigured,
  jobsConfigured,
  adzunaCountryFor,
  countryFromAddress,
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
  // Places is wired now, but with no key it is skipped with the env var named.
  assert.equal(byId.places.wired, true);
  assert.equal(byId.places.used, false);
  assert.deepEqual(byId.places.envVars, ["GOOGLE_PLACES_API_KEY"]);
  assert.match(byId.places.note, /no GOOGLE_PLACES_API_KEY/);
  // Jobs (Adzuna) is wired too; no keys means a skip with its two env vars named.
  assert.equal(byId.jobs.wired, true);
  assert.equal(byId.jobs.used, false);
  assert.deepEqual(byId.jobs.envVars, ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"]);
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

test("a Google Places key wires a live call, and its results carry Google attribution", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  try {
    __resetSourceCaches();
    assert.equal(placesConfigured(), true);
    const icp = buildIcp({ query: "restaurants in Dubai", count: 2 });
    assert.equal(icp.ok, true);
    if (!icp.ok) return;

    // A Places "New" searchText response shape.
    const placesBody = JSON.stringify({
      places: [
        { id: "P1", displayName: { text: "Zoma Restaurant" }, websiteUri: "https://zoma.example", internationalPhoneNumber: "+971 4 111 2222", formattedAddress: "Jumeirah, Dubai", types: ["restaurant"] },
        { id: "P2", displayName: { text: "Cafe Bateel" }, websiteUri: "https://bateel.example", formattedAddress: "DIFC, Dubai", types: ["cafe"] },
      ],
    });
    const seen: string[] = [];
    const result = await discover(icp.icp, 2, {
      fetchImpl: (async (input: any) => {
        const u = String(input);
        seen.push(u);
        if (u.includes("places.googleapis.com")) return new Response(placesBody, { status: 200, headers: { "content-type": "application/json" } });
        // OSM top-up returns nothing so the assertions are about Places alone.
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    const places = result.reports.find((r) => r.id === "places")!;
    assert.equal(places.configured, true);
    assert.equal(places.wired, true);
    assert.equal(places.used, true);
    assert.ok(places.found >= 1);
    const fromPlaces = result.candidates.filter((c) => c.source === "places");
    assert.ok(fromPlaces.length >= 1);
    assert.equal(fromPlaces[0].attribution, "Data © Google");
    assert.equal(fromPlaces[0].domain, "zoma.example");
    assert.ok(seen.some((u) => u.includes("places.googleapis.com")));
  } finally {
    delete process.env.GOOGLE_PLACES_API_KEY;
  }
});

test("Adzuna maps a covered geo and reports an uncovered one honestly", async () => {
  process.env.ADZUNA_APP_ID = "id";
  process.env.ADZUNA_APP_KEY = "key";
  try {
    __resetSourceCaches();
    assert.equal(jobsConfigured(), true);
    assert.equal(adzunaCountryFor("in London"), "gb");
    assert.equal(adzunaCountryFor("Bangalore, India"), "in");
    assert.equal(adzunaCountryFor("Dubai, UAE"), null, "Adzuna has no UAE index");

    // A covered geo returns hiring companies as candidates.
    const icp = buildIcp({ query: "logistics in Singapore", count: 3 });
    assert.equal(icp.ok, true);
    if (!icp.ok) return;
    const jobsBody = JSON.stringify({ results: [
      { id: "J1", title: "Warehouse Manager", company: { display_name: "Acme Logistics" }, location: { display_name: "Singapore" }, category: { label: "Logistics Jobs" } },
      { id: "J2", title: "Driver", company: { display_name: "Acme Logistics" }, location: { display_name: "Singapore" } },
      { id: "J3", title: "Ops Lead", company: { display_name: "Beta Freight" }, location: { display_name: "Singapore" } },
    ] });
    const result = await discover(icp.icp, 5, {
      fetchImpl: (async (input: any) => {
        const u = String(input);
        if (u.includes("api.adzuna.com")) return new Response(jobsBody, { status: 200, headers: { "content-type": "application/json" } });
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    const jobs = result.reports.find((r) => r.id === "jobs")!;
    assert.equal(jobs.used, true);
    const fromJobs = result.candidates.filter((c) => c.source === "jobs");
    // Two postings from Acme collapse to one company; Beta is the second.
    assert.equal(fromJobs.length, 2);
    assert.match(fromJobs[0].categories.join(" "), /hiring/);
    assert.equal(fromJobs[0].attribution, "Job data via Adzuna");
  } finally {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
  }
});

test("Serper (Google Maps, no card) maps places to candidates with phone + website", async () => {
  process.env.SERPER_API_KEY = "test-key";
  try {
    __resetSourceCaches();
    assert.equal(serperConfigured(), true);
    const icp = buildIcp({ query: "manufacturers in Dubai", count: 3 });
    assert.equal(icp.ok, true);
    if (!icp.ok) return;

    const body = JSON.stringify({ places: [
      { position: 1, title: "Gulf Steel Industries", address: "Al Quoz, Dubai", phoneNumber: "+971 4 123 4567", website: "https://gulfsteel.ae", category: "Manufacturer", cid: "111" },
      { position: 2, title: "Emirates Foods LLC", address: "DIP, Dubai", phoneNumber: "+971 4 987 6543", website: "https://emiratesfoods.ae", category: "Food", cid: "222" },
    ] });
    const seen: string[] = [];
    const result = await discover(icp.icp, 3, {
      fetchImpl: (async (input: any, init: any) => {
        const u = String(input); seen.push(u);
        if (u.includes("google.serper.dev")) {
          // confirm it POSTs with the api key header
          assert.equal(init?.headers?.["X-API-KEY"], "test-key");
          return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    const sr = result.reports.find((r) => r.id === "serper")!;
    assert.equal(sr.configured, true);
    assert.equal(sr.used, true);
    assert.ok(sr.found >= 2);
    const fromSerper = result.candidates.filter((c) => c.source === "serper");
    assert.equal(fromSerper[0].name, "Gulf Steel Industries");
    assert.equal(fromSerper[0].phone, "+971 4 123 4567");
    assert.equal(fromSerper[0].domain, "gulfsteel.ae");
    assert.ok(seen.some((u) => u.includes("google.serper.dev/places")));
  } finally {
    delete process.env.SERPER_API_KEY;
  }
});

test("Serper rotates to the next key when one's free quota is exhausted (402/429)", async () => {
  process.env.SERPER_API_KEYS = "deadkey,livekey";
  delete process.env.SERPER_API_KEY;
  try {
    __resetSourceCaches();
    assert.equal(serperConfigured(), true);
    const icp = buildIcp({ query: "manufacturers in Mumbai", count: 2 });
    assert.equal(icp.ok, true);
    if (!icp.ok) return;

    const body = JSON.stringify({ places: [{ title: "Acme Works", address: "Mumbai", phoneNumber: "+91 98765 43210", website: "https://acme.in", cid: "9" }] });
    const usedKeys: string[] = [];
    const result = await discover(icp.icp, 2, {
      fetchImpl: (async (input: any, init: any) => {
        const u = String(input);
        if (u.includes("google.serper.dev")) {
          const k = init?.headers?.["X-API-KEY"];
          usedKeys.push(k);
          if (k === "deadkey") return new Response("quota", { status: 429 });   // exhausted
          return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    const fromSerper = result.candidates.filter((c) => c.source === "serper");
    assert.ok(fromSerper.length >= 1, "the live key still produced a lead after the dead one 429'd");
    assert.ok(usedKeys.includes("deadkey") && usedKeys.includes("livekey"), "both keys were tried, dead first then live");
  } finally {
    delete process.env.SERPER_API_KEYS;
  }
});

test("countryFromAddress pulls the country off a Google Maps address and canonicalises short forms", () => {
  assert.equal(countryFromAddress("Jumeirah Rd, Dubai, United Arab Emirates"), "United Arab Emirates");
  assert.equal(countryFromAddress("Some St, Dubai, UAE"), "United Arab Emirates");
  assert.equal(countryFromAddress("221B Baker St, London, UK"), "United Kingdom");
  assert.equal(countryFromAddress("MG Road, Pune, India"), "India");
  assert.equal(countryFromAddress(""), null);
  assert.equal(countryFromAddress(null), null);
  assert.equal(countryFromAddress("12345"), null); // a bare postcode is not a country
});
