import test from "node:test";
import assert from "node:assert/strict";
import { renderStory, structuralErrors, type StoryPage } from "./story.js";

/** The markup, from a fixture, with no network and no model. An invalid Web Story gets no
 *  place in Discover's carousel — which is the only reason to make one — so every claim the
 *  agent makes about its output is checked here rather than assumed. */

function page(over: Partial<StoryPage> = {}): StoryPage {
  return { headline: "Five signs your roof needs work", image: "https://cdn.example.com/p1.webp", alt: "A tiled roof", body: "Most of them are visible from the ground.", ...over };
}

const INPUT = {
  title: "Roof repairs in Springfield",
  canonical: "https://example.com/roof-repairs",
  publisher: "Example Roofing",
  publisherLogo: "https://cdn.example.com/logo.webp",
  poster: "https://cdn.example.com/cover.webp",
  brandColor: "#22c55e",
  pages: [page(), page({ headline: "Slipped tiles" }), page({ headline: "Chimney flashing" }), page({ headline: "Gutters" }), page({ headline: "Read the full guide", body: undefined, cta: { text: "Read the full article", href: "https://example.com/roof-repairs" } })],
};

test("the AMP a Web Story actually needs is all there", () => {
  const html = renderStory(INPUT);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html ⚡ lang="en">/);
  assert.match(html, /<script async src="https:\/\/cdn\.ampproject\.org\/v0\.js">/);
  assert.match(html, /custom-element="amp-story"/);
  assert.match(html, /<style amp-boilerplate>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/roof-repairs">/);
  assert.match(html, /<amp-story standalone/);
  assert.match(html, /poster-portrait-src="https:\/\/cdn\.example\.com\/cover\.webp"/);
  assert.equal((html.match(/<amp-story-page[\s>]/g) ?? []).length, 5);
});

test("every page is a picture with its own text, and the last one links back to the article", () => {
  const html = renderStory(INPUT);
  assert.equal((html.match(/<amp-img\b/g) ?? []).length, 5, "a page without a picture is not a page");
  assert.match(html, /width="720" height="1280"/, "portrait, phone-shaped");
  assert.match(html, /<h2 class="headline">Five signs your roof needs work<\/h2>/);
  assert.match(html, /<amp-story-page-outlink layout="nodisplay"><a href="https:\/\/example\.com\/roof-repairs">Read the full article<\/a>/);
  assert.equal((html.match(/<amp-story-page-outlink/g) ?? []).length, 1, "only the last page has the link");
});

test("the brand colour reaches the page, and a customer's own words cannot break the markup", () => {
  const html = renderStory({
    ...INPUT,
    title: 'Roofs & "gutters" <script>alert(1)</script>',
    publisher: "A & B <Ltd>",
    pages: [page({ headline: 'Tiles & "slates" < 5 years old', alt: 'A roof & a "ladder"' }), ...INPUT.pages.slice(1)],
  });
  assert.match(html, /background: #22c55e/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, "the title is escaped, not executed");
  assert.match(html, /Roofs &amp; &quot;gutters&quot;/);
  assert.match(html, /alt="A roof &amp; a &quot;ladder&quot;"/);
});

test("structural checks catch the things that are always wrong", () => {
  const html = renderStory(INPUT);
  assert.deepEqual(structuralErrors(html, INPUT.pages), [], "a well-formed story has nothing to report");

  assert.ok(structuralErrors(html.replace('<script async src="https://cdn.ampproject.org/v0.js"></script>', ""), INPUT.pages).some((e) => /runtime script/.test(e)));
  assert.ok(structuralErrors(html.replace(/<link rel="canonical"[^>]*>/, ""), INPUT.pages).some((e) => /canonical/.test(e)));
  assert.ok(structuralErrors(html.replace(/poster-portrait-src="[^"]*"/, ""), INPUT.pages).some((e) => /poster/.test(e)));
  // Global: the boilerplate appears twice (the style and its <noscript> twin), and replacing
  // only the first leaves the second one matching.
  assert.ok(structuralErrors(html.replace(/<style amp-boilerplate>/g, "<style>"), INPUT.pages).some((e) => /boilerplate/.test(e)));
});

test("a story that is too short, or has a page missing its picture or its words, is refused", () => {
  const short = { ...INPUT, pages: INPUT.pages.slice(0, 2) };
  assert.ok(structuralErrors(renderStory(short), short.pages).some((e) => /at least 4 pages/.test(e)));

  const noImage = { ...INPUT, pages: [page({ image: "" }), ...INPUT.pages.slice(1)] };
  assert.ok(structuralErrors(renderStory(noImage), noImage.pages).some((e) => /page 1 has no image/.test(e)));

  const noAlt = { ...INPUT, pages: [page({ alt: "" }), ...INPUT.pages.slice(1)] };
  assert.ok(structuralErrors(renderStory(noAlt), noAlt.pages).some((e) => /no alt text/.test(e)));

  const wordy = { ...INPUT, pages: [page({ headline: "This headline is far too long to read on a phone screen while it moves" }), ...INPUT.pages.slice(1)] };
  assert.ok(structuralErrors(renderStory(wordy), wordy.pages).some((e) => /too long to read on a phone/.test(e)));
});
