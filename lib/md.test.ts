/** Run: npx tsx --test lib/md.test.ts
 *
 *  TABLES, mainly. agent-server/src/lib/qualityGate.ts BLOCKS any article that does not contain a
 *  real markdown table — and until 2026-09-18 this renderer had no table branch at all, so every
 *  one of those required tables reached the reader as a paragraph full of pipe characters. The
 *  rule was enforced on the way in and discarded on the way out, on both the live writer canvas
 *  and the reading view.
 *
 *  The "must NOT become a table" cases matter just as much: prose legitimately contains "|", and
 *  a renderer that greedily swallows any line with a pipe would eat real sentences.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./md";

const TABLE = ["| Business Size | Fee (AED) |", "| --- | --- |", "| Micro firm | 5,000 - 7,000 |", "| Small firm | 7,000 - 10,000 |"].join("\n");

test("a pipe table becomes a real table, with the header in <th>", () => {
  const html = renderMarkdown(TABLE);
  assert.match(html, /<table/);
  assert.match(html, /<thead><tr><th[^>]*>Business Size<\/th><th[^>]*>Fee \(AED\)<\/th><\/tr><\/thead>/);
  assert.match(html, /<td[^>]*>Micro firm<\/td>/);
  assert.match(html, /<td[^>]*>5,000 - 7,000<\/td>/);
  assert.ok(!html.includes("<p>| Business Size"), "the old behaviour: the whole table as one paragraph");
});

test("the divider row is structure and never appears as content", () => {
  const html = renderMarkdown(TABLE);
  assert.ok(!/---/.test(html.replace(/<[^>]+>/g, "")), "no dashes leak into any cell");
  assert.equal((html.match(/<tr>/g) || []).length, 3, "one header row plus two body rows");
});

test("a table is closed by a blank line and prose after it stays prose", () => {
  const html = renderMarkdown(`${TABLE}\n\nChoosing a body balances budget with recognition.`);
  assert.match(html, /<\/table>/);
  assert.match(html, /<p>Choosing a body balances budget with recognition\.<\/p>/);
});

test("a table is closed by the next heading too", () => {
  const html = renderMarkdown(`${TABLE}\n## What comes next?`);
  assert.match(html, /<\/table>\s*<h2>What comes next\?<\/h2>/);
});

test("prose containing a pipe is NOT turned into a table", () => {
  // No divider line, so this is a sentence, not a header.
  const html = renderMarkdown("Costs vary | sometimes a lot | depending on scope.");
  assert.ok(!html.includes("<table"), "a pipe in a sentence must stay in the sentence");
  assert.match(html, /<p>Costs vary \| sometimes a lot \| depending on scope\.<\/p>/);
});

test("outer pipes are optional", () => {
  const html = renderMarkdown("Size | Fee\n--- | ---\nMicro | 5000");
  assert.match(html, /<th[^>]*>Size<\/th>/);
  assert.match(html, /<td[^>]*>Micro<\/td>/);
});

test("cell text still gets inline markdown, and is escaped", () => {
  const html = renderMarkdown("| Item | Note |\n| --- | --- |\n| **Bold** | <script>x</script> |");
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.ok(!html.includes("<script>"), "a cell cannot inject markup");
  assert.match(html, /&lt;script&gt;/);
});

/* ── the other structures the article rules require ──────────────────────────────────────── */

test("lists, headings and images all render", () => {
  const html = renderMarkdown(
    ["## How do I prepare?", "", "- Turn off the stopcock", "- Move the rugs", "- Photograph the damage", "", "![hero](https://example.com/a.png)"].join("\n"),
  );
  assert.match(html, /<h2>How do I prepare\?<\/h2>/);
  assert.match(html, /<ul><li>Turn off the stopcock<\/li><li>Move the rugs<\/li><li>Photograph the damage<\/li><\/ul>/);
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png"/);
});

test("a numbered list stays ordered", () => {
  const html = renderMarkdown("1. Leverage existing documentation\n2. Phase the implementation");
  assert.match(html, /<ol><li>Leverage existing documentation<\/li><li>Phase the implementation<\/li><\/ol>/);
});

test("Mr. Image's embed markers stay invisible", () => {
  const html = renderMarkdown("<!-- image:hero -->\n![hero](https://example.com/a.png)\n<!-- /image:hero -->");
  assert.ok(!html.includes("image:hero"), "the marker is plumbing, not content");
  assert.match(html, /<img /);
});
