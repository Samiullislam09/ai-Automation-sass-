/** Run: cd agent-server && npx tsx --test src/lib/leads/compliance.test.ts
 *
 *  Every rule in compliance.ts has a violating fixture here. That is the point of the file:
 *  a compliance rule with no test is a comment. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const {
  POLICY,
  OPT_OUT_PHRASE,
  RunLedger,
  SendAttemptError,
  assertDraftOnly,
  buildSignature,
  businessEmailsOnPage,
  checkClaims,
  checkIdentification,
  checkOptOut,
  domainOf,
  emailIsBusinessContact,
  isSuppressed,
  regionAllows,
  regionRule,
  sealDraft,
  screenDraft,
} = await import("./compliance.js");

type SenderIdentity = import("./compliance.js").SenderIdentity;
type Proof = import("../siteProfile.js").Proof;

const IDENTITY: SenderIdentity = {
  personName: "Sam",
  businessName: "MrLxwa",
  website: "https://mrlxwa.com",
  replyTo: "sam@mrlxwa.com",
};

const PROOF: Proof[] = [{ claim: "ISO 9001 certified", quote: "We are ISO 9001 certified", url: "https://mrlxwa.com/about" }];

// ── rule 1 · no personal-email scraping ─────────────────────────────────────────────────────

test("a role address published on a contact page is business contact", () => {
  const verdict = emailIsBusinessContact("info@alsafa.ae", {
    pageUrl: "https://alsafa.ae/contact",
    pageText: "Call us or write to info@alsafa.ae",
    businessDomain: "alsafa.ae",
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.ok && verdict.email, "info@alsafa.ae");
});

test("VIOLATION: a personal mailbox is refused however it was published", () => {
  const verdict = emailIsBusinessContact("alsafarestaurant@gmail.com", {
    pageUrl: "https://alsafa.ae/contact",
    pageText: "Email us: alsafarestaurant@gmail.com",
    businessDomain: "alsafa.ae",
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? "" : verdict.why, /personal mailbox provider/i);
});

test("VIOLATION: an address that is not on the page we read is refused (nothing is assembled)", () => {
  const verdict = emailIsBusinessContact("ahmed@alsafa.ae", {
    pageUrl: "https://alsafa.ae/contact",
    pageText: "Our manager is Ahmed. Call 0501234567.",
    businessDomain: "alsafa.ae",
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? "" : verdict.why, /not published on the page/i);
});

test("VIOLATION: a named person's address found on a blog post is not published for business contact", () => {
  const verdict = emailIsBusinessContact("ahmed.hassan@somewhere.co", {
    pageUrl: "https://alsafa.ae/blog/our-new-menu",
    pageText: "Written by ahmed.hassan@somewhere.co after the tasting.",
    businessDomain: "alsafa.ae",
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? "" : verdict.why, /not published for business contact/i);
});

test("every business address on a page, and only those", () => {
  const found = businessEmailsOnPage({
    pageUrl: "https://alsafa.ae/contact",
    pageText: "bookings@alsafa.ae · info@alsafa.ae · owner personal: ahmed@gmail.com",
    businessDomain: "alsafa.ae",
  });
  assert.deepEqual(found, ["bookings@alsafa.ae", "info@alsafa.ae"]);
});

// ── rule 2 · ceilings ───────────────────────────────────────────────────────────────────────

test("VIOLATION: a second draft for the same domain in one run is refused", () => {
  const ledger = new RunLedger();
  assert.equal(ledger.admit("alsafa.ae").ok, true);
  const second = ledger.admit("www.alsafa.ae"); // same business, different spelling
  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.violation.rule, "domain-ceiling");
  assert.equal(ledger.drafted, 1);
});

test("VIOLATION: the run ceiling stops the run", () => {
  const ledger = new RunLedger({ maxPerRun: 2 });
  assert.equal(ledger.admit("a.com").ok, true);
  assert.equal(ledger.admit("b.com").ok, true);
  const third = ledger.admit("c.com");
  assert.equal(third.ok, false);
  assert.equal(third.ok === false && third.violation.rule, "run-ceiling");
});

test("a caller may lower the ceiling and may never raise it past the hard maximum", () => {
  assert.equal(new RunLedger({ maxPerRun: 5 }).maxPerRun, 5);
  assert.equal(new RunLedger({ maxPerRun: 10_000 }).maxPerRun, POLICY.HARD_MAX_PER_RUN);
  assert.equal(new RunLedger({ maxPerDomain: 99 }).maxPerDomain, POLICY.MAX_PER_DOMAIN);
});

// ── rule 3 · suppression ────────────────────────────────────────────────────────────────────

test("VIOLATION: the do-not-contact list is matched on domain, email and phone", () => {
  const list = [{ domain: "nope.ae", email: null, phone: null }, { domain: null, email: "info@quiet.com", phone: null }, { domain: null, email: null, phone: "+971 50 123 4567" }];

  assert.equal(isSuppressed({ domain: "www.nope.ae" }, list)?.rule, "suppressed");
  assert.equal(isSuppressed({ email: "INFO@quiet.com" }, list)?.rule, "suppressed");
  // Same number, written differently — the last nine digits are what is compared.
  assert.equal(isSuppressed({ phone: "0501234567" }, list)?.rule, "suppressed");
  assert.equal(isSuppressed({ domain: "fine.ae", email: "info@fine.ae", phone: "+971509999999" }, list), null);
});

// ── rule 4 · identification and a working opt-out ───────────────────────────────────────────

test("the signature identifies the sender and carries a working opt-out", () => {
  const sig = buildSignature(IDENTITY);
  assert.match(sig, /Sam, MrLxwa/);
  assert.match(sig, /https:\/\/mrlxwa\.com/);
  assert.match(sig, new RegExp(OPT_OUT_PHRASE, "i"));
  assert.match(sig, /sam@mrlxwa\.com/);
  assert.equal(checkIdentification(sig, IDENTITY), null);
  assert.equal(checkOptOut(sig, IDENTITY), null);
});

test("VIOLATION: a message that never names the sender's business", () => {
  const v = checkIdentification("Hi — loved your new menu. Fancy a chat?", IDENTITY);
  assert.equal(v?.rule, "identification");
  assert.match(v!.detail, /never names the sender's business/i);
});

test("VIOLATION: no opt-out, and an opt-out with nothing to act on", () => {
  assert.equal(checkOptOut("Hi from Sam at MrLxwa. Bye.", IDENTITY)?.rule, "opt-out");
  // The phrase is there, the address is not: a reader told to reply somewhere unnamed.
  const noAddress = `Fine. If you would rather not hear from me, ${OPT_OUT_PHRASE} and I will not write again.`;
  assert.equal(checkOptOut(noAddress, IDENTITY)?.rule, "opt-out");
  // With no reply address configured at all, the same line IS the whole opt-out and passes.
  assert.equal(checkOptOut(noAddress, { ...IDENTITY, replyTo: null }), null);
});

// ── rule 5 · no claim that is not in `proof` ────────────────────────────────────────────────

test("VIOLATION: a certification, a percentage and a count with nothing to back them", () => {
  const text = "We are ISO 27001 certified. We lift traffic by 40%. We work with 200+ clients.";
  const violations = checkClaims(text, [], []);
  assert.equal(violations.length, 3);
  assert.ok(violations.every((v) => v.rule === "unproven-claim"));
  assert.match(violations[0].detail, /certification we cannot prove/i);
});

test("a claim the Site Brain can prove passes", () => {
  assert.deepEqual(checkClaims("We are ISO 9001 certified.", PROOF, []), []);
  // …and the same sentence with the tenant's real proof missing does not.
  assert.equal(checkClaims("We are ISO 9001 certified.", [], []).length, 1);
});

test("ordinary prose is not a claim", () => {
  assert.deepEqual(checkClaims("Your new branch in Jumeirah looks busy. Would a monthly plan help?", [], []), []);
});

// ── region ──────────────────────────────────────────────────────────────────────────────────

test("a GDPR territory changes the legal basis and what may be contacted", () => {
  const strict = regionRule("Manchester");
  assert.equal(strict.strict, true);
  assert.equal(strict.basis, "legitimate-interest-b2b");
  assert.equal(regionAllows({ domain: "acme.co.uk" }, strict), null);
  // VIOLATION: nothing shows this is a business rather than a person.
  assert.equal(regionAllows({ domain: null, email: "someone@gmail.com" }, strict)?.rule, "region");

  const loose = regionRule("Dubai");
  assert.equal(loose.strict, false);
  assert.equal(regionAllows({ domain: null, email: "someone@gmail.com" }, loose), null);
});

// ── rule 6 · drafting is not sending ────────────────────────────────────────────────────────

test("a sealed draft is frozen: it cannot be turned into something that was sent", () => {
  const draft = sealDraft(
    { body: "Your new branch in Jumeirah looks busy. We write monthly articles. Worth a look?", channel: "email", identity: IDENTITY },
    { proof: PROOF }
  );
  assert.equal(draft.status, "draft");
  assert.equal(draft.sent, false);
  assert.deepEqual([...draft.violations], []);
  assert.match(draft.text, new RegExp(OPT_OUT_PHRASE, "i"));

  // ES modules are strict mode, so writing to a frozen object throws rather than silently
  // failing. This is the "impossible rather than merely undone" part.
  assert.throws(() => {
    (draft as any).status = "sent";
  }, TypeError);
  assert.throws(() => {
    (draft as any).sent_at = new Date().toISOString();
  }, TypeError);
  assert.equal(draft.status, "draft");
});

test("a draft is sealed WITH its violations rather than silently cleaned up", () => {
  const draft = sealDraft(
    { body: "We are the #1 agency in Dubai and guarantee results.", channel: "email", identity: IDENTITY },
    { proof: [] }
  );
  assert.ok(draft.violations.length >= 1);
  assert.ok(draft.violations.some((v) => v.rule === "unproven-claim"));
});

test("VIOLATION: anything claiming to have been sent stops the run", () => {
  assert.throws(() => assertDraftOnly({ status: "sent" }), SendAttemptError);
  assert.throws(() => assertDraftOnly({ status: "draft", sent: true }), SendAttemptError);
  assert.throws(() => assertDraftOnly({ status: "draft", sent_at: "2026-08-27T00:00:00Z" }), SendAttemptError);
  assert.throws(() => assertDraftOnly({ status: "draft", message_id: "smtp-123" }), SendAttemptError);
  // A nested draft is checked too — that is where a transport would try to hide it.
  assert.throws(() => assertDraftOnly({ status: "draft", draft: { status: "queued" } }), SendAttemptError);
  // The honest shape passes.
  assert.doesNotThrow(() => assertDraftOnly({ status: "draft", sent: false, draft: { status: "draft", sent: false } }));
});

test("this module exports nothing that could send anything", async () => {
  const mod: Record<string, unknown> = await import("./compliance.js");
  const suspicious = Object.keys(mod)
    // SendAttemptError is the guard, not a transport — it is the thing that throws when
    // somebody tries. Everything else with a delivering verb in its name is a failure.
    .filter((k) => k !== "SendAttemptError")
    .filter((k) => /^(send|deliver|dispatch|mail|smtp|transport|post|submit)/i.test(k));
  assert.deepEqual(suspicious, [], `compliance.ts must not export a transport, found: ${suspicious.join(", ")}`);
});

// ── the whole screen, and helpers ───────────────────────────────────────────────────────────

test("screenDraft runs identification, opt-out and claims together", () => {
  const bad = "We are the leading agency. Call me.";
  const violations = screenDraft(bad, IDENTITY, { proof: [] });
  assert.deepEqual(
    violations.map((v) => v.rule).sort(),
    ["identification", "opt-out", "unproven-claim"]
  );
});

test("domainOf is forgiving about how a website was written down", () => {
  assert.equal(domainOf("https://www.Alsafa.ae/menu"), "alsafa.ae");
  assert.equal(domainOf("alsafa.ae"), "alsafa.ae");
  assert.equal(domainOf(""), null);
  assert.equal(domainOf("not a url at all"), null);
});
