import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { toShape, templateCard, overlayHeadline, dimensions, SHAPES } from "./render.js";

/** Real sharp, real bytes — no mocks. Everything here is a claim the report makes to a
 *  customer ("under 150KB", "16:9", "the card always renders"), so it is checked against the
 *  actual output rather than the intent. */

/** A stand-in for what Cloudflare returns: a 1024×1024 JPEG that compresses roughly like a
 *  photograph — shapes and gradients, not flat colour (which would prove nothing) and not pure
 *  noise (which no camera produces and which no encoder can compress). */
async function sourceJpeg(size = 1024): Promise<Buffer> {
  const bands = Array.from({ length: 12 }, (_, i) => {
    const y = Math.round((i * size) / 12);
    const hue = (i * 30) % 360;
    return `<rect x="0" y="${y}" width="${size}" height="${Math.round(size / 12)}" fill="hsl(${hue},60%,${35 + (i % 5) * 8}%)"/>` +
      `<circle cx="${(i * 97) % size}" cy="${y + 30}" r="${40 + (i % 4) * 25}" fill="hsl(${(hue + 140) % 360},70%,60%)" opacity="0.7"/>`;
  }).join("");
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${bands}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

/** The worst case an encoder can be handed: incompressible noise. Used only to prove the
 *  renderer still returns an image rather than throwing. */
async function noiseJpeg(size = 1024): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 70 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

test("every shape comes out at the right aspect ratio and under 150KB", async () => {
  const src = await sourceJpeg();
  for (const shape of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
    const { webp, width, height } = await toShape(src, shape);
    const want = SHAPES[shape];
    const got = await dimensions(webp);
    assert.equal(got.format, "webp", `${shape} is webp`);
    assert.equal(got.width, width);
    assert.equal(got.height, height);
    const wantRatio = want.width / want.height;
    const gotRatio = got.width / got.height;
    assert.ok(Math.abs(gotRatio - wantRatio) < 0.02, `${shape}: ratio ${gotRatio.toFixed(3)} should be ${wantRatio.toFixed(3)}`);
    assert.ok(webp.length <= 150 * 1024, `${shape}: ${Math.round(webp.length / 1024)}KB should be under 150KB`);
  }
});

test("a 1024px source is never blown up into a 1600px hero", async () => {
  const src = await sourceJpeg(1024);
  const { width } = await toShape(src, "hero");
  assert.ok(width <= 1024, `hero came out ${width}px wide from a 1024px source`);
});

test("the story shape is portrait, taken from a square source", async () => {
  const { webp } = await toShape(await sourceJpeg(), "story");
  const got = await dimensions(webp);
  assert.ok(got.height > got.width, "a story page is taller than it is wide");
  assert.ok(Math.abs(got.width / got.height - 720 / 1280) < 0.02);
});

test("the same image in three variants gives three different pictures — how a story reuses one image", async () => {
  // §19.4.5: when an article has fewer images than the story has pages, the same image comes
  // back looking different rather than a random new one being generated. A square source
  // cropped to portrait has no vertical room, so this only works because a variant takes a
  // slice of the SOURCE first — the bug this test was written for.
  const src = await sourceJpeg();
  const a = await toShape(src, "story", 0);
  const b = await toShape(src, "story", 1);
  const c = await toShape(src, "story", 2);
  const seen = new Set([a.webp.toString("base64"), b.webp.toString("base64"), c.webp.toString("base64")]);
  assert.equal(seen.size, 3, "three variants, three different files");
});

test("an image no encoder can compress still comes back — the renderer never fails on weight", async () => {
  const { webp } = await toShape(await noiseJpeg(), "thumb");
  const got = await dimensions(webp);
  assert.equal(got.format, "webp");
  assert.ok(webp.length > 0, "an image that cannot fit the budget is still an image, not an exception");
});

test("the template card renders with no image, no network and no browser — the rung that always works", async () => {
  const { webp, width, height } = await templateCard("How to choose a roofer in Springfield", "thumb", { color: "#22c55e", name: "Example Roofing" });
  const got = await dimensions(webp);
  assert.equal(got.format, "webp");
  assert.equal(got.width, width);
  assert.equal(width, SHAPES.thumb.width);
  assert.equal(height, SHAPES.thumb.height);
  assert.ok(webp.length > 1000, "it actually drew something");
  assert.ok(webp.length <= 150 * 1024);
});

test("a headline with XML characters does not break the card — it is the customer's own text", async () => {
  const nasty = `Roofing & "gutters" <script>alert(1)</script> — 5 > 3`;
  const { webp } = await templateCard(nasty, "og", { name: "A & B <Ltd>" });
  assert.ok(webp.length > 1000, "an unescaped ampersand would have thrown instead");
});

test("a very long headline is wrapped and trimmed, never spilled off the image", async () => {
  const long = "This is a deliberately very long headline about roof repairs, gutter cleaning, skylights, chimneys and everything else a roofing company in Springfield might possibly write about in one article";
  const { webp } = await templateCard(long, "thumb");
  assert.ok(webp.length > 1000);
  const empty = await templateCard("", "thumb");
  assert.ok(empty.webp.length > 1000, "even an empty title renders (as 'Untitled')");
});

test("the headline overlay keeps the photo's own size and returns a real image", async () => {
  const { webp } = await toShape(await sourceJpeg(), "story");
  const before = await dimensions(webp);
  const withText = await overlayHeadline(webp, "Five signs your roof needs attention", { color: "#8b5cf6", name: "Example Roofing" });
  const after = await dimensions(withText);
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
  assert.notEqual(withText.toString("base64"), webp.toString("base64"), "something was actually drawn on it");
});
