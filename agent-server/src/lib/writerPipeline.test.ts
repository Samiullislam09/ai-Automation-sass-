/** Run: cd agent-server && npx tsx --test src/lib/writerPipeline.test.ts
 *
 *  §16.3 Upgrade E's shape (outline → parallel sections → polish → meta), proven against a
 *  fake `complete` — no NVIDIA_API_KEY, no network, no 180s timeout. `nimComplete` (the real
 *  one) is exercised nowhere here; its job is one fetch call, already covered by the pattern
 *  every other agent-server HTTP helper uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { buildOutline, writeSection, polishArticle, writeMeta, writeArticlePipeline } = await import("./writerPipeline.js");

const TOPIC = "emergency plumber in Leeds";
const OUTLINE = {
  title: "Emergency Plumber in Leeds: What to Do in the First Hour",
  sections: [
    { h2: "What counts as a plumbing emergency", goal: "define urgency", keyword: "plumbing emergency", readerQuestion: "is this urgent?" },
    { h2: "What it costs", goal: "set price expectations", keyword: "emergency plumber cost", readerQuestion: "how much will this cost?" },
    { h2: "How to isolate the water", goal: "give a concrete action", keyword: "isolate water supply", readerQuestion: "what do I do right now?" },
    // Four, not three, since MIN_SECTIONS rose to 4 on 2026-08-31 — see its comment in
    // writerPipeline.ts for the 362-word article that forced it.
    { h2: "When to call a professional", goal: "set the escalation line", keyword: "call an emergency plumber", readerQuestion: "can I wait until morning?" },
  ],
};

/** A fake `complete` keyed by the step label the pipeline passes in — every test below states
 *  only the steps it cares about, so a test for `buildOutline` never has to also fake a
 *  section or a polish answer. */
function fakeComplete(byLabel: Record<string, (prompt: string) => string>) {
  const seen: { label: string; prompt: string }[] = [];
  const fn = async (prompt: string, opts?: { maxTokens?: number; label?: string }) => {
    const label = opts?.label ?? "?";
    seen.push({ label, prompt });
    const handler = byLabel[label];
    if (!handler) throw new Error(`fakeComplete: no handler for step "${label}"`);
    return handler(prompt);
  };
  return { fn, seen };
}

/* ---------------------------------------------------------------- outline ---------------- */

test("buildOutline parses a well-formed reply, code-fence and all", async () => {
  const { fn } = fakeComplete({
    "writer.outline": () => "```json\n" + JSON.stringify(OUTLINE) + "\n```",
  });
  const outline = await buildOutline(TOPIC, undefined, undefined, fn);
  assert.equal(outline.title, OUTLINE.title);
  assert.equal(outline.sections.length, 4);
  assert.equal(outline.sections[0].h2, "What counts as a plumbing emergency");
});

test("fewer than 3 usable sections is refused, not written thin", async () => {
  const { fn } = fakeComplete({
    "writer.outline": () => JSON.stringify({ title: "T", sections: [{ h2: "Only one" }] }),
  });
  await assert.rejects(() => buildOutline(TOPIC, undefined, undefined, fn), /only 1 usable section/);
});

test("garbage instead of JSON names the step that produced it", async () => {
  const { fn } = fakeComplete({ "writer.outline": () => "Sure, here is an outline: ..." });
  await assert.rejects(() => buildOutline(TOPIC, undefined, undefined, fn), /outline step did not return valid JSON/);
});

test("no title from the model falls back to the topic, never to an empty string", async () => {
  const { fn } = fakeComplete({
    "writer.outline": () => JSON.stringify({ sections: OUTLINE.sections }),
  });
  const outline = await buildOutline(TOPIC, undefined, undefined, fn);
  assert.equal(outline.title, TOPIC);
});

