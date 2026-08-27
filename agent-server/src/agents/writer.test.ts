/** Run: cd agent-server && npx tsx --test src/agents/writer.test.ts
 *
 *  §25.5 — what a user is told when a duplicate stops an article. This is the whole visible
 *  surface of locks 1 and 3: the writer refuses, and this sentence is the refusal.
 *
 *  It is tested at the sentence level, on purpose. The verdict itself is dedupe.ts's job
 *  (already tested in dedupe.test.ts, and it needs a database); what CANNOT be allowed to
 *  regress is that the user is told which page already exists, where it is, and what their two
 *  options are — in the product's voice, not in an error code. */
import { test } from "node:test";
import assert from "node:assert/strict";

// writer.ts reaches supabase and pg-boss through its imports; env.ts throws without these.
// Nothing below opens a connection — only a pure string builder is called.
process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { duplicateSentence } = await import("./writer.js");
type DuplicateVerdict = import("../lib/dedupe.js").DuplicateVerdict;

test("a page that is already live: named, linked, and the choice handed back", () => {
  const verdict: DuplicateVerdict = {
    status: "exists",
    where: "site_pages",
    url: "https://x.test/iso-9001-cost",
    item_id: null,
    title: "ISO 9001 Cost in India",
    slug: "iso-9001-cost-in-india",
  };
  const said = duplicateSentence(verdict);

  // The three things this sentence has to do.
  assert.match(said, /"ISO 9001 Cost in India"/, "it must name the page");
  assert.match(said, /https:\/\/x\.test\/iso-9001-cost/, "it must give the URL, so it is one click away");
  assert.match(said, /Maine dobara nahi likha/, "it must say plainly that nothing was written");
  assert.match(said, /aapki website par pehle se maujood hai/);
  // And the choice, which is the point — not a dead end.
  assert.match(said, /usi page ko update karwao, ya isi topic ka koi naya angle chuno/);
  // The update mode is Phase 2. Saying "I'll update it" here would be a promise nothing keeps.
  assert.ok(!/main update kar deta|abhi update kar/i.test(said));
});

test("a draft we wrote earlier reads differently from a page that was already on the site", () => {
  const ours = duplicateSentence({
    status: "exists",
    where: "content_items",
    url: null,
    item_id: "abc-123",
    title: "ISO 27001 Gap Audit",
    slug: "iso-27001-gap-audit",
  });
  assert.match(ours, /aapke content me pehle se maujood hai/);
  assert.match(ours, /"ISO 27001 Gap Audit"/);
  // No URL on file means no URL in the sentence — never a placeholder, never an invented link.
  assert.ok(!ours.includes("http"), ours);
  assert.ok(!/null|undefined/.test(ours), ours);
});

test("an untitled match falls back to the slug rather than to a blank", () => {
  const said = duplicateSentence({
    status: "exists",
    where: "site_pages",
    url: "https://x.test/iso-9001-cost",
    item_id: null,
    title: null,
    slug: "iso-9001-cost",
  });
  assert.match(said, /"iso-9001-cost"/);
  assert.ok(!/""/.test(said), said);
});

test("already running: it says so, and says which job, instead of starting a second one", () => {
  const said = duplicateSentence({
    status: "in_progress",
    task_id: "job-77",
    source: "jobs_log",
    label: 'Researching "ISO 9001 cost"',
  });
  assert.match(said, /Ye topic abhi likha ja raha hai/);
  assert.match(said, /Researching "ISO 9001 cost"/, "it must name the work that is already happening");
  assert.match(said, /job-77/, "and identify it, so it can be found");
  assert.match(said, /Maine dobara shuru nahi kiya/);
});

test("an in-flight job with no label still produces a sentence, not a gap", () => {
  const said = duplicateSentence({ status: "in_progress", task_id: "task-9", source: "tasks", label: null });
  assert.match(said, /ek job already chal raha hai/);
  assert.match(said, /task task-9/);
  assert.ok(!/null|undefined|""/.test(said), said);
});

test('"free" says nothing — it is not a verdict the user ever sees', () => {
  assert.equal(duplicateSentence({ status: "free" }), "");
});

test("every duplicate verdict produces one plain sentence a person can act on", () => {
  const verdicts: DuplicateVerdict[] = [
    { status: "exists", where: "site_pages", url: "https://x.test/a", item_id: null, title: "A", slug: "a" },
    { status: "exists", where: "content_items", url: null, item_id: "1", title: null, slug: "b" },
    { status: "in_progress", task_id: "t1", source: "tasks", label: "Writing" },
    { status: "in_progress", task_id: "t2", source: "jobs_log", label: null },
  ];
  for (const v of verdicts) {
    const said = duplicateSentence(v);
    assert.ok(said.length > 40, `too short to be useful: ${said}`);
    assert.ok(!said.includes("\n"), `not one paragraph: ${said}`);
    // No internals leak into a customer-facing line.
    assert.ok(!/content_items|site_pages|jobs_log|slugify|verdict/.test(said), said);
  }
});
