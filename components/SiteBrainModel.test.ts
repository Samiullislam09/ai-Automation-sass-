/** Run: npx tsx --test components/SiteBrainModel.test.ts  — the "Your name" Site Brain field. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceField, PROFILE_FIELDS, USER_ONLY_FIELDS, FRIENDLY_LABEL, FIELD_GROUPS, emptyProfile, normalizeProfile, previewOf } from "./SiteBrainModel";

test("owner_name is a Site Brain field the owner fills in, listed and labelled like the rest", () => {
  assert.ok((PROFILE_FIELDS as readonly string[]).includes("owner_name"));
  assert.ok(USER_ONLY_FIELDS.includes("owner_name" as any), "nobody can read it off a website");
  assert.equal(FRIENDLY_LABEL.owner_name, "Your name");
  assert.ok(FIELD_GROUPS.some((g) => g.fields.some((f) => f.field === "owner_name")), "it has a place on the page");
  assert.equal(emptyProfile().owner_name, null);
  assert.equal(normalizeProfile({ owner_name: "Samiul" }).owner_name, "Samiul");
  assert.equal(normalizeProfile({}).owner_name, null, "an older profile without it is fine");
  assert.equal(previewOf({ ...emptyProfile(), owner_name: "Samiul" }, "owner_name" as any), "Samiul");
});

test("coerceField(owner_name): a short plain name, nothing else", () => {
  assert.deepEqual(coerceField("owner_name" as any, "  Samiul   Islam "), { ok: true, value: "Samiul Islam" });
  assert.deepEqual(coerceField("owner_name" as any, ""), { ok: true, value: null });
  assert.deepEqual(coerceField("owner_name" as any, null), { ok: true, value: null });
  assert.equal(coerceField("owner_name" as any, "x".repeat(61)).ok, false);
  assert.equal(coerceField("owner_name" as any, "Sami https://evil.example").ok, false, "no links in a name that goes to strangers");
  assert.equal(coerceField("owner_name" as any, "sami@mail.com").ok, false);
  assert.equal(coerceField("owner_name" as any, "Sami\nSecond line").ok, false);
  assert.equal(coerceField("owner_name" as any, 42).ok, false);
});

import { isFieldEmpty } from "./SiteBrainModel";

test("business_details: a Site Brain field, listed, labelled, grouped and empty by default", () => {
  assert.ok((PROFILE_FIELDS as readonly string[]).includes("business_details"));
  assert.ok((PROFILE_FIELDS as readonly string[]).indexOf("business_details") === (PROFILE_FIELDS as readonly string[]).indexOf("pricing") + 1, "it sits next to pricing");
  assert.equal(FRIENDLY_LABEL.business_details, "How customers reach you");
  assert.ok(FIELD_GROUPS.some((g) => g.fields.some((f) => f.field === "business_details")), "it has a place on the page");
  assert.equal(emptyProfile().business_details, null);
  assert.equal(isFieldEmpty(emptyProfile(), "business_details"), true);
  assert.equal(normalizeProfile({}).business_details, null, "an older profile without it is fine");
});

test("coerceField(business_details): a clean object, or null when everything is blank", () => {
  const ok = coerceField("business_details" as any, { address: " Office 12, Al Majaz Tower, Sharjah ", phone: "+971 6 000 0000", whatsapp: "", email: "Info@Yourbusiness.com", hours: "Sun–Thu 9–6", registration: null });
  assert.equal(ok.ok, true);
  assert.deepEqual((ok as any).value, { address: "Office 12, Al Majaz Tower, Sharjah", phone: "+971 6 000 0000", whatsapp: null, email: "Info@Yourbusiness.com", hours: "Sun–Thu 9–6", registration: null });
  assert.deepEqual(coerceField("business_details" as any, { address: "", phone: "  ", email: null }), { ok: true, value: null });
  assert.deepEqual(coerceField("business_details" as any, null), { ok: true, value: null });
  assert.equal(coerceField("business_details" as any, "text").ok, false);
  assert.equal(coerceField("business_details" as any, ["x"]).ok, false);
  assert.equal(coerceField("business_details" as any, { email: "not an email" }).ok, false);
  assert.equal(coerceField("business_details" as any, { phone: "call me maybe" }).ok, false);
  assert.equal(coerceField("business_details" as any, { whatsapp: "12" }).ok, false, "too short to be a number");
  assert.equal(coerceField("business_details" as any, { address: "x".repeat(201) }).ok, false);
  assert.equal(coerceField("business_details" as any, { registration: "y".repeat(161) }).ok, false);
});

test("business_details: emptiness and the one-line preview", () => {
  const p: any = { ...emptyProfile(), business_details: { address: "B21-057, SRTI Park, Sharjah", phone: "+971 4 345 6789", whatsapp: null, email: "info@x.com", hours: null, registration: null } };
  assert.equal(isFieldEmpty(p, "business_details"), false);
  assert.equal(previewOf(p, "business_details" as any), "B21-057, SRTI Park, Sharjah · +971 4 345 6789 · info@x.com");
  assert.equal(isFieldEmpty({ ...emptyProfile(), business_details: { address: null, phone: null, whatsapp: null, email: null, hours: null, registration: null } } as any, "business_details"), true);
});
