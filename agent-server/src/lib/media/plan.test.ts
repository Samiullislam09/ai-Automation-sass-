import test from "node:test";
import assert from "node:assert/strict";
import { planImages, inlineCount, cardFor, describesSection, buildPrompt, seedFor, stepLines, figureLines, type ArticleForImages } from "./plan.js";
import type { SiteProfile } from "../siteProfile.js";

/** The gates, from fixtures, with no model and no network. Every test here is one of the
 *  owner's own sentences turned into a check: images belong to their paragraph, nothing is
 *  random, and a section explaining a map does not get an invented map. */

const PROFILE = { what_they_do: "A roofing contractor serving homeowners", geo: "Springfield, Illinois" } as unknown as SiteProfile;

function article(over: Partial<ArticleForImages> = {}): ArticleForImages {
  return {
    id: "art-1",
    title: "Roof repairs in Springfield: what they cost and when to call",
    intro: "Roof repairs range from a single slipped tile to a full re-covering. This guide explains what each job involves.",
    wordCount: 2000,
    sections: [
      { heading: "Slipped and broken tiles", text: "A slipped tile leaves the felt underneath exposed to rain. Most roofers can re-bed a handful of tiles in an afternoon, and the tiles themselves are inexpensive." },
      { heading: "Flashing and chimney leaks", text: "Lead flashing around a chimney fails long before the tiles do. Water tracks down the chimney breast and shows up as a damp patch on a bedroom ceiling." },
      { heading: "Gutters and fascias", text: "Blocked gutters push water back under the roof edge. Clearing them every autumn is the cheapest maintenance a roof ever gets." },
    ],
    ...over,
  };
}

/* ---------------------------------------------------------------- the ladder ------------ */

test("the ladder: at least two images always, more with length, never more than sections", () => {
  assert.equal(inlineCount(500, 5), 0, "a short article still gets thumb + hero — that is the floor");
  assert.equal(inlineCount(900, 5), 1);
  assert.equal(inlineCount(1800, 5), 2);
  assert.equal(inlineCount(2700, 5), 3);
  assert.equal(inlineCount(9000, 5), 3, "the ladder stops at three inline");
  assert.equal(inlineCount(2700, 1), 1, "an image belongs to a section — there cannot be more images than sections");
});

/* ---------------------------------------------------------------- gate 3: card ---------- */

test("a section explaining a map gets a card, never an AI image — the owner's own question", () => {
  // "agar article ke kisi part pe bataya ja raha hai ki USA ka map kaisa hai, to AI usa ka map
  // banayega?" — no. A diffusion model draws a convincing wrong map.
  const card = cardFor({ heading: "How the coverage map is laid out", text: "The map shows every state we cover, with the Midwest shaded darker because most of our crews are based there." });
  assert.ok(card);
  assert.equal(card!.type, "keypoint");
  assert.match(card!.why, /image model would draw a convincing wrong one|real shape/);
});

test("a numbered procedure becomes a steps card built from the section's own lines", () => {
  const card = cardFor({
    heading: "How to check your roof after a storm",
    text: "1. Walk the perimeter and look for tiles on the ground.\n2. Check the loft for daylight through the boards.\n3. Photograph any damp patches before they dry.\n4. Call a roofer before the next rain.",
  });
  assert.ok(card);
  assert.equal(card!.type, "steps");
  assert.equal(card!.lines.length, 4);
  assert.equal(card!.lines[0], "Walk the perimeter and look for tiles on the ground.");
});

test("a section that turns on figures becomes a stats card, with each number's own label", () => {
  const card = cardFor({ heading: "What repairs cost", text: "A slipped tile is usually $150 to fix. A full chimney re-flash runs $900 in this area, and about 38% of the leaks we see start there." });
  assert.ok(card);
  assert.equal(card!.type, "stats");
  assert.ok(card!.lines.length >= 2);
  assert.ok(card!.lines.some((l) => l.includes("38%")), `expected a labelled percentage, got ${JSON.stringify(card!.lines)}`);
});

test("an ordinary descriptive section is fine for a real picture", () => {
  assert.equal(cardFor({ heading: "Flashing and chimney leaks", text: "Lead flashing around a chimney fails long before the tiles do, and water tracks down the chimney breast." }), null);
});

test("stepLines and figureLines read the section, not a template", () => {
  assert.deepEqual(stepLines("- first\n- second\nnot a step\n3) third"), ["first", "second", "third"]);
  assert.deepEqual(figureLines("It takes 2 hours and costs $450 for a small repair."), ["2 hours and costs", "$450 for a small repair"]);
});

/* ---------------------------------------------------------------- gate 2 ---------------- */

test("a brief that shares no word with its section is not describing it", () => {
  const section = { heading: "Gutters and fascias", text: "Blocked gutters push water back under the roof edge." };
  assert.equal(describesSection("a modern office desk", "an office desk with a laptop", section), false, "the generic stock answer");
  assert.equal(describesSection("clogged guttering", "a gutter full of wet leaves", section), true);
  assert.equal(describesSection("", "rainwater spilling over a blocked gutter", section), true, "plurals match their singular");
});

/* ---------------------------------------------------------------- prompt and seed ------- */

test("the prompt is assembled by us: the model contributes the subject and nothing else", () => {
  const p = buildPrompt("a gutter full of wet leaves", "photo", PROFILE);
  assert.match(p, /^a gutter full of wet leaves, editorial photograph/);
  assert.match(p, /context: A roofing contractor serving homeowners/, "the setting comes from Site Brain, not the model");
  assert.match(p, /set in Springfield, Illinois/);
  assert.match(p, /no text, no words, no letters, no numbers, no watermark, no logo, no signage, no people, no faces$/);

  const noProfile = buildPrompt("a gutter", "illustration", null);
  assert.match(noProfile, /clean flat vector illustration/);
  assert.doesNotMatch(noProfile, /context:/, "no Site Brain, no invented setting");
});