test("more than 6 sections from the model is capped, not passed through", async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ h2: `Section ${i}`, goal: "g", keyword: "k", readerQuestion: "q" }));
  const { fn } = fakeComplete({ "writer.outline": () => JSON.stringify({ title: "T", sections: many }) });
  const outline = await buildOutline(TOPIC, undefined, undefined, fn);
  assert.equal(outline.sections.length, 6);
});

test("research context reaches the outline prompt, with an explicit no-facts-from-here instruction", async () => {
  const { fn, seen } = fakeComplete({ "writer.outline": () => JSON.stringify(OUTLINE) });
  const research = { context: "Open web says emergency plumbers typically respond within 60 minutes.", sources: [{ url: "https://x.test", title: "Plumbing 101" }] };
  await buildOutline(TOPIC, undefined, undefined, fn, research);
  assert.match(seen[0].prompt, /60 minutes/);
  assert.match(seen[0].prompt, /do NOT copy any fact.*into the outline/i);
});

test("no research given is the normal case — outline still builds, no research section in the prompt", async () => {
  const { fn, seen } = fakeComplete({ "writer.outline": () => JSON.stringify(OUTLINE) });
  await buildOutline(TOPIC, undefined, undefined, fn);
  assert.doesNotMatch(seen[0].prompt, /WHAT THE OPEN WEB COVERS/);
});

/* ---------------------------------------------------------------- sections --------------- */

test("writeSection's prompt names only its own slot, never a sibling's", async () => {
  const { fn, seen } = fakeComplete({ "writer.section": () => "## What it costs\n\nSome real prose about cost." });
  const text = await writeSection(TOPIC, OUTLINE, OUTLINE.sections[1], undefined, fn);
  assert.match(text, /^## What it costs/);
  const prompt = seen[0].prompt;
  assert.match(prompt, /What it costs/);
  assert.doesNotMatch(prompt, /How to isolate the water/, "a section's prompt must not carry its sibling's heading");
});

test("a CTA is offered as a suggestion, not forced into every section's prompt", async () => {
  const { fn, seen } = fakeComplete({ "writer.section": () => "## X\n\ntext" });
  await writeSection(TOPIC, OUTLINE, OUTLINE.sections[0], { cta: { name: "24/7 call-out", url: "https://x.test/call" } } as any, fn);
  assert.match(seen[0].prompt, /24\/7 call-out/);
  assert.match(seen[0].prompt, /https:\/\/x\.test\/call/);
});

test("with no CTA on file, the prompt does not invent one to mention", async () => {
  const { fn, seen } = fakeComplete({ "writer.section": () => "## X\n\ntext" });
  await writeSection(TOPIC, OUTLINE, OUTLINE.sections[0], undefined, fn);
  assert.doesNotMatch(seen[0].prompt, /call to action fits naturally/i);
});

/* ---------------------------------------------------------------- polish ----------------- */

test("polishArticle's draft carries every section, in order, and asks nothing to be dropped", async () => {
  const sections = OUTLINE.sections.map((s) => ({ h2: s.h2, text: `## ${s.h2}\n\nBody for ${s.h2}.`, words: 40 }));
  const { fn, seen } = fakeComplete({
    "writer.polish": () => `# ${OUTLINE.title}\n\nIntro.\n\n` + sections.map((s) => s.text).join("\n\n"),
  });
  const polished = await polishArticle(OUTLINE, TOPIC, sections, undefined, fn);
  assert.match(polished, new RegExp(`^# ${OUTLINE.title}`));
  for (const s of sections) assert.match(seen[0].prompt, new RegExp(s.h2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(seen[0].prompt, /every H2 below must still be present/);
});

/* ---------------------------------------------------------------- meta ------------------- */

test("writeMeta parses the four fields, and a bad slug from the model is cleaned up", async () => {
  const { fn } = fakeComplete({
    "writer.meta": () =>
      JSON.stringify({
        metaTitle: "Emergency Plumber Leeds | Fast 24/7 Call-Out",
        metaDescription: "Need an emergency plumber in Leeds tonight? Here's what to do in the first hour, and what it actually costs.",
        slug: "  Emergency Plumber IN Leeds!! ",
        jsonLd: '{"@type":"Article"}',
      }),
  });
  const meta = await writeMeta(OUTLINE, TOPIC, "body text", fn);
  assert.equal(meta.slug, "emergency-plumber-in-leeds");
  assert.match(meta.metaDescription, /first hour/);
});

test("a missing slug from the model is derived from the title, never left empty", async () => {
  const { fn } = fakeComplete({ "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D" }) });
  const meta = await writeMeta(OUTLINE, TOPIC, "body", fn);
  assert.ok(meta.slug.length > 0);
  assert.doesNotMatch(meta.slug, /[^a-z0-9-]/);
});

/* ---------------------------------------------------------------- author + date (jsonLd) --
 * lib/seoChecks.ts's E-E-A-T checks (2026-08-31) read `author`/`datePublished` off the
 * jsonLd string this produces — the model is asked NOT to fill either (see writeMeta's own
 * prompt), so these are stamped here from real data instead of trusted from the model's
 * guess. */

test("a real business name reaches jsonLd.author; datePublished/dateModified are always real, current timestamps", async () => {
  const { fn } = fakeComplete({
    "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: '{"@type":"Article","headline":"H"}' }),
  });
  const before = Date.now();
  const meta = await writeMeta(OUTLINE, TOPIC, "body", fn, { businessName: "Leeds Plumbing Co" } as any);
  const ld = JSON.parse(meta.jsonLd);

  assert.deepEqual(ld.author, { "@type": "Organization", name: "Leeds Plumbing Co" });
  assert.ok(ld.datePublished, "datePublished must be set");
  assert.equal(ld.datePublished, ld.dateModified, "a freshly written article's modified date starts equal to its published date");
  assert.ok(Date.parse(ld.datePublished) >= before, "the stamped date must be real, not something the model invented");
  assert.equal(ld.headline, "H", "the model's own fields are kept, not overwritten");
});

test("no business name on file: author is simply left off, never invented", async () => {
  const { fn } = fakeComplete({ "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{}" }) });
  const meta = await writeMeta(OUTLINE, TOPIC, "body", fn); // no context passed at all
  const ld = JSON.parse(meta.jsonLd);
  assert.equal(ld.author, undefined);
  assert.ok(ld.datePublished, "the date is not dependent on having a business name");
});

