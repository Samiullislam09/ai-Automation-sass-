/** Run: cd agent-server && npx tsx --test src/lib/publish.test.ts
 *
 *  Only the pure functions (markdownToHtml, withImages) — no network, no Supabase, no
 *  credentials to decrypt. publishToWordPress/deliverWebhook need real integration rows and are
 *  exercised in production, not here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml, withImages } from "./publish.js";

/* ---------------------------------------------------------------- markdownToHtml --------- */

test("a bare image line becomes a figure, not an escaped literal paragraph", () => {
  const html = markdownToHtml("## A heading\n\n![A slipped roof tile](https://media.test/inline_1.webp)\n\nMore prose after it.");
  assert.match(html, /<figure class="wp-block-image size-large"><img src="https:\/\/media\.test\/inline_1\.webp" alt="A slipped roof tile" loading="lazy"\/><\/figure>/);
  assert.doesNotMatch(html, /!\[/, "the raw markdown image syntax must not survive into the HTML");
});

test("embed.ts's own marker comments are dropped silently, never printed as visible text", () => {
  const html = markdownToHtml("## Heading\n\n<!-- image:hero -->\n![Alt text](https://media.test/hero.webp)\n<!-- /image:hero -->\n\nProse.");
  assert.doesNotMatch(html, /image:hero/);
  assert.doesNotMatch(html, /&lt;!--/);
  assert.match(html, /<img src="https:\/\/media\.test\/hero\.webp"/);
});

test("an image mid-paragraph (not on its own line) is left to the ordinary paragraph/link handling, not double-processed", () => {
  // embed.ts always emits images on their own line — this just proves the whole-line image rule
  // does not accidentally eat text it was never meant to touch.
  const html = markdownToHtml("Some prose that mentions ![not a real embed](https://x.test/y) inline.");
  assert.match(html, /<p>/);
  assert.doesNotMatch(html, /<figure/);
});

/* ---------------------------------------------------------------- withImages ------------- */

const HERO_HTML = `<h1>Title</h1>\n<img src="https://media.test/hero.webp" alt="Hero shot" loading="lazy"/>\n<h2>Slipped tiles</h2>\n<p>Some prose.</p>`;

test("an image already embedded in the body (our storage URL) is SWAPPED to the WordPress URL, not duplicated", () => {
  const out = withImages(HERO_HTML, [
    { slot: "hero", url: "https://media.test/hero.webp", alt: "Hero shot", anchor: null, id: 42, wpUrl: "https://customer-site.test/wp-content/uploads/hero.webp" },
  ]);
  assert.equal((out.match(/<img/g) || []).length, 1, "swap must not leave two <img> tags");
  assert.match(out, /src="https:\/\/customer-site\.test\/wp-content\/uploads\/hero\.webp"/);
  assert.doesNotMatch(out, /media\.test\/hero\.webp/, "our own storage URL must not remain once swapped");
});

test("an image with no matching embedded URL falls back to the old insert-after-heading / prepend-hero behavior", () => {
  const bareHtml = `<h1>Title</h1>\n<h2>Slipped tiles</h2>\n<p>Some prose.</p>`; // never embedded — an older article
  const out = withImages(bareHtml, [
    { slot: "hero", url: "https://media.test/hero.webp", alt: "Hero shot", anchor: null, id: 1, wpUrl: "https://customer-site.test/hero.webp" },
    { slot: "inline_1", url: "https://media.test/inline_1.webp", alt: "Tiles", anchor: "Slipped tiles", id: 2, wpUrl: "https://customer-site.test/inline_1.webp" },
  ]);
  assert.match(out, /^<figure[^>]*><img src="https:\/\/customer-site\.test\/hero\.webp"/, "hero prepended at the very top");
  assert.match(out, /<h2>Slipped tiles<\/h2>\n<figure[^>]*><img src="https:\/\/customer-site\.test\/inline_1\.webp"/);
});

test("a mix — one image already embedded (swapped), one never embedded (inserted fresh) — handles both correctly in one pass", () => {
  const mixedHtml = `<h1>Title</h1>\n<img src="https://media.test/hero.webp" alt="Hero shot" loading="lazy"/>\n<h2>Slipped tiles</h2>\n<p>Some prose.</p>`;
  const out = withImages(mixedHtml, [
    { slot: "hero", url: "https://media.test/hero.webp", alt: "Hero shot", anchor: null, id: 1, wpUrl: "https://customer-site.test/hero.webp" },
    { slot: "inline_1", url: "https://media.test/inline_1.webp", alt: "Tiles", anchor: "Slipped tiles", id: 2, wpUrl: "https://customer-site.test/inline_1.webp" },
  ]);
  assert.equal((out.match(/<img/g) || []).length, 2, "exactly two pictures total, not three");
  assert.match(out, /src="https:\/\/customer-site\.test\/hero\.webp"/);
  assert.match(out, /src="https:\/\/customer-site\.test\/inline_1\.webp"/);
  assert.doesNotMatch(out, /media\.test/);
});

test("an inline image whose anchor heading is not in the HTML at all is left out, in both the swap and fallback paths", () => {
  const out = withImages(`<h1>Title</h1>\n<p>No matching heading here.</p>`, [
    { slot: "inline_1", url: "https://media.test/inline_1.webp", alt: "Tiles", anchor: "A heading that does not exist", id: 1, wpUrl: "https://customer-site.test/inline_1.webp" },
  ]);
  assert.doesNotMatch(out, /<img/);
});
