/** Run: cd agent-server && npx tsx --test src/lib/leads/pipeline.test.ts
 *
 *  Every node with a fake page fetcher and a fake model: no network, no database, no LLM.
 *  The last test checks the agent's output against the manifest itself, so the shape cannot
 *  drift away from `leads.find_leads` without this failing. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { research, qualify, qualifyBuyer, personalise, draft, runPipeline, buildFindLeadsOutput, industryTerms, competitorCueHit, classifyFit } = await import("./pipeline.js");
type FitGate = import("./pipeline.js").FitGate;
const { buildIcp } = await import("./icp.js");
const { RunLedger } = await import("./compliance.js");
const { MANIFESTS } = await import("../../brain/manifests.js");
const { validateAgainstSchema } = await import("../../vendor/agent-contract/manifest.js");

type Candidate = import("./sources.js").Candidate;
type FetchOutcome = import("./sources.js").FetchOutcome;
type PipelineDeps = import("./pipeline.js").PipelineDeps;
type Researched = import("./pipeline.js").Researched;
type SenderIdentity = import("./compliance.js").SenderIdentity;

const NOW = new Date("2026-08-27T10:00:00Z");

const IDENTITY: SenderIdentity = {
  personName: "Sam",
  businessName: "MrLxwa",
  website: "https://mrlxwa.com",
  replyTo: "sam@mrlxwa.com",
};

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

const ICP = (() => {
  const built = buildIcp({
    query: "restaurants in Dubai",
    profile: {
      what_they_do: "We write monthly SEO articles for restaurants.",
      offerings: [{ name: "Monthly article plan", url: "https://mrlxwa.com/plans", kind: "service" }],
      audience: "independent restaurants",
      buyer_intent: [],
      proof: [{ claim: "ISO 9001 certified", quote: "We are ISO 9001 certified", url: "https://mrlxwa.com/about" }],
      topic_clusters: [],
      content_gaps: [],
      voice: null,
      geo: "Dubai",
      language: "en",
      competitors: [],
      goals: null,
      confidence: {},
      sources: {},
    } as any,
    count: 5,
  });
  if (!built.ok) throw new Error("fixture ICP failed to build");
  return built.icp;
})();

function candidate(over: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    name: "Al Safa Restaurant",
    website: "https://alsafa.example",
    domain: "alsafa.example",
    phone: "+971 50 123 4567",
    address: "Jumeirah Road, Dubai, UAE",
    categories: ["restaurant"],
    source: "osm",
    sourceRef: "node/1",
    attribution: "© OpenStreetMap contributors (ODbL)",
  };
  const merged = { ...base, ...over };
  // A fixture for a DIFFERENT business (its own domain) that did not spell out a phone gets a
  // distinct one derived from that domain, so the real phone-dedup doesn't collapse unrelated
  // fixtures into one lead. Tests that WANT a phone collision pass `phone` explicitly.
  if (over.phone === undefined && over.domain && over.domain !== base.domain) {
    let h = 0;
    for (const ch of over.domain) h = (h * 31 + ch.charCodeAt(0)) % 9000000;
    merged.phone = `+971 50 ${String(1000000 + h).slice(0, 7)}`;
  }
  return merged;
}

const HOME_TEXT =
  "Al Safa Restaurant serves Lebanese food in Jumeirah. " +
  "We opened our second branch on Jumeirah Road in 2026 and we are hiring kitchen staff. " +
  "Our menu changes with the season and every dish is cooked to order in our open kitchen. " +
  "Families have been coming to us since the first branch opened, and we still make the bread by hand each morning.";

const CONTACT_TEXT = "Reach us on info@alsafa.example or call +971 50 123 4567. Jumeirah Road, Dubai.";

/** A page fetcher backed by a map. Anything not in the map fails, with a reason, exactly as
 *  sources.fetchPageForResearch would. */
