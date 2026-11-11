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
