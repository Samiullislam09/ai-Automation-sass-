/** Run: cd agent-server && npx tsx --test src/lib/businessDetails.test.ts
 *
 *  Reading a business's contact details off its own site, and refusing anything the site does not print. The page
 *  texts below are shaped like real crawled text — NO spaces between page elements. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { cleanEmail, pickEmail, extractPhones, pickPhones, detailSnippets, groundedOn, detectBusinessDetails, emptyDetails, hasAnyDetail } = await import("./businessDetails.js");
const { buildBusinessBrief } = await import("./whatsapp/decide.js");
const { profileBlock, emptyProfile } = await import("./siteProfile.js");
const { missingDetails } = await import("./whatsapp/conversation.js");

const FOOTER = "Quick linksHomeServicesContactCall+971 4 345 6789Email info@wca-global.comPrivacy PolicyTermsCompany: WCA GlOBAL™, B21-057, SRTI Park, Sharjah, UAE.© 2026";
const CONTACT = {
  url: "https://wca-global.com/contact",
  title: "Contact us",
  text: "Get in touchOur officeB21-057, SRTI Park, Sharjah, UAEOpening hours: Sunday to Thursday, 9:00 AM – 6:00 PM. WhatsApp +971 50 123 4567Email info@wca-global.comTrade licence no. 1234567 issued by Sharjah Research Technology and Innovation Park. " + FOOTER,
};
const HOME = { url: "https://wca-global.com/", title: "Home", text: "We help companies get ISO certified. " + FOOTER };
const BLOG = { url: "https://wca-global.com/blog/x", title: "Blog", text: "A long article about ISO. Contact a partner at partner@othercompany.com or +44 20 7946 0958. " + "x ".repeat(6000) + FOOTER };
const PAGES = [HOME, CONTACT, BLOG];

test("cleanEmail: unspaced text — the address is cut back to its real domain, glued labels are stripped", () => {
  assert.equal(cleanEmail("info@wca-global.comPrivacy"), "info@wca-global.com");
  assert.equal(cleanEmail("Emailinfo@wca-global.com"), "info@wca-global.com");
  assert.equal(cleanEmail("sales@company.co.ukHome"), "sales@company.co.uk");
  assert.equal(cleanEmail("Contact@Site.AE"), "contact@site.ae");
});

test("cleanEmail: placeholders, images and no-reply boxes are not contact addresses", () => {
  for (const bad of ["logo@2x.png", "name@example.com", "noreply@wca-global.com", "your@email.com", "user@domain.com", "abc@sentry.io", "image@2x.webp", "a@b"]) assert.equal(cleanEmail(bad), null, bad);
});

test("pickEmail: the site's own address on the most pages wins over a partner's", () => {
  const r = pickEmail(PAGES, "https://wca-global.com")!;
  assert.equal(r.email, "info@wca-global.com");
  assert.ok(r.urls.length >= 1);
  assert.equal(pickEmail([{ url: "https://x.com/", text: "no address here" }], "https://x.com"), null);
});

test("phones: international numbers are read and validated; a number labelled WhatsApp is the WhatsApp number", () => {
  const hits = extractPhones(PAGES);
  const e164 = hits.map((h) => h.e164);
  assert.ok(e164.includes("+97143456789"), "the landline in the footer");
  assert.ok(e164.includes("+971501234567"), "the mobile on /contact");
  const { phone, whatsapp } = pickPhones(PAGES);
  assert.equal(phone!.e164, "+97143456789");
  assert.equal(phone!.display, "+971 4 345 6789");
  assert.equal(whatsapp!.e164, "+971501234567");
});

test("phones: the footer repeated on every page outranks a number printed once on a blog", () => {
  const { phone } = pickPhones(PAGES);
  assert.notEqual(phone!.e164, "+442079460958", "a partner's number printed once is not the business's");
});

test("phones: no country code means no number (nothing is guessed), and an impossible number is dropped", () => {
  assert.deepEqual(extractPhones([{ url: "https://x.com/", text: "Call 050 123 4567 today" }]), []);
  assert.deepEqual(extractPhones([{ url: "https://x.com/", text: "Call +971 99 9 invalid" }]), []);
});

test("detailSnippets: the right excerpts, from contact-like pages first", () => {
  const a = detailSnippets(PAGES, "address");
  assert.ok(a.length >= 1);
  assert.equal(a[0].url, "https://wca-global.com/contact");
  assert.ok(detailSnippets(PAGES, "hours").some((s) => /Sunday to Thursday/.test(s.text)));
  assert.ok(detailSnippets(PAGES, "registration").some((s) => /1234567/.test(s.text)));
  assert.deepEqual(detailSnippets([{ url: "https://x.com/", text: "Nothing about contact here." }], "hours"), []);
});

test("groundedOn: every word must be on ONE page — wording and punctuation may differ, invention may not", () => {
  // the footer repeats the company address on every page, so the first page that prints it is a valid ground
  assert.ok(groundedOn("B21-057, SRTI Park, Sharjah, UAE", PAGES));
  assert.ok(groundedOn("SRTI Park Sharjah UAE B21 057", PAGES), "punctuation and spacing do not matter");
  assert.equal(groundedOn("Office 12, Business Bay, Dubai", PAGES), null, "an address the site never prints");
  assert.equal(groundedOn("B21-057, SRTI Park, Dubai Marina", PAGES), null, "one invented word is enough to reject it");
  assert.equal(groundedOn("", PAGES), null);
  // stitching a sentence from words on different pages is not grounding
  assert.equal(groundedOn("Sunday partner zzz", PAGES), null);
});

test("detectBusinessDetails: email and phone by pattern, the rest from the model — and only what is printed", async () => {
  const r = await detectBusinessDetails(PAGES, "https://wca-global.com", async () => ({
    address: "B21-057, SRTI Park, Sharjah, UAE",
    hours: "Sunday to Thursday, 9:00 AM – 6:00 PM",
    registration: "Trade licence no. 1234567",
  }));
  assert.ok(r);
  assert.equal(r!.details.email, "info@wca-global.com");
  assert.equal(r!.details.phone, "+971 4 345 6789");
  assert.equal(r!.details.whatsapp, "+971 50 123 4567");
  assert.equal(r!.details.address, "B21-057, SRTI Park, Sharjah, UAE");
  assert.equal(r!.details.hours, "Sunday to Thursday, 9:00 AM – 6:00 PM");
  assert.equal(r!.details.registration, "Trade licence no. 1234567");
  assert.ok(r!.sources.includes("https://wca-global.com/contact"));
});

test("detectBusinessDetails: an address, hours or licence the model INVENTS is dropped; the pattern-found ones stay", async () => {
  const r = await detectBusinessDetails(PAGES, "https://wca-global.com", async () => ({
    address: "Office 12, Business Bay, Dubai",              // not on the site
    hours: "Monday to Friday, 8 AM - 5 PM",                 // the site says Sunday to Thursday
    registration: "Licence no. 9999999",                    // not on the site
  }));
  assert.ok(r);
  assert.equal(r!.details.address, null);
  assert.equal(r!.details.hours, null);
  assert.equal(r!.details.registration, null);
  assert.equal(r!.details.email, "info@wca-global.com", "found by pattern, not by the model");
  assert.equal(r!.details.phone, "+971 4 345 6789");
});

test("detectBusinessDetails: a failing or junk model never breaks it; a site with nothing printed returns null", async () => {
  const down = await detectBusinessDetails(PAGES, "https://wca-global.com", async () => { throw new Error("down"); });
  assert.equal(down!.details.email, "info@wca-global.com");
  assert.equal(down!.details.address, null);
  const junk = await detectBusinessDetails(PAGES, "https://wca-global.com", async () => "not json");
  assert.equal(junk!.details.address, null);
  assert.equal(await detectBusinessDetails([{ url: "https://x.com/", text: "We sell widgets." }], "https://x.com", async () => ({ address: "1 Fake St" })), null);
  let called = false;
  await detectBusinessDetails([{ url: "https://x.com/", text: "We sell widgets." }], "https://x.com", async () => { called = true; return {}; });
  assert.equal(called, false, "no excerpt, no model call");
});

test("hasAnyDetail / emptyDetails", () => {
  assert.equal(hasAnyDetail(emptyDetails()), false);
  assert.equal(hasAnyDetail({ ...emptyDetails(), email: "a@b.com" }), true);
  assert.equal(hasAnyDetail(null), false);
});

test("the assistant's brief carries the saved details exactly — and then an address question is answered, not deferred", () => {
  const profile = { what_they_do: "ISO consultancy", business_details: { address: "B21-057, SRTI Park, Sharjah, UAE", phone: "+971 4 345 6789", whatsapp: null, email: "info@wca-global.com", hours: "Sunday to Thursday, 9:00 AM – 6:00 PM", registration: "Trade licence no. 1234567" } };
  const brief = buildBusinessBrief(profile, { name: "x", website_url: "https://wca-global.com" });
  assert.match(brief, /Contact details \(you may give these exactly as written\)/);
  assert.match(brief, /- Address: B21-057, SRTI Park, Sharjah, UAE/);
  assert.match(brief, /- Phone: \+971 4 345 6789/);
  assert.match(brief, /- Email: info@wca-global\.com/);
  assert.match(brief, /- Working hours: Sunday to Thursday/);
  assert.match(brief, /- Licence \/ registration: Trade licence no\. 1234567/);
  assert.ok(!brief.includes("WhatsApp:"), "a detail that is null is left out");
  // with the details in the facts, none of the 'we do not hold this' nets fire
  for (const q of ["what is your office address", "aapka phone number do", "what are your working hours?", "do you have a trade licence?", "send me your email"]) assert.deepEqual(missingDetails(q, brief), [], q);
  // without them, the same questions ARE flagged
  const bare = buildBusinessBrief({ what_they_do: "ISO consultancy" }, { name: "x", website_url: null });
  assert.deepEqual(missingDetails("what is your office address", bare), ["our office address"]);
  assert.ok(!bare.includes("Contact details"));
});

test("Site Brain prompt block lists the details for every agent, and an empty profile prints nothing about them", () => {
  const p: any = { ...emptyProfile(), business_details: { address: "B21-057, SRTI Park, Sharjah, UAE", phone: null, whatsapp: null, email: "info@wca-global.com", hours: null, registration: null } };
  const block = profileBlock(p);
  assert.match(block, /CONTACT & BUSINESS DETAILS/);
  assert.match(block, /- Address: B21-057, SRTI Park, Sharjah, UAE/);
  assert.match(block, /- Email: info@wca-global\.com/);
  assert.ok(!block.includes("Phone:"));
  assert.ok(!profileBlock(emptyProfile()).includes("CONTACT & BUSINESS DETAILS"));
});
