/** The read tools: their shape, and the two things their result block must never let happen.
 *
 *  These are unit tests, so they assert the CONTRACT, not the model's judgement. The judgement
 *  was checked against the live model and the live database on 2026-09-19 and is recorded here
 *  so the next person does not have to re-run it to know what was true:
 *
 *      "mere website pe abhi tak kitne post ha" → lookup_content      → "55 posts… 14 awaiting"
 *      "pura details do yar"                    → lookup_business_profile → the real offerings
 *      "abhi koi issue ha site pe"              → lookup_site_audit   → "53/100 … 48 broken links"
 *      "site pe kitne active user ha"           → lookup_analytics    → "Google connect nahi hua"
 *      "hamari site pe ISO 27001 ka kya"        → lookup_site_pages   → 8 real pages
 *      "naya article likho ISO 9001 pe"         → write_article       (not hijacked)
 *      "site audit phir se karo"                → audit_site          (not hijacked)
 *
 *  That last row is the one these tests exist for. On the first run it chose lookup_site_audit
 *  and the model then replied "Site audit dobara chala diya" — it announced work that had not
 *  run. The description now says so, and `toolResultBlock` says so again on every single call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READ_TOOLS,
  READ_PREFIX,
  isReadTool,
  toolResultBlock,
  LOOKUP_ANALYTICS,
  LOOKUP_AUDIT,
  LOOKUP_CONTENT,
} from "./chat-data-tools";

test("every read tool is named like one, so isReadTool never needs the list", () => {
  assert.ok(READ_TOOLS.length >= 6);
  for (const t of READ_TOOLS) {
    assert.ok(t.function.name.startsWith(READ_PREFIX), `${t.function.name} is not prefixed`);
    assert.equal(isReadTool(t.function.name), true);
  }
});

test("an agent action is never mistaken for a read", () => {
  for (const name of ["write_article", "audit_site", "find_keywords", "publish_article", "answer_question"]) {
    assert.equal(isReadTool(name), false, `${name} must not look like a lookup`);
  }
  assert.equal(isReadTool(null), false);
  assert.equal(isReadTool(undefined), false);
  assert.equal(isReadTool(""), false);
});

test("every tool carries a schema a model can fill, and none of them require anything", () => {
  // A required argument on a lookup is a question the model has to ask the customer before it
  // can answer theirs. None of these need one — the tenant comes from the session, not the model.
  for (const t of READ_TOOLS) {
    assert.equal(t.type, "function");
    assert.equal(t.function.parameters.type, "object");
    assert.deepEqual(t.function.parameters.required, []);
    assert.equal(t.function.parameters.additionalProperties, false);
    assert.ok(t.function.description.length > 80, `${t.function.name} needs a description a model can match against`);
  }
});

test("descriptions carry the customer's own Hinglish, not only English", () => {
  // "kitne post ha" matches nothing English-shaped. That gap is how these questions ended up
  // being answered from imagination instead of from a lookup.
  const blob = READ_TOOLS.map((t) => t.function.description).join(" ");
  for (const word of ["kitne", "kya", "hai"]) {
    assert.ok(blob.includes(word), `no tool description contains "${word}"`);
  }
});

test("EVERY lookup tells the model it is not the way to give an order", () => {
  // Measured 2026-09-19: with only per-tool wording, "isko publish kar do" — an explicit
  // publish instruction — chose lookup_content in two runs out of three, because that tool's
  // description contains the word "published". A lookup that swallows an order is worse than
  // one that is never called: the customer is told what exists and the work never happens.
  for (const t of READ_TOOLS) {
    assert.match(t.function.description, /THIS TOOL ONLY READS/, `${t.function.name} lost the order guard`);
    assert.match(t.function.description, /call the matching ACTION tool instead/, t.function.name);
  }
});

test("the audit lookup tells the model it is NOT the way to run an audit", () => {
  const d = READ_TOOLS.find((t) => t.function.name === LOOKUP_AUDIT)!.function.description;
  assert.match(d, /DO NOT call this when they are TELLING you to run/);
  assert.match(d, /starts nothing/);
});

test("a successful result hands over the data and forbids claiming work was done", () => {
  const block = toolResultBlock({ ok: true, tool: LOOKUP_CONTENT, data: { articles: { total: 55, published: 0 } } });
  assert.match(block, /55/);
  assert.match(block, /TOOL RESULT/);
  // The exact failure seen live: "Site audit dobara chala diya" after a pure read.
  assert.match(block, /only LOOKED THIS UP/);
  assert.match(block, /chala diya/);
  assert.match(block, /Never print a raw key = value/);
});

test("a failed result forbids substituting a number for the missing data", () => {
  const block = toolResultBlock({
    ok: false,
    tool: LOOKUP_ANALYTICS,
    note: "No analytics data is stored for this workspace",
  });
  assert.match(block, /did not return data/);
  assert.match(block, /Do NOT substitute a number, an estimate, or a zero/);
  // "no rows" must never be reported as "zero visitors" — a different and much worse claim.
  assert.ok(!/\b0 visitors\b/.test(block));
});

test("the analytics tool tells the model that no rows means not connected, not zero traffic", () => {
  const d = READ_TOOLS.find((t) => t.function.name === LOOKUP_ANALYTICS)!.function.description;
  assert.match(d, /If Google is not connected the tool says so/i);
  assert.match(d, /never a number/i);
});