test("malformed jsonLd from the model does not throw — the real date/author still land in a fresh object", async () => {
  const { fn } = fakeComplete({
    "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{not valid json at all" }),
  });
  const meta = await writeMeta(OUTLINE, TOPIC, "body", fn, { businessName: "Leeds Plumbing Co" } as any);
  const ld = JSON.parse(meta.jsonLd); // must itself be valid JSON even though the model's was not
  assert.equal(ld["@type"], "Article");
  assert.equal(ld.headline, OUTLINE.title, "falls back to the outline's own title");
  assert.deepEqual(ld.author, { "@type": "Organization", name: "Leeds Plumbing Co" });
  assert.ok(ld.datePublished);
});

/* ---------------------------------------------------------------- the pipeline ----------- */

test("the whole pipeline: outline, then sections in parallel, then polish, then meta — in that order", async () => {
  const order: string[] = [];
  const { fn } = fakeComplete({
    "writer.outline": () => { order.push("outline"); return JSON.stringify(OUTLINE); },
    "writer.section": () => { order.push("section"); return "## S\n\ntext"; },
    "writer.polish": () => { order.push("polish"); return `# ${OUTLINE.title}\n\npolished`; },
    "writer.meta": () => { order.push("meta"); return JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{}" }); },
  });

  const result = await writeArticlePipeline(TOPIC, undefined, undefined, fn);

  assert.equal(order[0], "outline");
  assert.equal(order[order.length - 2], "polish");
  assert.equal(order[order.length - 1], "meta");
  assert.equal(order.filter((s) => s === "section").length, OUTLINE.sections.length);
  assert.equal(result.sections.length, OUTLINE.sections.length);
  assert.equal(result.body, `# ${OUTLINE.title}\n\npolished`);
  assert.equal(result.meta.slug, "s");
});

test("onSection fires once per finished section, with real word counts, before polish runs", async () => {
  const fired: string[] = [];
  const { fn } = fakeComplete({
    "writer.outline": () => JSON.stringify(OUTLINE),
    "writer.section": (prompt: string) => {
      const h2 = OUTLINE.sections.find((s) => prompt.includes(s.h2))!.h2;
      return `## ${h2}\n\n${"word ".repeat(20)}`;
    },
    "writer.polish": () => {
      assert.equal(fired.length, OUTLINE.sections.length, "every section must have fired before polish starts");
      return `# T\n\npolished`;
    },
    "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{}" }),
  });

  await writeArticlePipeline(TOPIC, undefined, undefined, fn, {
    onSection: (s) => {
      fired.push(s.h2);
      assert.ok(s.words > 0);
    },
  });
  assert.equal(fired.length, OUTLINE.sections.length);
});

