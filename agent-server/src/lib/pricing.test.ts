/** Run: cd agent-server && npx tsx --test src/lib/pricing.test.ts
 *
 *  Finding a business's price on its own website — and, above all, never reporting one that is not there. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { findAmounts, collectSnippets, rangeIsGrounded, mentionsQuoteOnly, detectPricing, priceUrlScore } = await import("./pricing.js");

const PRICING_PAGE = {
  url: "https://wca-global.com/pricing",
  title: "Pricing — ISO consultancy",
  text: "Our packages\nISO 9001 certification starts from AED 4,000 for up to 50 staff.\nISO 14001 and ISO 45001 packages are AED 5,000 - AED 10,000 depending on the number of sites.\nThe certification body's audit fee is separate.",
};
const HOME = { url: "https://wca-global.com/", title: "Home", text: "We help companies get ISO certified. Over 300 clients since 2012. Call us today." };
const BLOG = { url: "https://wca-global.com/blog/iso-cost-example", title: "How much does ISO cost?", text: "In our example a company spent $50,000 on fines before certification. A competitor charges $12,000 which we think is too much." };

test("findAmounts: amounts with a currency, in the common shapes; bare numbers are not amounts", () => {
  const t = (s: string) => findAmounts(s).map((a) => a.text);
  assert.deepEqual(t("from AED 4,000 for up to 50 staff"), ["AED 4,000"]);
  assert.deepEqual(t("only $29/month"), ["$29"]);
  assert.deepEqual(t("costs 4000 AED per year"), ["4000 AED"]);
  assert.deepEqual(t("Rs. 15,000 onwards"), ["Rs. 15,000"]);
  assert.deepEqual(t("₹ 25,000 + GST"), ["₹ 25,000"]);
  assert.deepEqual(t("€1,299.50 incl. VAT"), ["€1,299.50"]);
  assert.deepEqual(t("5 users, since 2012, call 0501234567"), [], "no currency, no amount");
});

test("collectSnippets: price talk is found and ranked first; a stray amount on an ordinary page is not", () => {
  const s = collectSnippets([HOME, PRICING_PAGE, { url: "https://x.com/about", text: "We were founded with AED 100,000 of our own savings." }]);
  assert.ok(s.length >= 1);
  assert.equal(s[0].url, "https://wca-global.com/pricing");
  assert.ok(s.every((x) => !/own savings/.test(x.text)), "an amount with no price-talk around it on a non-price page is skipped");
  assert.deepEqual(collectSnippets([HOME]), []);
});

test("collectSnippets: bounded — one long price list cannot flood it", () => {
  const long = { url: "https://x.com/pricing", text: Array.from({ length: 40 }, (_, i) => `Plan ${i}: AED ${1000 + i} per month.`).join("\n") };
  assert.ok(collectSnippets([long]).length <= 3, "at most three per page");
  const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://x.com/pricing-${i}`, text: `Package ${i} costs AED ${2000 + i * 7} per month.` }));
  assert.ok(collectSnippets(many).length <= 12);
});

test("priceUrlScore: a pricing address or title scores", () => {
  assert.ok(priceUrlScore(PRICING_PAGE) >= 3);
  assert.equal(priceUrlScore(HOME), 0);
});

test("rangeIsGrounded: every figure must be printed on the site; commas and wording do not matter", () => {
  const texts = [PRICING_PAGE.text];
  assert.equal(rangeIsGrounded("AED 4,000 – 10,000", texts), true);
  assert.equal(rangeIsGrounded("from AED 4000", texts), true, "4,000 on the page matches 4000");
  assert.equal(rangeIsGrounded("AED 4,000 to AED 9,500", texts), false, "9,500 is on no page");
  assert.equal(rangeIsGrounded("AED 3,500", texts), false, "a competitor's number is not ours");
  assert.equal(rangeIsGrounded("affordable pricing", texts), false, "no figure, nothing proved");
  assert.equal(rangeIsGrounded(null, texts), false);
});

test("mentionsQuoteOnly: 'price on request' sites are recognised", () => {
  assert.equal(mentionsQuoteOnly("Contact us for a quote tailored to your project."), true);
  assert.equal(mentionsQuoteOnly("Request a free quotation today"), true);
  assert.equal(mentionsQuoteOnly("Pricing is tailored to each client."), true);
  assert.equal(mentionsQuoteOnly("We help companies get certified."), false);
});

test("detectPricing: a printed range is reported, with the pages it came from", async () => {
  const r = await detectPricing([HOME, PRICING_PAGE], async () => ({ model: "quote", range: "AED 4,000 – AED 10,000", note: "audit body fee separate" }));
  assert.ok(r);
  assert.equal(r!.pricing.range, "AED 4,000 – AED 10,000");
  assert.equal(r!.pricing.model, "quote");
  assert.deepEqual(r!.sources, ["https://wca-global.com/pricing"]);
});

test("detectPricing: a range the model made up is REJECTED, not trusted", async () => {
  // The model returns a plausible but invented number; 6,500 is on no page.
  const r = await detectPricing([HOME, PRICING_PAGE], async () => ({ model: "fixed", range: "AED 6,500", note: null }));
  assert.equal(r, null, "no grounded range and the site never says 'on request' → no price");
  // …unless the site really does say it is by quote, in which case that (and only that) is reported.
  const q = await detectPricing([HOME, { ...PRICING_PAGE, text: PRICING_PAGE.text + "\nContact us for a custom quote." }], async () => ({ model: "fixed", range: "AED 6,500", note: null }));
  assert.equal(q!.pricing.range, null);
  assert.equal(q!.pricing.model, "quote");
});

test("detectPricing: a note with an unprinted figure is dropped, a clean one kept", async () => {
  const r = await detectPricing([PRICING_PAGE], async () => ({ model: "fixed", range: "from AED 4,000", note: "valid for 99 days" }));
  assert.equal(r!.pricing.range, "from AED 4,000");
  assert.equal(r!.pricing.note, null, "99 is not on the page");
});

test("detectPricing: amounts that are not the business's price are not reported", async () => {
  // Only a blog full of someone else's numbers. The model (wrongly) offers one; it is not even on a price
  // page, and the grounding check passes only because the number IS on the site — so the model is the guard
  // here: told to ignore examples, it returns null, and null stays null.
  const r = await detectPricing([HOME, BLOG], async () => ({ model: null, range: null, note: null }));
  assert.equal(r, null);
});

test("detectPricing: no amounts and no 'quote' wording means nothing, and the model is never asked", async () => {
  let called = false;
  const r = await detectPricing([HOME], async () => { called = true; return { range: "AED 1" }; });
  assert.equal(r, null);
  assert.equal(called, false, "nothing to summarise, nothing to hallucinate from");
});

test("detectPricing: a site that says price-on-request gets model 'quote' without any model call", async () => {
  let called = false;
  const r = await detectPricing([HOME, { url: "https://x.com/services", text: "Our fees depend on scope. Request a quote and we will respond within a day." }], async () => { called = true; return {}; });
  assert.equal(r!.pricing.model, "quote");
  assert.equal(r!.pricing.range, null);
  assert.equal(called, false);
});

test("detectPricing: a model that throws or returns junk never breaks it or invents a price", async () => {
  assert.equal(await detectPricing([PRICING_PAGE], async () => { throw new Error("down"); }), null);
  assert.equal(await detectPricing([PRICING_PAGE], async () => "not json at all"), null);
  assert.equal(await detectPricing([PRICING_PAGE], async () => ({ range: 12345 })), null);
});

test("real-site regressions: unspaced page text, and words that merely END in a currency code", () => {
  // A crawled page has no spaces between elements: "From$2,4008–12 weeks".
  const t = (s: string) => findAmounts(s).map((a) => a.text);
  assert.deepEqual(t("EssentialOne standard, one site.From$2,4008–12 weeks · one standard"), ["$2,400"]);
  assert.deepEqual(t("Professional$6,80012–20 weeks"), ["$6,800"]);
  // "2 audits" is not "2 AUD"; "users. 3" is not "Rs. 3"; but a real code still counts
  assert.deepEqual(t("two internal audits and 2 audits per year, for 5 users. 3 workshops"), []);
  assert.deepEqual(t("fee is 2,000 AUD plus GST, or AUD 2000"), ["2,000 AUD", "AUD 2000"]);
  // and the unspaced figure is still found on the page when the model quotes it with its comma
  assert.equal(rangeIsGrounded("from $2,400 to $18,000", ["From$2,4008–12 weeks ... Enterprise$18,000Custom"]), true);
});

test("a dedicated /pricing page outranks an article about what such services cost", () => {
  const pricing = { url: "https://x.com/pricing", title: "Pricing", text: "Essential From $2,400 per project. Professional From $6,800 per project." };
  const article = { url: "https://x.com/iso-9001-certification-cost-in-dubai", title: "ISO 9001 cost in Dubai", text: "Typically companies pay AED 3,000 to AED 25,000 depending on size." };
  const s = collectSnippets([article, pricing]);
  assert.equal(s[0].url, "https://x.com/pricing");
});

test("detectPricing: when a dedicated pricing page exists, ONLY it is shown to the model (no mixing with market-guide articles)", async () => {
  let seen = "";
  const article = { url: "https://x.com/iso-cost-in-dubai", title: "ISO cost in Dubai", text: "Companies typically pay AED 3,000 to AED 25,000 for certification depending on size and price of consultants." };
  const r = await detectPricing([article, { ...PRICING_PAGE, url: "https://x.com/pricing" }], async (prompt: string) => { seen = prompt; return { model: "fixed", range: "from AED 4,000", note: null }; });
  assert.ok(seen.includes("AED 4,000"));
  assert.ok(!seen.includes("AED 25,000"), "the article's figures never reach the model");
  assert.equal(r!.pricing.range, "from AED 4,000");
  assert.deepEqual(r!.sources, ["https://x.com/pricing"]);
  // without a pricing page the article is all there is, and is used
  let seen2 = "";
  await detectPricing([article], async (prompt: string) => { seen2 = prompt; return { range: null }; });
  assert.ok(seen2.includes("AED 25,000"));
});