function fakeFetcher(pages: Record<string, { title: string; text: string }>, failReason = "could not reach their site (fixture)") {
  const calls: string[] = [];
  const fetchPage = async (url: string): Promise<FetchOutcome> => {
    calls.push(url);
    const hit = pages[url];
    if (!hit) return { ok: false, reason: failReason };
    return { ok: true, page: { url, title: hit.title, text: hit.text } };
  };
  return { fetchPage, calls };
}

const GOOD_PAGES = {
  "https://alsafa.example": { title: "Al Safa Restaurant", text: HOME_TEXT },
  "https://alsafa.example/contact": { title: "Contact", text: CONTACT_TEXT },
};

/** A model that answers each of the three prompts this pipeline sends. Overridable per test. */
function fakeLlm(over: { summary?: unknown; observation?: unknown; message?: unknown | (() => unknown); classify?: unknown } = {}) {
  const prompts: string[] = [];
  const llmJson = async <T>(prompt: string): Promise<T> => {
    prompts.push(prompt);
    if (prompt.includes("BUYER of an offer")) {
      // Default: a buyer, with a quote that really is in HOME_TEXT so it verifies in code.
      return (over.classify ?? {
        verdict: "buyer",
        quote: "We opened our second branch on Jumeirah Road in 2026",
        reason: "A restaurant — a customer for article writing, not a peer.",
      }) as T;
    }
    if (prompt.includes("research analyst")) {
      return (over.summary ?? {
        what_they_do: "A Lebanese restaurant in Jumeirah with two branches.",
        size_signals: [],
        recent_changes: ["Opened a second branch on Jumeirah Road in 2026"],
        pain_hints: ["no online menu"],
        has_contact_form: false,
      }) as T;
    }
    if (prompt.includes("to open a message")) {
      return (over.observation ?? {
        observation: "They opened a second branch on Jumeirah Road this year.",
        quote: "We opened our second branch on Jumeirah Road in 2026",
        url: "https://alsafa.example",
      }) as T;
    }
    if (prompt.includes("outreach")) {
      const value = typeof over.message === "function" ? (over.message as () => unknown)() : over.message;
      return (value ?? {
        message:
          "Congratulations on the second branch on Jumeirah Road. " +
          "We write the monthly articles that bring people to a restaurant's website. " +
          "Would that be useful while the new branch settles in?",
      }) as T;
    }
    throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`);
  };
  return { llmJson, prompts };
}

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  const fetcher = fakeFetcher(GOOD_PAGES);
  const llm = fakeLlm();
  return { fetchPage: fetcher.fetchPage, llmJson: llm.llmJson, now: () => NOW, ...over };
}

async function researchGood(): Promise<Researched> {
  const result = await research(candidate(), deps());
  assert.equal(result.ok, true, "fixture research should succeed");
  if (!result.ok) throw new Error("unreachable");
  return result.researched;
}

// ── node 1 · research ───────────────────────────────────────────────────────────────────────

test("research reads home + contact and keeps the words it actually read", async () => {
  const fetcher = fakeFetcher(GOOD_PAGES);
  const result = await research(candidate(), deps({ fetchPage: fetcher.fetchPage }));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.researched.pages.length, 2);
  assert.ok(result.researched.text.includes("second branch"));
  // /about was asked for and refused; that is not an error, just one page fewer.
  assert.deepEqual(fetcher.calls, ["https://alsafa.example", "https://alsafa.example/about", "https://alsafa.example/contact"]);
  // The address came off the page by regex and through the compliance screen.
  assert.equal(result.researched.email, "info@alsafa.example");
  assert.equal(result.researched.summary.partial, false);
});

test("research DROPS a lead with no website, and says why", async () => {
  const result = await research(candidate({ website: null, domain: null }), deps());
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /no website on file/i);
});

test("research DROPS a lead whose site cannot be read, carrying the fetcher's reason", async () => {
  const fetcher = fakeFetcher({}, "alsafa.example/robots.txt disallows / — we do not read it");
  const result = await research(candidate(), deps({ fetchPage: fetcher.fetchPage }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /robots\.txt disallows/);
});

test("research DROPS a site with almost no text rather than passing it on half-built", async () => {
  const fetcher = fakeFetcher({ "https://alsafa.example": { title: "Al Safa", text: "Coming soon." } });
  const result = await research(candidate(), deps({ fetchPage: fetcher.fetchPage }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /almost no text/i);
});

test("research degrades to partial when the model is down — the page text is what matters", async () => {
  const llmJson = async () => {
    throw new Error("NIM 503");
  };
  const result = await research(candidate(), deps({ llmJson: llmJson as any }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.researched.summary.partial, true);
  assert.equal(result.researched.summary.what_they_do, null);
  assert.ok(result.researched.text.includes("second branch"));
});

test("research never takes an email from the model — a personal address on the page is refused", async () => {
  const fetcher = fakeFetcher({
    "https://alsafa.example": { title: "Al Safa Restaurant", text: `${HOME_TEXT} Owner: alsafa.owner@gmail.com` },
  });
  const result = await research(candidate(), deps({ fetchPage: fetcher.fetchPage }));
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.researched.email, null);
});

// ── node 2 · qualify ────────────────────────────────────────────────────────────────────────

test("qualify scores a matching lead, and every point is attributable", async () => {
  const scored = qualify(await researchGood(), ICP, NOW);

  assert.ok(scored.score >= 50, `expected a passing score, got ${scored.score}`);
  assert.equal(scored.disqualified, null);
  assert.equal(scored.band, scored.score >= 70 ? "strong" : "worth-a-look");

  // The arithmetic is the sum of the components — no hidden term.
  const sum = scored.components.reduce((n, c) => n + c.points, 0);
  assert.equal(scored.score, Math.min(100, sum));

  // The four groups from the plan, with the plan's maxima.
  const groupMax = (g: string) => scored.components.filter((c) => c.group === g).reduce((n, c) => n + c.max, 0);
  assert.equal(groupMax("fit"), 40);
  assert.equal(groupMax("reachability"), 20);
  assert.equal(groupMax("signals"), 20);
  assert.equal(groupMax("timing"), 20);

  // Every component carries a readable reason: this is the "a human can take it apart" rule.
  assert.ok(scored.components.every((c) => c.why.length > 5));
  assert.match(scored.why, /^\d+\/100 — /);
});

test("a clearly wrong vertical scores low and is disqualified outright", async () => {
  const plumberText =
    "Rapid Plumbing fixes leaks and installs boilers across Dubai. " +
    "Emergency call-outs 24 hours a day, and we service every make of water heater in the city. " +
    "Our engineers are on the road from Jumeirah to Deira all week.";
  const fetcher = fakeFetcher({
    "https://rapidplumb.example": { title: "Rapid Plumbing", text: plumberText },
    "https://rapidplumb.example/contact": { title: "Contact", text: "Write to info@rapidplumb.example. Dubai." },
  });
  const researched = await research(
    candidate({ name: "Rapid Plumbing", website: "https://rapidplumb.example", domain: "rapidplumb.example", categories: ["plumber"] }),
    deps({ fetchPage: fetcher.fetchPage, llmJson: fakeLlm({ summary: { what_they_do: "A plumber.", size_signals: [], recent_changes: [], pain_hints: [], has_contact_form: false } }).llmJson })
  );
  assert.equal(researched.ok, true);
  if (!researched.ok) return;

  const scored = qualify(researched.researched, ICP, NOW);
  assert.ok(scored.score < 50, `a plumber should not pass a restaurants ICP, scored ${scored.score}`);
  assert.equal(scored.band, "below-the-line");
  assert.ok(scored.disqualified);
  assert.match(scored.disqualified!.reason, /not in the trade we are looking for/i);
  assert.equal(scored.components.find((c) => c.id === "industry")!.points, 0);
});

test("a constraint the ICP does not set cannot be failed", async () => {
  const noGeo = buildIcp({ query: "restaurants" });
  assert.equal(noGeo.ok, true);
  if (!noGeo.ok) return;
  const scored = qualify(await researchGood(), noGeo.icp, NOW);
  const geo = scored.components.find((c) => c.id === "geography")!;
  assert.equal(geo.points, 10);
  assert.match(geo.why, /no geographic constraint/i);
});

test("industryTerms folds the obvious plural without a stemmer", () => {
  assert.deepEqual(industryTerms("restaurants"), ["restaurants", "restaurant"]);
  assert.ok(industryTerms("dental clinics").includes("clinic"));
});

// ── node 3 · personalise ────────────────────────────────────────────────────────────────────

test("personalise returns one observation, with the words on their page that prove it", async () => {
  const result = await personalise(await researchGood(), ICP, deps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.observation.text, /second branch/i);
  assert.ok(HOME_TEXT.includes(result.observation.quote));
  assert.equal(result.observation.url, "https://alsafa.example");
});

test("personalise REFUSES a fact that is not in the text we read", async () => {
  const llm = fakeLlm({
    observation: {
      observation: "They have just been awarded a Michelin star.",
      quote: "Al Safa has been awarded a Michelin star",
      url: "https://alsafa.example",
    },
  });
  const result = await personalise(await researchGood(), ICP, deps({ llmJson: llm.llmJson }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /not actually on their site/i);
});

test("personalise REFUSES a real quote wrapped around an invented number", async () => {
  const llm = fakeLlm({
    observation: {
      observation: "They opened their 14th branch on Jumeirah Road this year.",
      quote: "We opened our second branch on Jumeirah Road in 2026",
      url: "https://alsafa.example",
    },
  });
  const result = await personalise(await researchGood(), ICP, deps({ llmJson: llm.llmJson }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /used a number \("14"\) that is not on their site/i);
});

test("personalise treats 'nothing specific enough' as a correct answer, not a crash", async () => {
  const llm = fakeLlm({ observation: { observation: null } });
  const result = await personalise(await researchGood(), ICP, deps({ llmJson: llm.llmJson }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /specific enough/i);
});

// ── node 4 · draft ──────────────────────────────────────────────────────────────────────────

const OBSERVATION = {
  text: "They opened a second branch on Jumeirah Road this year.",
  quote: "We opened our second branch on Jumeirah Road in 2026",
  url: "https://alsafa.example",
};

test("draft signs the message and carries a working opt-out, whatever the model wrote", async () => {
  const researched = await researchGood();
  const result = await draft(
    researched,
    { icp: ICP, identity: IDENTITY, observation: OBSERVATION, channel: "email", region: { strict: false, basis: "b2b-outreach", note: "" } },
    deps()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.status, "draft");
  assert.equal(result.draft.sent, false);
  assert.match(result.draft.text, /Sam, MrLxwa/);
  assert.match(result.draft.text, /reply with the word STOP/i);
  assert.match(result.draft.text, /sam@mrlxwa\.com/);
  assert.deepEqual([...result.draft.violations], []);
});

test("draft retries once on an unproven claim, and drops the lead if it happens again", async () => {
  let attempts = 0;
  const llm = fakeLlm({
    message: () => {
      attempts += 1;
      return { message: "We are the #1 agency in Dubai and guarantee more covers within 30 days." };
    },
  });
  const result = await draft(
    await researchGood(),
    { icp: ICP, identity: IDENTITY, observation: OBSERVATION, channel: "email", region: { strict: false, basis: "b2b-outreach", note: "" } },
    deps({ llmJson: llm.llmJson })
  );
  assert.equal(attempts, 2, "exactly one redraft — a rule is not a suggestion to keep asking about");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /compliance rule/i);
});

test("draft keeps a second attempt that fixed the violation", async () => {
  let attempts = 0;
  const llm = fakeLlm({
    message: () => {
      attempts += 1;
      return attempts === 1
        ? { message: "We are the #1 agency in Dubai." }
        : { message: "Congratulations on the new branch. We write monthly restaurant articles. Worth a look?" };
    },
  });
  const result = await draft(
    await researchGood(),
    { icp: ICP, identity: IDENTITY, observation: OBSERVATION, channel: "email", region: { strict: false, basis: "b2b-outreach", note: "" } },
    deps({ llmJson: llm.llmJson })
  );
  assert.equal(attempts, 2);
  assert.equal(result.ok, true);
});

// ── the whole graph ─────────────────────────────────────────────────────────────────────────

test("runPipeline: a qualified lead comes out whole, and is emitted as it is finished", async () => {
  const emitted: string[] = [];
  const result = await runPipeline({
    candidates: [candidate()],
    icp: ICP,
    identity: IDENTITY,
    deps: deps(),
    onLead: (l) => emitted.push(l.name),
    onProgress: () => {},
  });

  assert.equal(result.leads.length, 1);
  assert.deepEqual(emitted, ["Al Safa Restaurant"]);
  const lead = result.leads[0];
  assert.equal(lead.status, "draft");
  assert.equal(lead.sent, false);
  assert.equal(lead.channel, "email");
  assert.equal(lead.email, "info@alsafa.example");
  assert.ok(lead.score >= 50);
  assert.ok(lead.reasons.length > 5, "the rubric travels with the lead");
  assert.ok(lead.draft.includes("reply with the word STOP"));
  assert.equal(lead.observation_url, "https://alsafa.example");
});

test("runPipeline keeps an unresearchable lead that HAS a phone as a basic lead (never-0), drops one with no contact", async () => {
  const fetcher = fakeFetcher(GOOD_PAGES, "could not reach their site (ENOTFOUND)");
  const result = await runPipeline({
    candidates: [
      candidate({ name: "Ghost Cafe", website: "https://gone.example", domain: "gone.example" }), // unreachable site, but has a phone
      candidate({ name: "No Contact Co", website: "https://gone2.example", domain: "gone2.example", phone: null }), // unreachable AND no phone
      candidate(),
    ],
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ fetchPage: fetcher.fetchPage }),
  });

  // Ghost Cafe survives as a basic lead (empty draft, scored from its listing); the real Al Safa
  // is a full lead; only the contactless one is dropped at research.
  const ghost = result.leads.find((l) => l.name === "Ghost Cafe");
  assert.ok(ghost, "a business with a phone but no readable site is still a lead");
  assert.equal(ghost!.draft, ""); // no draft — the human writes it on WhatsApp
  assert.ok(ghost!.score > 0);
  assert.ok(result.dropped.some((d) => d.name === "No Contact Co" && d.stage === "research"));
  assert.ok(result.leads.some((l) => l.name === "Al Safa Restaurant" && l.draft));
});

test("runPipeline honours suppression, duplicates and the per-domain ceiling before spending anything", async () => {
  const llm = fakeLlm();
  const fetcher = fakeFetcher(GOOD_PAGES);
  const result = await runPipeline({
    candidates: [
      candidate({ name: "Suppressed Diner", website: "https://nope.example", domain: "nope.example" }),
      candidate({ name: "Already Known", website: "https://known.example", domain: "known.example" }),
      candidate(),
      candidate({ name: "Al Safa Restaurant (again)" }), // same domain
    ],
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ fetchPage: fetcher.fetchPage, llmJson: llm.llmJson }),
    suppression: [{ domain: "nope.example" }],
    knownDomains: new Set(["known.example"]),
  });

  const byStage = Object.fromEntries(result.dropped.map((d) => [d.name, d.stage]));
  assert.equal(byStage["Suppressed Diner"], "suppressed");
  assert.equal(byStage["Already Known"], "duplicate");
  assert.equal(byStage["Al Safa Restaurant (again)"], "duplicate");
  assert.equal(result.leads.length, 1);
  // The suppressed and duplicate leads cost zero page fetches and zero model calls.
  assert.ok(!fetcher.calls.some((u) => u.includes("nope.example") || u.includes("known.example")));
});

test("runPipeline DROPS a lead already known by PHONE, even with a brand-new-looking website", async () => {
  const llm = fakeLlm();
  // Same business, different URL this time — but the phone number is one we already have.
  const pages = {
    "https://alsafa-new.example": { title: "Al Safa Restaurant", text: HOME_TEXT },
    "https://alsafa-new.example/contact": { title: "Contact", text: CONTACT_TEXT },
  };
  const result = await runPipeline({
    candidates: [candidate({ name: "Al Safa (new site)", website: "https://alsafa-new.example", domain: "alsafa-new.example", phone: "+971 50 123 4567" })],
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ fetchPage: fakeFetcher(pages).fetchPage, llmJson: llm.llmJson }),
    knownPhones: new Set(["1501234567"]), // phoneKey of +971 50 123 4567 (digits, last 10)
  });

  assert.equal(result.leads.length, 0);
  assert.equal(result.dropped[0].stage, "duplicate");
});

test("runPipeline DROPS a website-less lead that matches a known NAME", async () => {
  const result = await runPipeline({
    // A bare map pin: no website, no domain. Its only identity is its name (and phone).
    candidates: [candidate({ name: "Al Safa Restaurant Pvt Ltd", website: null, domain: null, phone: null })],
    icp: ICP,
    identity: IDENTITY,
    deps: deps(),
    knownNames: new Set(["al safa restaurant"]), // nameKey drops the "Pvt Ltd" suffix
  });

  assert.equal(result.leads.length, 0);
  assert.equal(result.dropped[0].stage, "duplicate");
});

test("runPipeline DROPS the same phone twice WITHIN one run, keeping the first", async () => {
  const llm = fakeLlm();
  const pages = {
    ...GOOD_PAGES,
    "https://alsafa-two.example": { title: "Al Safa Restaurant", text: HOME_TEXT },
    "https://alsafa-two.example/contact": { title: "Contact", text: CONTACT_TEXT },
  };
  const result = await runPipeline({
    candidates: [
      candidate(), // phone +971 50 123 4567
      candidate({ name: "Al Safa (duplicate line)", website: "https://alsafa-two.example", domain: "alsafa-two.example", phone: "+971 50 123 4567" }), // same phone
    ],
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ fetchPage: fakeFetcher(pages).fetchPage, llmJson: llm.llmJson }),
  });

  assert.equal(result.leads.length, 1);
  assert.equal(result.dropped.filter((d) => d.stage === "duplicate").length, 1);
});

// ── the fit gate (Phase 3) ────────────────────────────────────────────────────────────────────

const GATE: FitGate = {
  offer: "We write monthly SEO articles for restaurants.",
  buyerSegments: ["Restaurants", "Cafes"],
  competitorSegments: [{ name: "Marketing agencies", cues: ["seo agency", "marketing agency", "content agency"] }],
  negativeDomains: ["rejected-before.example"],
  buyingSignals: [{ name: "No online menu", look_for: "menu", weight: 6 }, { name: "Recent branch", look_for: "branch opened", weight: 8 }],
};

test("Gate A: a candidate whose listing contains a competitor cue is dropped by rule, no fetch", () => {
  const hit = competitorCueHit(
    { name: "BrightSEO Agency", domain: "brightseo.example", website: "https://brightseo.example", categories: ["seo agency"] },
    GATE,
  );
  assert.match(String(hit), /competitor/i);
});

test("Gate A: a buyer-shaped candidate passes the cue check", () => {
  const hit = competitorCueHit(
    { name: "Al Safa Restaurant", domain: "alsafa.example", website: "https://alsafa.example", categories: ["restaurant"] },
    GATE,
  );
  assert.equal(hit, null);
});

test("Gate A: a domain on the negative list is dropped", () => {
  const hit = competitorCueHit(
    { name: "Whoever", domain: "rejected-before.example", website: "https://rejected-before.example", categories: [] },
    GATE,
  );
  assert.match(String(hit), /do-not-contact/i);
});

test("Gate B: classifyFit returns buyer when the model says buyer AND the quote is on the page", async () => {
  const r = await research(candidate(), deps());
  if (!r.ok) return assert.fail("research failed");
  const v = await classifyFit(r.researched, GATE, deps());
  assert.equal(v.verdict, "buyer");
  assert.ok(v.quote);
});

test("Gate B: a competitor verdict (with a real quote) classifies as competitor", async () => {
  const r = await research(candidate(), deps());
  if (!r.ok) return assert.fail("research failed");
  const d = deps({ llmJson: fakeLlm({ classify: { verdict: "competitor", quote: "We opened our second branch on Jumeirah Road in 2026", reason: "they sell the same service" } }).llmJson });
  const v = await classifyFit(r.researched, GATE, d);
  assert.equal(v.verdict, "competitor");
});

test("Gate B: a BUYER verdict is trusted even when its quote doesn't verify (don't bin real buyers)", async () => {
  const r = await research(candidate(), deps());
  if (!r.ok) return assert.fail("research failed");
  const d = deps({ llmJson: fakeLlm({ classify: { verdict: "buyer", quote: "this sentence is nowhere on their website at all", reason: "x" } }).llmJson });
  const v = await classifyFit(r.researched, GATE, d);
  assert.equal(v.verdict, "buyer"); // Gate A already screened competitors; a buyer verdict stands
  assert.equal(v.quote, null); // but the unverifiable quote is not kept as evidence
});

test("Gate B: a COMPETITOR verdict with an unverifiable quote still classifies competitor (dropped either way)", async () => {
  const r = await research(candidate(), deps());
  if (!r.ok) return assert.fail("research failed");
  const d = deps({ llmJson: fakeLlm({ classify: { verdict: "competitor", quote: "nowhere on their site", reason: "peer" } }).llmJson });
  const v = await classifyFit(r.researched, GATE, d);
  assert.equal(v.verdict, "competitor");
});

test("runPipeline with fitGate: a cue-matching competitor is dropped before any page is fetched", async () => {
  const fetcher = fakeFetcher(GOOD_PAGES);
  const result = await runPipeline({
    candidates: [
      candidate({ name: "BrightSEO Agency", website: "https://brightseo.example", domain: "brightseo.example", categories: ["seo agency"] }),
      candidate(),
    ],
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ fetchPage: fetcher.fetchPage }),
    fitGate: GATE,
  });
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].name, "Al Safa Restaurant");
  assert.equal(result.leads[0].classification, "buyer");
  assert.ok(result.dropped.some((d) => d.stage === "competitor" && d.name === "BrightSEO Agency"));
  // the competitor cost zero fetches
  assert.ok(!fetcher.calls.some((u) => u.includes("brightseo.example")));
});

test("runPipeline with fitGate: Gate B drops a competitor the cues missed, after reading the page", async () => {
  const result = await runPipeline({
    candidates: [candidate()],
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ llmJson: fakeLlm({ classify: { verdict: "competitor", quote: "We opened our second branch on Jumeirah Road in 2026", reason: "peer" } }).llmJson }),
    fitGate: GATE,
  });
  assert.equal(result.leads.length, 0);
  assert.ok(result.dropped.some((d) => d.stage === "competitor"));
});

test("runPipeline WITHOUT fitGate behaves exactly as before (gate off → no classify call)", async () => {
  const llm = fakeLlm();
  const result = await runPipeline({ candidates: [candidate()], icp: ICP, identity: IDENTITY, deps: deps({ llmJson: llm.llmJson }) });
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].classification, undefined);
  assert.ok(!llm.prompts.some((p) => p.includes("BUYER of an offer")), "no classifier prompt when the gate is off");
});

// ── buyer-fit scoring (Phase 4) ───────────────────────────────────────────────────────────────

test("qualifyBuyer: a confirmed segment + verified signals score well, and every point is attributable", async () => {
  const r = await research(candidate(), deps());
  if (!r.ok) return assert.fail("research failed");
  // icp.industry stands in for the confirmed buyer segment name; "restaurant" is in the listing.
  const scored = qualifyBuyer(r.researched, ICP, GATE.buyingSignals, NOW);
  assert.ok(scored.score >= 60, `expected a decent score, got ${scored.score}`);
  const groups = new Set(scored.components.map((c) => c.group));
  assert.ok(groups.has("fit") && groups.has("signals") && groups.has("reachability") && groups.has("timing"));
  // the buyer-segment group is the 30-point one now, not 20
  assert.equal(scored.components.find((c) => c.id === "buyer-segment")?.max, 30);
  assert.ok(scored.components.find((c) => c.id === "buying-signals")!.points > 0, "signals were verified on the page");
});

test("qualifyBuyer: zero verified buying signals caps the total at 55 (low intent)", async () => {
  const r = await research(candidate(), deps());
  if (!r.ok) return assert.fail("research failed");
  // signals whose words are nowhere on the page → none verified → cap
  const scored = qualifyBuyer(r.researched, ICP, [{ name: "Runs paid ads", look_for: "adwords campaign quarterly budget", weight: 9 }], NOW);
  assert.ok(scored.score <= 55, `expected cap at 55, got ${scored.score}`);
  assert.notEqual(scored.band, "strong");
});

test("runPipeline stops at the run ceiling instead of drafting past it", async () => {
  const pages: Record<string, { title: string; text: string }> = {};
  const candidates = [1, 2, 3].map((n) => {
    pages[`https://site${n}.example`] = { title: `Restaurant ${n}`, text: HOME_TEXT };
    pages[`https://site${n}.example/contact`] = { title: "Contact", text: `Write to info@site${n}.example. Dubai.` };
    return candidate({ name: `Restaurant ${n}`, website: `https://site${n}.example`, domain: `site${n}.example` });
  });

  const result = await runPipeline({
    candidates,
    icp: ICP,
    identity: IDENTITY,
    deps: deps({ fetchPage: fakeFetcher(pages).fetchPage }),
    ledger: new RunLedger({ maxPerRun: 2 }),
  });

  assert.equal(result.leads.length, 2);
  assert.equal(result.dropped.filter((d) => d.stage === "ceiling").length, 1);
});

