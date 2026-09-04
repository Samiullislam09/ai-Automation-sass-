/** Turning one 1024×1024 JPEG into every shape a blog needs — and making an image out of
 *  nothing when there is no AI image to be had (MASTER_PLAN §19.4.2, §19.4.4).
 *
 *  WHY THIS FILE EXISTS AT ALL. Cloudflare's FLUX model has no width or height parameter
 *  (checked live 2026-09-05): it returns 1024×1024 and nothing else. Every real slot is a
 *  different shape — a thumbnail is 16:9, an OG card is 1.91:1, a story page is 9:16 — so the
 *  cropping is ours to do either way. Doing it here also means the SAME source image can
 *  become a story page later without asking a provider for anything (§19.4.5's whole point).
 *
 *  NO BROWSER. §19.1 originally proposed screenshotting an HTML template with Playwright. That
 *  is dropped: this process already fought Chrome for memory once (the audit's OOM, 2026-09-05),
 *  a second headless browser for text-on-a-rectangle would be absurd, and sharp composites an
 *  SVG in a few milliseconds with no process to launch and nothing to time out.
 *
 *  THE PROMISE THIS FILE KEEPS: `templateCard()` needs no network, no AI and no account. It is
 *  the bottom rung of the ladder in providers.ts, which is why "no image" can never stop a
 *  publish — the worst case is a plain branded card with the headline on it, not a hole.
 */

import sharp from "sharp";

/** Every shape the platform asks for, and what it is for. Values are the sizes the platforms
 *  themselves publish, not round numbers picked by us. */
export const SHAPES = {
  /** Blog list + Google's own thumbnail. */
  thumb: { width: 1280, height: 720 },
  /** Open Graph / Twitter card — Facebook's own recommendation. */
  og: { width: 1200, height: 630 },
  /** In-article hero. */
  hero: { width: 1600, height: 900 },
  /** In-article body image. */
  inline: { width: 1200, height: 900 },
  /** AMP Web Story page — portrait, phone-shaped. */
  story: { width: 720, height: 1280 },
} as const;

export type Shape = keyof typeof SHAPES;

/** WebP quality and the ceiling from §19.1 ("<150KB"). Quality steps down until it fits, so a
 *  busy photograph is not shipped at 400KB just because 82 was the first guess. The last rung
 *  is returned whatever it weighs — an image that is 10KB over is still an image, and failing
 *  here would break the one promise this file exists to keep. */
const QUALITY_LADDER = [82, 74, 66, 58, 50, 42];
const MAX_BYTES = 150 * 1024;

/** Which pass over the same source this is (§19.4.5: when a story has more pages than the
 *  article has images, the same image comes back looking different rather than a random new
 *  one being generated). 0 is the real crop; 1 and 2 take a slice of the source FIRST, so the
 *  result differs in pixels no matter what the two aspect ratios are — a square source cropped
 *  to portrait has no vertical room to move, which is exactly the case that made a naive
 *  "top / centre / bottom" produce three identical files. */
export type Variant = 0 | 1 | 2;

/** Crop + resize + WebP, under MAX_BYTES where the picture allows. Never upscales past the
 *  source: a 1024px image asked for a 1600px hero is delivered at its own width rather than
 *  blown up into mush. */
export async function toShape(source: Buffer, shape: Shape, variant: Variant = 0): Promise<{ webp: Buffer; width: number; height: number }> {
  const want = SHAPES[shape];
  const meta = await sharp(source).metadata();
  const srcW = meta.width ?? want.width;
  const srcH = meta.height ?? want.height;

  // Variants 1 and 2: keep 82% of the source, from the top and from the bottom. Different
  // pixels go in, so different pixels come out.
  let input = source;
  let inW = srcW;
  let inH = srcH;
  if (variant !== 0 && srcH > 8) {
    const keep = Math.max(1, Math.round(srcH * 0.82));
    const top = variant === 1 ? 0 : srcH - keep;
    input = await sharp(source).extract({ left: 0, top, width: srcW, height: keep }).toBuffer();
    inH = keep;
  }

  // Fit the requested aspect ratio inside what we have, then resize down to it.
  const scale = Math.min(inW / want.width, inH / want.height, 1);
  const width = Math.max(1, Math.round(want.width * scale));
  const height = Math.max(1, Math.round(want.height * scale));

  const base = sharp(input).resize(width, height, { fit: "cover", position: "attention", withoutEnlargement: true });

  let last: Buffer | null = null;
  for (const quality of QUALITY_LADDER) {
    last = await base.clone().webp({ quality, effort: 4 }).toBuffer();
    if (last.length <= MAX_BYTES) break;
  }
  return { webp: last as Buffer, width, height };
}

