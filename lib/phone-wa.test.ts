/** Run: npx tsx --test lib/phone-wa.test.ts
 *
 *  Turning a lead's local phone number into something WhatsApp can be asked about. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseNumber, countryIso } from "./phone-wa";

test("country names (and the short forms Maps uses) become ISO codes", () => {
  assert.equal(countryIso("United Arab Emirates"), "AE");
  assert.equal(countryIso("UAE"), "AE");
  assert.equal(countryIso("United States"), "US");
  assert.equal(countryIso("USA"), "US");
  assert.equal(countryIso("United Kingdom"), "GB");
  assert.equal(countryIso("UK"), "GB");
  assert.equal(countryIso("Pakistan"), "PK");
  assert.equal(countryIso("india"), "IN");
  assert.equal(countryIso("ae"), "AE");
  assert.equal(countryIso("Atlantis"), undefined);
  assert.equal(countryIso(""), undefined);
  assert.equal(countryIso(null), undefined);
});

test("a local number plus the lead's country becomes full international digits", () => {
  assert.equal(analyseNumber("0501234567", "United Arab Emirates").digits, "971501234567");
  assert.equal(analyseNumber("0300 1112223", "Pakistan").digits, "923001112223");
  assert.equal(analyseNumber("98765 43210", "India").digits, "919876543210");
  assert.equal(analyseNumber("+971 50 987 6543", null).digits, "971509876543");
  assert.equal(analyseNumber("00971509876543", null).digits, "971509876543");
});

test("no country and no plus means we cannot tell: never a guess", () => {
  assert.equal(analyseNumber("0501234567", null).digits, null);
  assert.equal(analyseNumber("0501234567", "Atlantis").digits, null);
  assert.equal(analyseNumber("", "Pakistan").digits, null);
  assert.equal(analyseNumber(null, "Pakistan").digits, null);
  assert.equal(analyseNumber("not a number", "Pakistan").digits, null);
  assert.equal(analyseNumber("12345", "Pakistan").digits, null); // too short to be a real number
});

test("toll-free and premium lines can never be on WhatsApp; ordinary lines are left for WhatsApp to answer", () => {
  const tollFree = analyseNumber("(800) 259-1264", "United States");
  assert.equal(tollFree.type, "TOLL_FREE");
  assert.equal(tollFree.neverOnWhatsApp, true);

  const mobile = analyseNumber("0501234567", "United Arab Emirates");
  assert.equal(mobile.type, "MOBILE");
  assert.equal(mobile.neverOnWhatsApp, false);

  // a landline is not decided here: some businesses do run WhatsApp Business on one
  const landline = analyseNumber("04 396 5888", "United Arab Emirates");
  assert.equal(landline.neverOnWhatsApp, false);
  assert.ok(landline.digits?.startsWith("9714"), "a Dubai landline keeps its full international digits");

  assert.equal(analyseNumber("+44 20 7946 0958", null).neverOnWhatsApp, false);
});

// ── planWaCheck / applyWaResults ───────────────────────────────────────────────────────────
import { planWaCheck, applyWaResults, type LeadWaRow } from "./phone-wa";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-11T10:00:00Z");
const row = (o: Partial<LeadWaRow> & { id: string }): LeadWaRow => ({ phone: null, whatsapp: null, country: null, wa_status: null, wa_checked_at: null, ...o });

test("planWaCheck: the evidence order (own wa.me link, stored answer, toll-free, then ask WhatsApp)", () => {
  const rows = [
    row({ id: "site", phone: "0501234567", country: "United Arab Emirates", whatsapp: "971501234567" }),
    row({ id: "stored-yes", phone: "0501111111", country: "United Arab Emirates", wa_status: "yes", wa_checked_at: new Date(NOW - 400 * DAY).toISOString() }),
    row({ id: "stored-no-fresh", phone: "0502222222", country: "United Arab Emirates", wa_status: "no", wa_checked_at: new Date(NOW - 5 * DAY).toISOString() }),
    row({ id: "stored-no-stale", phone: "0503333333", country: "United Arab Emirates", wa_status: "no", wa_checked_at: new Date(NOW - 45 * DAY).toISOString() }),
    row({ id: "tollfree", phone: "(800) 259-1264", country: "United States" }),
    row({ id: "ask", phone: "0300 1112223", country: "Pakistan" }),
    row({ id: "no-country", phone: "0501234567" }),
    row({ id: "no-number" }),
  ];
  const p = planWaCheck(rows, { stored: true, now: NOW });
  assert.deepEqual(p.statuses, { site: "yes", "stored-yes": "yes", "stored-no-fresh": "no", "stored-no-stale": null, tollfree: "no", ask: null, "no-country": null, "no-number": null });
  assert.deepEqual(p.toStore, { tollfree: "no" });
  assert.deepEqual(Array.from(p.ask.entries()), [["971503333333", ["stored-no-stale"]], ["923001112223", ["ask"]]]);
});

test("planWaCheck: a toll-free number is a firm no without WhatsApp being asked or connected", () => {
  const p = planWaCheck([row({ id: "a", phone: "1800 123 456", country: "Australia" })], { stored: true, now: NOW });
  assert.equal(p.statuses.a, "no");
  assert.equal(p.ask.size, 0);
});

test("planWaCheck: without migration 038 nothing stored is reused", () => {
  const p = planWaCheck([row({ id: "a", phone: "0501234567", country: "United Arab Emirates", wa_status: "no", wa_checked_at: new Date(NOW).toISOString() })], { stored: false, now: NOW });
  assert.equal(p.statuses.a, null);
  assert.equal(p.ask.size, 1);
});

test("applyWaResults: WhatsApp's yes / no are kept and stored; 'could not tell' leaves the lead unknown", () => {
  const rows = [row({ id: "a", phone: "0501234567", country: "United Arab Emirates" }), row({ id: "b", phone: "0300 1112223", country: "Pakistan" }), row({ id: "c", phone: "98765 43210", country: "India" })];
  const plan = planWaCheck(rows, { stored: true, now: NOW });
  const done = applyWaResults(plan, { "971501234567": true, "923001112223": false, "919876543210": null });
  assert.deepEqual(done.statuses, { a: "yes", b: "no", c: null });
  assert.deepEqual(done.toStore, { a: "yes", b: "no" });
  // WhatsApp not connected at all: every answer is null, so nothing changes and nothing is stored
  const off = applyWaResults(plan, {});
  assert.deepEqual(off.statuses, { a: null, b: null, c: null });
  assert.deepEqual(off.toStore, {});
});
