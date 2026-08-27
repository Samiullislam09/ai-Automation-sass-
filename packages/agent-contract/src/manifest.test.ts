import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, validateAgainstSchema, type FieldSchema } from "./manifest.js";

import { sampleManifest } from "./sample.fixture.js";

const clone = () => JSON.parse(JSON.stringify(sampleManifest)) as typeof sampleManifest;

test("valid sample manifest passes and provides defaults to action id", () => {
  const r = validateManifest(sampleManifest);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.manifest.actions[0].provides, "write_article");
  assert.deepEqual(r.manifest.actions[0].needs, ["keywords"]);
  assert.equal(r.manifest.office.color, "#b48bff");
});

test("invalid: non-object", () => {
  const r = validateManifest("nope");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.errors, ["manifest must be an object"]);
});

test("invalid: bad semver version", () => {
  const m = clone();
  m.version = "1.2";
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => e === 'version "1.2" must be semver (e.g. 1.2.0)'), r.errors.join("\n"));
});

test("invalid: estimated_seconds not a positive integer", () => {
  const m = clone();
  (m.actions[0] as { estimated_seconds: unknown }).estimated_seconds = 0;
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.includes("actions[0].estimated_seconds must be a positive integer"), r.errors.join("\n"));
});

test("invalid: unknown input field type", () => {
  const m = clone();
  (m.actions[0].input as Record<string, string>).topic = "text";
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => e.startsWith('actions[0].input.topic has unknown type "text"')), r.errors.join("\n"));
});

test("invalid: empty phrases + missing irreversible", () => {
  const m = clone();
  m.actions[0].phrases = [];
  delete (m.actions[0] as { irreversible?: boolean }).irreversible;
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.includes("actions[0].phrases must contain at least one phrase"));
  assert.ok(r.errors.includes("actions[0].irreversible must be a boolean"));
});

test("invalid: duplicate action ids", () => {
  const m = clone();
  m.actions.push(JSON.parse(JSON.stringify(m.actions[0])));
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.includes('actions[1].id "write_article" is duplicated'));
});

test("invalid: office missing / bad colour, multiple errors reported at once", () => {
  const m = clone();
  m.office.color = "purple";
  (m as { name: unknown }).name = "";
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.includes("name must be a non-empty string"));
  assert.ok(r.errors.includes('office.color "purple" must be a hex colour like #b48bff'));
  assert.equal(r.errors.length, 2);
});

test("validateAgainstSchema handles optional, arrays and objects", () => {
  const schema = sampleManifest.actions[0].input as unknown as FieldSchema;
  assert.deepEqual(validateAgainstSchema(schema, { topic: "solar", keywords: ["a"] }), []);
  assert.deepEqual(validateAgainstSchema(schema, { keywords: "a" }), [
    "input.topic is required (string)",
    "input.keywords must be string[]",
  ]);
  assert.deepEqual(validateAgainstSchema(schema, { topic: "x", keywords: [1] }), ["input.keywords must contain only string"]);
  assert.deepEqual(validateAgainstSchema({ meta: "object" }, { meta: [] }, "output"), ["output.meta must be object"]);
});
