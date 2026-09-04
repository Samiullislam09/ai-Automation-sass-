import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, escapeControlCharsInStrings } from "./llm.js";

test("ordinary valid JSON parses on the first try, untouched", () => {
  const result = parseModelJson<{ queries: string[] }>('{"queries":["a","b"]}');
  assert.deepEqual(result, { queries: ["a", "b"] });
});

test("a literal raw newline inside a string value (the live 2026-09-04 bug) is repaired, not thrown", () => {
  // A model asked for ONLY JSON that still put a real newline inside a string instead of \n —
  // reproduced live: this threw "Bad control character in string literal" straight past every
  // caller and into a customer-visible task.reason.
  const raw = '{"summary":"first line\nsecond line"}';
  assert.doesNotThrow(() => parseModelJson(raw));
  const result = parseModelJson<{ summary: string }>(raw);
  assert.equal(result.summary, "first line\nsecond line");
});

test("a literal raw tab and carriage return inside a string are both repaired", () => {
  const raw = '{"a":"col1\tcol2","b":"line1\rline2"}';
  const result = parseModelJson<{ a: string; b: string }>(raw);
  assert.equal(result.a, "col1\tcol2");
  assert.equal(result.b, "line1\rline2");
});

test("genuinely broken JSON (not just a control character) still throws, with the model's own text attached", () => {
  assert.throws(() => parseModelJson("not json at all"), /model did not return valid JSON/);
  assert.throws(() => parseModelJson("not json at all"), /not json at all/);
});

test("a control character with no sane escape (a literal NUL) is dropped, not left to break parsing", () => {
  const raw = '{"a":"before\x00after"}';
  const result = parseModelJson<{ a: string }>(raw);
  assert.equal(result.a, "beforeafter");
});

test("escapeControlCharsInStrings: structural whitespace between tokens (outside any string) is left alone", () => {
  const prettyPrinted = '{\n  "a": "x",\n  "b": "y"\n}';
  // Real, valid JSON already — the repair must not corrupt it by escaping the newlines that
  // are legitimately formatting, not content.
  assert.equal(escapeControlCharsInStrings(prettyPrinted), prettyPrinted);
  assert.deepEqual(JSON.parse(escapeControlCharsInStrings(prettyPrinted)), { a: "x", b: "y" });
});

test("escapeControlCharsInStrings: an escaped quote inside a string does not end the string early", () => {
  // If \" were mistaken for a real closing quote, the control character right after it would
  // be treated as OUTSIDE a string (and left alone) instead of inside one (and escaped) — this
  // pins the escape-tracking so that regression can never sneak back in silently.
  const raw = '{"a":"she said \\"hi\\"\nand left"}';
  const result = parseModelJson<{ a: string }>(raw);
  assert.equal(result.a, 'she said "hi"\nand left');
});

test("multiple string values in one object are each repaired independently", () => {
  const raw = '{"first":"a\nb","second":"c\nd"}';
  const result = parseModelJson<{ first: string; second: string }>(raw);
  assert.equal(result.first, "a\nb");
  assert.equal(result.second, "c\nd");
});