// ── the contract ────────────────────────────────────────────────────────────────────────────

test("the output is exactly the shape leads.find_leads promises in its manifest", async () => {
  const result = await runPipeline({ candidates: [candidate()], icp: ICP, identity: IDENTITY, deps: deps() });
  const output = buildFindLeadsOutput({ result, icpLabel: "5 × restaurants in Dubai [local]", sources: ["OpenStreetMap: 1 found"] });

  const manifest = MANIFESTS.find((m) => m.id === "leads");
  assert.ok(manifest, "the leads manifest must exist");
  const action = manifest!.actions.find((a) => a.id === "find_leads");
  assert.ok(action, "find_leads must exist");

  // Validated with the contract's own validator — the same one runAction uses on a real run.
  assert.deepEqual(validateAgainstSchema(action!.output, output), []);
  // And the input shape this agent is built to receive.
  assert.deepEqual(validateAgainstSchema(action!.input, { query: "restaurants in Dubai", count: 5 }), []);

  // The two facts the product must never be vague about.
  assert.equal(output.sent, false);
  assert.ok(output.leads.every((l) => l.status === "draft" && l.sent === false));
});

test("an empty run is still a valid output, not an error", async () => {
  const result = await runPipeline({ candidates: [], icp: ICP, identity: IDENTITY, deps: deps() });
  const output = buildFindLeadsOutput({ result, icpLabel: "5 × restaurants in Dubai [local]", sources: [] });
  const action = MANIFESTS.find((m) => m.id === "leads")!.actions.find((a) => a.id === "find_leads")!;
  assert.deepEqual(validateAgainstSchema(action.output, output), []);
  assert.deepEqual(output.leads, []);
});