test("the seed is the article and the slot, so the same image comes back for free", () => {
  assert.equal(seedFor("art-1", "hero"), seedFor("art-1", "hero"));
  assert.notEqual(seedFor("art-1", "hero"), seedFor("art-1", "thumb"), "thumb and hero are two different pictures");
  assert.notEqual(seedFor("art-1", "hero"), seedFor("art-2", "hero"));
  assert.equal(seedFor("art-1", "hero", 1), seedFor("art-1", "hero") + 1, "'another image' is the only thing that moves it");
});

/* ---------------------------------------------------------------- the whole plan -------- */

const goodReply = {
  style: "photo",
  thumb: { depicts: "the cost of roof repairs", subject: "a roofer's hands re-bedding a clay tile", alt: "A roofer replacing a tile" },
  hero: { depicts: "roof repairs on a Springfield home", subject: "a pitched tiled roof seen from a ladder", alt: "A tiled roof" },
  inline: [
    { anchor: "Flashing and chimney leaks", depicts: "lead flashing failing around a chimney", subject: "weathered lead flashing where a chimney meets the roof", alt: "Lead flashing at a chimney" },
    { anchor: "Slipped and broken tiles", depicts: "a slipped tile exposing the felt", subject: "a single displaced roof tile with felt showing beneath", alt: "A slipped roof tile" },
  ],
};

test("a good brief is used as given, anchored to the real sections", async () => {
  const plan = await planImages(article(), PROFILE, { complete: async () => goodReply as any });
  assert.equal(plan.style, "photo");
  assert.deepEqual(plan.slots.map((s) => s.slot), ["thumb", "hero", "inline_1", "inline_2"]);
  assert.equal(plan.slots[0].anchor, null, "thumb belongs to the article, not a section");
  assert.equal(plan.slots[2].anchor, "Flashing and chimney leaks");
  assert.equal(plan.slots[2].kind, "photo");
  assert.equal(plan.slots[3].anchor, "Slipped and broken tiles");
  assert.ok(plan.slots.every((s) => s.alt), "every image has alt text");
});

test("gate 1: an invented heading is dropped and the slot falls to a real section", async () => {
  const reply = { ...goodReply, inline: [{ anchor: "Seven roofing myths", depicts: "myths", subject: "a roof", alt: "x" }] };
  const plan = await planImages(article({ wordCount: 900 }), PROFILE, { complete: async () => reply as any });
  const inline = plan.slots.filter((s) => s.slot.startsWith("inline"));
  assert.equal(inline.length, 1);
  assert.ok(article().sections.some((s) => s.heading === inline[0].anchor), `anchor ${inline[0].anchor} must be a real heading`);
});

test("gate 2: a generic stock brief is refused and the section's own point is drawn instead", async () => {
  const reply = {
    ...goodReply,
    inline: [{ anchor: "Gutters and fascias", depicts: "professionalism", subject: "a modern office desk with a laptop", alt: "An office" }],
  };
  const plan = await planImages(article({ wordCount: 900 }), PROFILE, { complete: async () => reply as any });
  const inline = plan.slots.find((s) => s.slot === "inline_1")!;
  assert.equal(inline.kind, "card", "an office desk for a gutters section is not rendered");
  assert.equal(inline.anchor, "Gutters and fascias");
  assert.match(inline.note!, /did not share a single word/);
});

test("gate 3 wins over the model: a map section is a card even when the brief looks fine", async () => {
  const withMap = article({
    wordCount: 900,
    sections: [{ heading: "Our coverage map", text: "The map shows every county we cover across central Illinois." }],
  });
  const reply = { ...goodReply, inline: [{ anchor: "Our coverage map", depicts: "the counties we cover", subject: "a map of central Illinois with counties shaded", alt: "Coverage map" }] };
  const plan = await planImages(withMap, PROFILE, { complete: async () => reply as any });
  const inline = plan.slots.find((s) => s.slot === "inline_1")!;
  assert.equal(inline.kind, "card");
  assert.equal(inline.card?.type, "keypoint");
});

test("a model that fails entirely still leaves a usable plan — two images, from the article's own words", async () => {
  const plan = await planImages(article({ wordCount: 500 }), PROFILE, {
    complete: async () => {
      throw new Error("NVIDIA is down");
    },
  });
  assert.deepEqual(plan.slots.map((s) => s.slot), ["thumb", "hero"], "the floor of two still holds");
  assert.ok(plan.slots.every((s) => s.subject), "each has something to draw");
  assert.match(plan.slots[0].note!, /did not describe this article/);
});

test("a short article gets exactly the floor: thumb and hero, no inline", async () => {
  const plan = await planImages(article({ wordCount: 600 }), PROFILE, { complete: async () => goodReply as any });
  assert.deepEqual(plan.slots.map((s) => s.slot), ["thumb", "hero"]);
});

test("thumb and hero are two different subjects, never the same picture twice", async () => {
  const plan = await planImages(article(), PROFILE, { complete: async () => goodReply as any });
  const [thumb, hero] = plan.slots;
  assert.notEqual(thumb.subject, hero.subject);
  assert.notEqual(seedFor("art-1", thumb.slot), seedFor("art-1", hero.slot));
});
