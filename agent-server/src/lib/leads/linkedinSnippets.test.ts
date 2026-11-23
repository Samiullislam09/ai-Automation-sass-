/** Run: cd agent-server && npx tsx --test src/lib/leads/linkedinSnippets.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const li = await import("./linkedinSnippets.js");
const { buildIcp } = await import("./icp.js");

const icp = (() => {
  const r = buildIcp({ query: "manufacturers in Dubai" });
  if (!r.ok) throw new Error("icp");
  return r.icp;
})();

test("companySlug accepts only linkedin.com/company/<slug>", () => {
  assert.equal(li.companySlug("https://www.linkedin.com/company/emirates-steel"), "emirates-steel");
  assert.equal(li.companySlug("https://ae.linkedin.com/company/emirates-steel/"), "emirates-steel");
  assert.equal(li.companySlug("https://www.linkedin.com/in/someone"), null);
  assert.equal(li.companySlug("https://www.linkedin.com/company/acme/jobs"), null);
  assert.equal(li.companySlug("https://www.linkedin.com/posts/x"), null);
  assert.equal(li.companySlug("https://notlinkedin.com/company/acme"), null);
  assert.equal(li.companySlug("not a url"), null);
});

test("nameFromTitle strips the LinkedIn suffix and overview words", () => {
  assert.equal(li.nameFromTitle("Emirates Steel | LinkedIn"), "Emirates Steel");
  assert.equal(li.nameFromTitle("Delta Pack - LinkedIn"), "Delta Pack");
  assert.equal(li.nameFromTitle("Al Noor Foods: Overview | LinkedIn"), "Al Noor Foods");
  assert.equal(li.nameFromTitle("Acme Industries | Manufacturing | LinkedIn"), "Acme Industries");
  assert.equal(li.nameFromTitle("LinkedIn"), null);
  assert.equal(li.nameFromTitle(""), null);
});

test("employeesFromSnippet reads ranges, plus-sizes and exact counts", () => {
  assert.deepEqual(li.employeesFromSnippet("Manufacturing · 51-200 employees · Dubai"), { text: "51-200 employees", max: 200 });
  assert.deepEqual(li.employeesFromSnippet("1,001-5,000 employees"), { text: "1,001-5,000 employees", max: 5000 });
  assert.deepEqual(li.employeesFromSnippet("10,001+ employees"), { text: "10,001+ employees", max: null });
  assert.deepEqual(li.employeesFromSnippet("12 employees"), { text: "12 employees", max: 12 });
  assert.equal(li.employeesFromSnippet("a steel company"), null);
});

test("listingFromResult needs both a company URL and a name", () => {
  const ok = li.listingFromResult({ link: "https://www.linkedin.com/company/emirates-steel", title: "Emirates Steel | LinkedIn", snippet: "Manufacturing · 201-500 employees" });
  assert.deepEqual(ok, { name: "Emirates Steel", slug: "emirates-steel", url: "https://www.linkedin.com/company/emirates-steel", employees: "201-500 employees", employeesMax: 500 });
  assert.equal(li.listingFromResult({ link: "https://www.linkedin.com/in/x", title: "X | LinkedIn" }), null);
  assert.equal(li.listingFromResult({ link: "https://www.linkedin.com/company/x", title: "LinkedIn" }), null);
});

test("linkedinQueries uses plain words only — no site: operator — and adds the place", () => {
  const qs = li.linkedinQueries({ ...icp, industry: "Manufacturers", expandedTerms: ["factories", "manufacturers"] }, 3);
  assert.deepEqual(qs, ["Manufacturers Dubai linkedin company", "factories Dubai linkedin company"]);
  assert.ok(qs.every((q) => !q.includes("site:")));
});

const RESULTS = [
  { link: "https://www.linkedin.com/company/emirates-steel", title: "Emirates Steel | LinkedIn", snippet: "Manufacturing · 201-500 employees" },
  { link: "https://www.linkedin.com/company/delta-pack", title: "Delta Pack | LinkedIn", snippet: "Packaging · 11-50 employees" },
  { link: "https://www.linkedin.com/in/some-person", title: "Some Person | LinkedIn", snippet: "" },
  { link: "https://gulfnews.com/story", title: "A story", snippet: "" },
  { link: "https://www.linkedin.com/company/emirates-steel/", title: "Emirates Steel | LinkedIn", snippet: "" }, // same slug
];

function deps(over: Partial<Parameters<typeof li.linkedinSearch>[2]> = {}) {
  return {
    search: async () => RESULTS,
    resolveWebsite: async (name: string) =>
      name === "Emirates Steel" ? { website: "https://emiratessteel.com", domain: "emiratessteel.com" } : { website: "https://zawya.com", domain: "zawya.com" },
    ...over,
  };
}

test("linkedinSearch: off with a reason without a search key", async () => {
  const r = await li.linkedinSearch(icp, 10, deps({ search: null }));
  assert.equal(r.candidates.length, 0);
  assert.match(r.note, /SERPER_API_KEY/);
});

test("linkedinSearch: a listing with a confirmed website becomes a candidate carrying its size; a wrong website is dropped", async () => {
  const r = await li.linkedinSearch(icp, 10, deps());
  assert.deepEqual(r.candidates.map((c) => c.domain), ["emiratessteel.com"]); // zawya.com is not Delta Pack's
  const c = r.candidates[0];
  assert.equal(c.source, "linkedin");
  assert.deepEqual(c.categories, ["LinkedIn company page", "201-500 employees"]);
  assert.equal(c.sourceRef, "https://www.linkedin.com/company/emirates-steel");
  assert.match(c.attribution ?? "", /public search result/);
  assert.equal(c.intent, undefined); // a listing is not a "why now" event
});

test("linkedinSearch: never requests linkedin.com itself — it only calls the injected search", async () => {
  const queries: string[] = [];
  await li.linkedinSearch(icp, 10, deps({ search: async (q: string) => (queries.push(q), RESULTS) }));
  assert.ok(queries.length >= 1 && queries.length <= 2);
  assert.ok(queries.every((q) => /linkedin company$/.test(q)));
});

test("linkedinSearch: caps website lookups per run", async () => {
  process.env.LEADS_LINKEDIN_MAX_LOOKUPS = "1";
  try {
    let lookups = 0;
    await li.linkedinSearch(icp, 10, deps({ resolveWebsite: async () => (lookups++, null) }));
    assert.equal(lookups, 1);
  } finally {
    delete process.env.LEADS_LINKEDIN_MAX_LOOKUPS;
  }
});

test("linkedinSearch: a failing search or no listings is a note, not a throw; the switch turns it off", async () => {
  const failing = await li.linkedinSearch(icp, 10, deps({ search: async () => { throw new Error("boom"); } }));
  assert.equal(failing.candidates.length, 0);
  assert.match(failing.note, /no LinkedIn company listings/);
  process.env.LEADS_LINKEDIN = "0";
  try {
    assert.match((await li.linkedinSearch(icp, 10, deps())).note, /switched off/);
  } finally {
    delete process.env.LEADS_LINKEDIN;
  }
});
