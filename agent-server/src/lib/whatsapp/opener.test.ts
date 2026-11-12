/** Run: npx tsx --test src/lib/whatsapp/opener.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadDialDigits } from "./phone.js";
import { usableDraft, closing } from "./opener.js";
import { OPT_OUT_PHRASE } from "../leads/compliance.js";

test("a local number plus the lead's country is dialled internationally (the old code sent the local digits)", () => {
  assert.deepEqual(leadDialDigits({ phone: "0501234567", country: "United Arab Emirates" }), { ok: true, digits: "971501234567" });
  assert.deepEqual(leadDialDigits({ phone: "0300 1112223", country: "Pakistan" }), { ok: true, digits: "923001112223" });
  assert.deepEqual(leadDialDigits({ phone: "+971 50 987 6543" }), { ok: true, digits: "971509876543" });
});

test("a number published on the lead's own wa.me link wins and is used as-is", () => {
  assert.deepEqual(leadDialDigits({ whatsapp: "+971 50 111 2222", phone: "04 000 0000", country: "United Arab Emirates" }), { ok: true, digits: "971501112222" });
});

test("no guessing: no country, junk, or a toll-free line is left alone", () => {
  assert.deepEqual(leadDialDigits({ phone: "0501234567" }), { ok: false, reason: "unknown country or invalid number" });
  assert.deepEqual(leadDialDigits({ phone: "12345", country: "Pakistan" }), { ok: false, reason: "unknown country or invalid number" });
  assert.deepEqual(leadDialDigits({ phone: "(800) 259-1264", country: "United States" }), { ok: false, reason: "toll-free or premium line" });
  assert.deepEqual(leadDialDigits({}), { ok: false, reason: "no number" });
});

test("usableDraft: only a short, non-email message that carries a working opt-out is sent as written", () => {
  const good = `Hi, this is Acme. We help Dubai firms with ISO 9001.\n\n${closing("Acme", "https://acme.ae")}`;
  assert.equal(usableDraft(good), good);
  assert.equal(usableDraft(null), null);
  assert.equal(usableDraft("Hi, this is Acme."), null, "no opt-out → never sent");
  assert.equal(usableDraft(`Subject: Hello\n\nHi ${closing("Acme", null)}`), null, "an email is not a WhatsApp message");
  assert.equal(usableDraft(`Dear Sir, ${closing("Acme", null)}`), null);
  assert.equal(usableDraft("x".repeat(800) + OPT_OUT_PHRASE), null, "too long for a phone");
});

test("closing: sender, site and the opt-out line are built in code", () => {
  const c = closing("Acme Safety", "https://acme.ae");
  assert.ok(c.startsWith("— Acme Safety\nhttps://acme.ae\n"));
  assert.ok(c.includes(OPT_OUT_PHRASE));
  assert.ok(!closing("Acme", null).includes("http"));
});

// ── brand: the website, not the account username ───────────────────────────────────────────
import { hostOf, brandName, applyBrand } from "./brand.js";
import { shortenDraft, prepareDraft } from "./opener.js";

test("hostOf / brandName: a business is its website; the workspace name is only the fallback", () => {
  assert.equal(hostOf("https://www.wca-global.com/about?x=1"), "wca-global.com");
  assert.equal(hostOf("wca-global.com"), "wca-global.com");
  assert.equal(hostOf("not a url"), null);
  assert.equal(hostOf(""), null);
  assert.equal(brandName({ name: "heysamiul09", website_url: "https://wca-global.com" }), "wca-global.com");
  assert.equal(brandName({ name: "Acme Safety", website_url: null }), "Acme Safety");
  assert.equal(brandName(null), "our team");
});

test("applyBrand: an old draft that says 'from heysamiul09' now says the website, without repeating the address", () => {
  const tenant = { name: "heysamiul09", website_url: "https://wca-global.com" };
  const old = "Hi, This is Sami from heysamiul09. We provide ISO certification.\n\n— heysamiul09\nhttps://wca-global.com\nIf you would rather not hear from me, reply with the word STOP and I will not write again.";
  const out = applyBrand(old, tenant);
  assert.match(out, /This is Sami from wca-global\.com\./);
  assert.ok(!/heysamiul09/.test(out));
  assert.equal(out.split("wca-global.com").length - 1, 2, "once in the greeting, once in the signature: the address line is gone");
  assert.match(out, /— wca-global\.com\nIf you would rather not hear from me/);
  // a name that merely CONTAINS the old one is left alone
  assert.equal(applyBrand("heysamiul09x is another company", tenant), "heysamiul09x is another company");
});

test("shortenDraft: a draft a few lines too long is cut to its opening and closing question, signature untouched", () => {
  const sig = "— wca-global.com\nIf you would rather not hear from me, reply with the word STOP and I will not write again.";
  const longBody = "Hi, this is Sami from wca-global.com. We provide ISO 13485 certification for medical device makers across the UAE. " + "Our services also include ISO 9001, ISO 14001, ISO 45001 and ISO 22000 certification for manufacturers of every size. ".repeat(4) + "Are you supporting clients who need ISO 13485?";
  const draft = `${longBody}\n\n${sig}`;
  assert.ok(draft.length > 700, "test setup: it is over the limit");
  assert.equal(usableDraft(draft), null);
  const short = shortenDraft(draft)!;
  assert.ok(short.length <= 700);
  assert.ok(short.startsWith("Hi, this is Sami from wca-global.com."));
  assert.ok(short.includes("Are you supporting clients who need ISO 13485?"), "the closing question is kept");
  assert.ok(short.endsWith(sig), "signature and opt-out are exactly as written");
  assert.equal(shortenDraft("Hi there, long text but no signature and no opt-out ".repeat(30)), null, "never sends one without a working opt-out");
  assert.equal(shortenDraft(`Subject: Hi\n\n${longBody}\n\n${sig}`), null, "an email is not a WhatsApp message");
});

test("prepareDraft: brand + shorten in one step", () => {
  const tenant = { name: "heysamiul09", website_url: "https://wca-global.com" };
  const d = "Hi, this is Sami from heysamiul09. Would a one-page outline help?\n\n— heysamiul09\nhttps://wca-global.com\nIf you would rather not hear from me, reply with the word STOP and I will not write again.";
  const out = prepareDraft(d, tenant)!;
  assert.ok(out.includes("from wca-global.com.") && !out.includes("heysamiul09"));
  assert.equal(prepareDraft(null, tenant), null);
});
