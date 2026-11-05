import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLongParagraphs } from "./articleLayout.js";

const sent = (n: number) => `Sentence number ${n} says something specific about the topic here.`;
const para = (n: number) => Array.from({ length: n }, (_, i) => sent(i + 1)).join(" ");

test("a 12-sentence paragraph is split into short paragraphs, nothing lost or reordered", () => {
  const body = `## Heading\n\n${para(12)}`;
  const out = splitLongParagraphs(body);
  const paras = out.split("\n\n").slice(1);
  assert.ok(paras.length >= 4);
  for (const p of paras) assert.ok(p.split(/(?<=\.)\s/).length <= 3, p);
  assert.equal(out.replace(/\s+/g, " "), body.replace(/\s+/g, " "));
});

test("headings, lists, tables and images are left untouched", () => {
  const body = ["## H", "- a\n- b\n- c", "| a | b |\n|---|---|\n| 1 | 2 |", "![alt](https://x/y.png)", "Short one."].join("\n\n");
  assert.equal(splitLongParagraphs(body), body);
});

test("the first paragraph under an H2 stays inside the 58-word snippet window", () => {
  const out = splitLongParagraphs(`## Q\n\n${para(10)}`);
  const first = out.split("\n\n")[1];
  assert.ok(first.split(/\s+/).length <= 58, first);
});

test("abbreviations do not create a split", () => {
  const body = "## H\n\nWe offer ISO, e.g. 9001 and 14001. Costs vary.";
  assert.equal(splitLongParagraphs(body), body);
});
