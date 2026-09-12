/** Run: cd agent-server && npx tsx --test src/lib/media/embed.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { embedImagesInBody, type EmbeddableImage } from "./embed.js";

const BODY = [
  "Intro paragraph about roof repairs in general.",
  "",
  "## Slipped and broken tiles",
  "",
  "A slipped tile leaves the felt underneath exposed to rain.",
  "",
  "## Flashing and chimney leaks",
  "",
  "Lead flashing around a chimney fails long before the tiles do.",
].join("\n");

const HERO: EmbeddableImage = { slot: "hero", anchor: null, url: "https://media.test/hero.webp", alt: "A roof under repair" };
const TILES: EmbeddableImage = { slot: "inline_1", anchor: "Slipped and broken tiles", url: "https://media.test/inline_1.webp", alt: "A close-up of a slipped roof tile" };
const THUMB: EmbeddableImage = { slot: "thumb", anchor: null, url: "https://media.test/thumb.webp", alt: "Roof repair thumbnail" };

test("hero is inserted right before the first heading, wrapped in its own markers", () => {
  const { body } = embedImagesInBody(BODY, [HERO]);
  const lines = body.split("\n");
  const headingIdx = lines.findIndex((l) => l === "## Slipped and broken tiles");
  const imgIdx = lines.findIndex((l) => l.includes("hero.webp"));
  assert.ok(imgIdx > -1 && imgIdx < headingIdx, "the hero image must land before the first heading");
  assert.ok(body.includes("<!-- image:hero -->"));
  assert.ok(body.includes("<!-- /image:hero -->"));
  assert.match(body, /!\[A roof under repair\]\(https:\/\/media\.test\/hero\.webp\)/);
});

test("an inline image lands right after ITS OWN heading, not any other", () => {
  const { body } = embedImagesInBody(BODY, [TILES]);
  const lines = body.split("\n");
  const headingIdx = lines.findIndex((l) => l === "## Slipped and broken tiles");
  const imgIdx = lines.findIndex((l) => l.includes("inline_1.webp"));
  // heading, then a blank line, then the start marker, then the image line itself.
  assert.ok(imgIdx === headingIdx + 3, `expected the image right after its heading's blank line and start marker, got offset ${imgIdx - headingIdx}`);
  const otherHeadingIdx = lines.findIndex((l) => l === "## Flashing and chimney leaks");
  assert.ok(imgIdx < otherHeadingIdx, "must not have landed under the wrong section");
});

test("an anchor that matches no heading is skipped, not guessed at", () => {
  const ghost: EmbeddableImage = { slot: "inline_2", anchor: "A heading this article does not have", url: "https://media.test/inline_2.webp", alt: "x" };
  const { body } = embedImagesInBody(BODY, [ghost]);
  assert.ok(!body.includes("inline_2.webp"));
});

test("thumb is never inlined into the body, and is returned as thumbnailUrl instead", () => {
  const { body, thumbnailUrl } = embedImagesInBody(BODY, [THUMB, HERO]);
  assert.ok(!body.includes("thumb.webp"), "thumb must not appear in the reading flow");
  assert.equal(thumbnailUrl, "https://media.test/thumb.webp");
});

test("re-embedding the SAME slot replaces the old block instead of leaving two", () => {
  const first = embedImagesInBody(BODY, [HERO]).body;
  const redone: EmbeddableImage = { ...HERO, url: "https://media.test/hero-v2.webp", alt: "A newly generated roof photo" };
  const second = embedImagesInBody(first, [redone]).body;
  assert.ok(!second.includes("hero.webp".replace("-v2", "")) || second.includes("hero-v2.webp"));
  assert.equal((second.match(/<!-- image:hero -->/g) || []).length, 1, "exactly one hero block after a redo, never two");
  assert.ok(second.includes("hero-v2.webp"));
  assert.ok(!second.includes("A roof under repair"), "the old alt text must not survive alongside the new picture");
});

test("multiple inline images each land under their own heading, independent of order given", () => {
  const flashing: EmbeddableImage = { slot: "inline_2", anchor: "Flashing and chimney leaks", url: "https://media.test/inline_2.webp", alt: "Lead flashing around a chimney" };
  const { body } = embedImagesInBody(BODY, [flashing, TILES]); // given out of document order on purpose
  const lines = body.split("\n");
  const tilesHeading = lines.findIndex((l) => l === "## Slipped and broken tiles");
  const flashingHeading = lines.findIndex((l) => l === "## Flashing and chimney leaks");
  const tilesImg = lines.findIndex((l) => l.includes("inline_1.webp"));
  const flashingImg = lines.findIndex((l) => l.includes("inline_2.webp"));
  assert.ok(tilesImg > tilesHeading && tilesImg < flashingHeading, "tile image must sit under the tile heading, before the next one");
  assert.ok(flashingImg > flashingHeading, "flashing image must sit under the flashing heading");
});

test("a body with no heading at all still gets the hero, appended at the end", () => {
  const { body } = embedImagesInBody("Just a paragraph, no headings anywhere.", [HERO]);
  assert.ok(body.includes("hero.webp"));
});

test("an empty image list leaves the body byte-for-byte unchanged", () => {
  const { body, thumbnailUrl } = embedImagesInBody(BODY, []);
  assert.equal(body, BODY);
  assert.equal(thumbnailUrl, null);
});
