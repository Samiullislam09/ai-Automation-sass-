import test from "node:test";
import assert from "node:assert/strict";
import { feedResearchOutput } from "./gptResearcher.js";

test("one complete line in one chunk is parsed and handed to onLine", () => {
  const seen: any[] = [];
  const rest = feedResearchOutput("", '{"progress":{"note":"x"}}\n', (raw, parsed) => seen.push({ raw, parsed }));
  assert.equal(rest, "");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].parsed, { progress: { note: "x" } });
});

test("multiple lines in one chunk all fire, in order", () => {
  const seen: any[] = [];
  feedResearchOutput("", '{"progress":1}\n{"progress":2}\n{"ok":true,"context":"c","sources":[]}\n', (_raw, parsed) => seen.push(parsed));
  assert.deepEqual(
    seen.map((p) => p.progress ?? p.ok),
    [1, 2, true]
  );
});

test("a line split across two chunks is carried and only fires once complete", () => {
  const seen: any[] = [];
  const rest1 = feedResearchOutput("", '{"progress":{"note":"hel', (_raw, parsed) => seen.push(parsed));
  assert.equal(seen.length, 0, "nothing fires on a partial line");
  const rest2 = feedResearchOutput(rest1, 'lo"}}\n', (_raw, parsed) => seen.push(parsed));
  assert.equal(rest2, "");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { progress: { note: "hello" } });
});

test("a non-JSON line (a stray dependency print, say) is silently skipped, never thrown", () => {
  const seen: any[] = [];
  assert.doesNotThrow(() => {
    feedResearchOutput("", 'Warning: some noisy library print\n{"ok":true,"context":"","sources":[]}\n', (_raw, parsed) => seen.push(parsed));
  });
  assert.equal(seen.length, 1, "only the real JSON line reached onLine");
});

test("blank lines between real lines are ignored", () => {
  const seen: any[] = [];
  feedResearchOutput("", '{"progress":1}\n\n\n{"progress":2}\n', (_raw, parsed) => seen.push(parsed));
  assert.equal(seen.length, 2);
});

test("the trailing partial line (no newline yet) is returned as carry, not fired", () => {
  const seen: any[] = [];
  const rest = feedResearchOutput("", '{"progress":1}\n{"ok":true', (_raw, parsed) => seen.push(parsed));
  assert.equal(seen.length, 1);
  assert.equal(rest, '{"ok":true');
});

test("raw text handed to onLine is the trimmed original line, not a re-serialised copy", () => {
  let raw = "";
  feedResearchOutput("", '  {"ok":  true, "context":"c","sources":[]}  \n', (r) => (raw = r));
  assert.equal(raw, '{"ok":  true, "context":"c","sources":[]}');
});
