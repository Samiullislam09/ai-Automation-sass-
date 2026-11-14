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