test("a failure in any one section fails the whole article rather than publishing a hole", async () => {
  const { fn } = fakeComplete({
    "writer.outline": () => JSON.stringify(OUTLINE),
    "writer.section": (prompt: string) => {
      if (prompt.includes("What it costs")) throw new Error("model timed out");
      return "## S\n\ntext";
    },
  });
  await assert.rejects(() => writeArticlePipeline(TOPIC, undefined, undefined, fn), /model timed out/);
});

/* ---------------------------------------------------------------- research --------------- */

test("with no researcher injected, the pipeline runs exactly as before (no research in the outline prompt)", async () => {
  const { fn, seen } = fakeComplete({
    "writer.outline": () => JSON.stringify(OUTLINE),
    "writer.section": () => "## S\n\ntext",
    "writer.polish": () => `# ${OUTLINE.title}\n\npolished`,
    "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{}" }),
  });
  await writeArticlePipeline(TOPIC, undefined, undefined, fn);
  const outlinePrompt = seen.find((s) => s.label === "writer.outline")!.prompt;
  assert.doesNotMatch(outlinePrompt, /WHAT THE OPEN WEB COVERS/);
});

test("a researcher's result reaches the outline step, and onResearch fires with it before the outline call", async () => {
  const { fn } = fakeComplete({
    "writer.outline": () => JSON.stringify(OUTLINE),
    "writer.section": () => "## S\n\ntext",
    "writer.polish": () => `# ${OUTLINE.title}\n\npolished`,
    "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{}" }),
  });
  const research = { context: "Background from the open web.", sources: [{ url: "https://x.test", title: "Source" }] };
  let reported: typeof research | null | undefined;
  await writeArticlePipeline(TOPIC, undefined, undefined, fn, {
    researcher: async (topic) => {
      assert.equal(topic, TOPIC);
      return research;
    },
    onResearch: (r) => (reported = r),
  });
  assert.deepEqual(reported, research);
});

test("a researcher that resolves null (skipped) does not stop the pipeline or the outline call", async () => {
  const { fn } = fakeComplete({
    "writer.outline": () => JSON.stringify(OUTLINE),
    "writer.section": () => "## S\n\ntext",
    "writer.polish": () => `# ${OUTLINE.title}\n\npolished`,
    "writer.meta": () => JSON.stringify({ metaTitle: "T", metaDescription: "D", slug: "s", jsonLd: "{}" }),
  });
  let reported: unknown = "not called";
  const result = await writeArticlePipeline(TOPIC, undefined, undefined, fn, {
    researcher: async () => null,
    onResearch: (r) => (reported = r),
  });
  assert.equal(reported, null);
  assert.equal(result.title, OUTLINE.title);
});