/* ---------------------------------------------------------------- text on images --------- */

/** XML-escape, because a headline is a customer's own words and may contain & < > " — which
 *  would otherwise turn the overlay SVG into invalid XML and take the whole image down. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Greedy wrap by estimated width. No font metrics are available without loading the font, so
 *  this uses an average character width — deliberately generous, because a line that wraps one
 *  word early looks fine and a line that overflows the image does not. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}

export type Brand = {
  /** The tenant's own colour from onboarding. Falls back to the product violet. */
  color?: string;
  /** Business name, printed small under the headline. */
  name?: string;
};

/** A readable band of text over a photo: a dark gradient from the bottom so light photos do
 *  not swallow white type, the headline, and the business name. Used for the story pages and
 *  for the OG card when it sits on a real image. */
export async function overlayHeadline(image: Buffer, headline: string, brand: Brand = {}): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const w = meta.width ?? 1200;
  const h = meta.height ?? 630;
  const color = brand.color || "#8b5cf6";
  const fontSize = Math.round(w / 18);
  const lines = wrap(headline.trim(), Math.round(w / (fontSize * 0.52)), 3);
  const lineHeight = Math.round(fontSize * 1.25);
  const blockHeight = lines.length * lineHeight + (brand.name ? lineHeight : 0);
  const top = h - blockHeight - Math.round(h * 0.07);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.82"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#shade)"/>
  <rect x="${Math.round(w * 0.06)}" y="${top - Math.round(fontSize * 0.9)}" width="${Math.round(fontSize * 1.6)}" height="${Math.round(fontSize * 0.22)}" rx="${Math.round(fontSize * 0.11)}" fill="${esc(color)}"/>
  ${lines
    .map(
      (line, i) =>
        `<text x="${Math.round(w * 0.06)}" y="${top + i * lineHeight + fontSize}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${esc(line)}</text>`,
    )
    .join("\n  ")}
  ${
    brand.name
      ? `<text x="${Math.round(w * 0.06)}" y="${top + lines.length * lineHeight + Math.round(fontSize * 0.8)}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${Math.round(fontSize * 0.45)}" fill="#e6e6f2" opacity="0.9">${esc(brand.name)}</text>`
      : ""
  }
</svg>`;

  return sharp(image).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer();
}

/** An image made of nothing but the headline and the brand — the rung that always works.
 *  No network, no AI, no browser, no font files beyond whatever the system has. This is why
 *  §19.4.4 can promise that a missing image never blocks a publish. */
export async function templateCard(headline: string, shape: Shape, brand: Brand = {}): Promise<{ webp: Buffer; width: number; height: number }> {
  const { width: w, height: h } = SHAPES[shape];
  const color = brand.color || "#8b5cf6";
  const fontSize = Math.round(w / 16);
  const lines = wrap(headline.trim() || "Untitled", Math.round(w / (fontSize * 0.52)), 4);
  const lineHeight = Math.round(fontSize * 1.22);
  const top = Math.round(h / 2 - (lines.length * lineHeight) / 2);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b0b12"/>
      <stop offset="100%" stop-color="#16161f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${esc(color)}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${esc(color)}" stop-opacity="0.25"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${Math.round(w * 0.86)}" cy="${Math.round(h * 0.18)}" r="${Math.round(h * 0.28)}" fill="${esc(color)}" opacity="0.10"/>
  <rect x="0" y="0" width="${w}" height="${Math.round(h * 0.012)}" fill="url(#accent)"/>
  ${lines
    .map(
      (line, i) =>
        `<text x="${Math.round(w * 0.07)}" y="${top + i * lineHeight + fontSize}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${esc(line)}</text>`,
    )
    .join("\n  ")}
  ${
    brand.name
      ? `<text x="${Math.round(w * 0.07)}" y="${h - Math.round(h * 0.08)}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${Math.round(fontSize * 0.42)}" fill="${esc(color)}" font-weight="600">${esc(brand.name)}</text>`
      : ""
  }
</svg>`;

  const webp = await sharp(Buffer.from(svg)).webp({ quality: 88, effort: 4 }).toBuffer();
  return { webp, width: w, height: h };
}

/** For tests and for the story renderer: what shape a buffer actually is. */
export async function dimensions(buf: Buffer): Promise<{ width: number; height: number; format: string }> {
  const m = await sharp(buf).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0, format: m.format ?? "" };
}
