/** A Web Story as HTML, and the check that it is a real one (MASTER_PLAN §19.4.5, §19.2).
 *
 *  An AMP Web Story is one HTML page: `<amp-story>` with 6-8 `<amp-story-page>` inside it,
 *  each a full-screen portrait image with a line of text over it. Google Discover shows it as
 *  a card in its own carousel. No paid tool, no plugin, no editor JSON — which is why §19.2
 *  chose "generate the AMP ourselves" over driving GoogleForCreators/web-stories-wp's REST API.
 *
 *  KEPT SEPARATE FROM THE AGENT so the markup can be tested from a fixture with no network,
 *  no model and no database — the same reason lib/audit/checks.ts is separate from its agent.
 *
 *  VALIDATION IS NOT OPTIONAL. An invalid Web Story is not "slightly wrong": Google will not
 *  put it in the carousel at all, which is the only reason to make one. `validateStory()` runs
 *  the official `amphtml-validator` when it can reach its ruleset, and a set of structural
 *  checks of our own either way — so a story is never published on the strength of nothing.
 */

/** One page of the story. `image` is a URL of a 720×1280 picture (portrait, phone-shaped). */
export type StoryPage = {
  headline: string;
  body?: string;
  image: string;
  alt: string;
  /** The last page's link back to the article. */
  cta?: { text: string; href: string };
};

export type StoryInput = {
  title: string;
  /** The canonical article this story is about — required by AMP and by us: a story that does
   *  not point back at its article is an orphan Google will treat as duplicate content. */
  canonical: string;
  /** The story's own address, once it has one. */
  publisher: string;
  publisherLogo: string;
  /** 640×853 portrait, AMP's own requirement for the Discover card. */
  poster: string;
  brandColor?: string;
  pages: StoryPage[];
};

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The AMP boilerplate is not decoration — a Web Story without it, or with it altered, fails
 *  validation and never reaches Discover. It is written out in full rather than assembled, so
 *  it can be compared with AMP's own documentation line for line. */
export function renderStory(input: StoryInput): string {
  const color = input.brandColor || "#8b5cf6";
  const pages = input.pages
    .map((p, i) => {
      const id = `page-${i + 1}`;
      const cta = p.cta
        ? `\n      <amp-story-page-outlink layout="nodisplay"><a href="${esc(p.cta.href)}">${esc(p.cta.text)}</a></amp-story-page-outlink>`
        : "";
      return `    <amp-story-page id="${id}">
      <amp-story-grid-layer template="fill">
        <amp-img src="${esc(p.image)}" width="720" height="1280" layout="responsive" alt="${esc(p.alt)}"></amp-img>
      </amp-story-grid-layer>
      <amp-story-grid-layer template="vertical" class="bottom">
        <h2 class="headline">${esc(p.headline)}</h2>
        ${p.body ? `<p class="body">${esc(p.body)}</p>` : ""}
      </amp-story-grid-layer>${cta}
    </amp-story-page>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html ⚡ lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(input.title)}</title>
  <link rel="canonical" href="${esc(input.canonical)}">
  <meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <script async custom-element="amp-story" src="https://cdn.ampproject.org/v0/amp-story-1.0.js"></script>
  <style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript>
  <style amp-custom>
    amp-story-page { background: #0b0b12; }
    .bottom { align-content: end; padding: 0 24px 64px; }
    .headline { color: #fff; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 30px; line-height: 1.2; font-weight: 700; margin: 0 0 10px; text-shadow: 0 2px 18px rgba(0,0,0,.85); }
    .body { color: #eaeaf2; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 17px; line-height: 1.45; margin: 0; text-shadow: 0 2px 14px rgba(0,0,0,.85); }
    .headline::before { content: ''; display: block; width: 46px; height: 4px; border-radius: 2px; background: ${esc(color)}; margin-bottom: 14px; }
  </style>
</head>
<body>
  <amp-story standalone
    title="${esc(input.title)}"
    publisher="${esc(input.publisher)}"
    publisher-logo-src="${esc(input.publisherLogo)}"
    poster-portrait-src="${esc(input.poster)}">
${pages}
  </amp-story>
</body>
</html>`;
}

export type StoryCheck = { ok: boolean; errors: string[]; checkedBy: "amphtml-validator" | "structure" };

/** Structural checks of our own: the handful of things that are always wrong, stated in words
 *  a person can act on. Runs whether or not the official validator could be reached. */
export function structuralErrors(html: string, pages: StoryPage[]): string[] {
  const errors: string[] = [];
  if (!/<html[^>]*⚡/.test(html) && !/<html[^>]*\samp\b/.test(html)) errors.push("the <html> tag is not marked as AMP");
  if (!html.includes("https://cdn.ampproject.org/v0.js")) errors.push("the AMP runtime script is missing");
  if (!html.includes("amp-story-1.0.js")) errors.push("the amp-story extension script is missing");
  if (!/<style amp-boilerplate>/.test(html)) errors.push("the AMP boilerplate style is missing");
  if (!/<link rel="canonical"/.test(html)) errors.push("there is no canonical link back to the article");
  if (!/poster-portrait-src="[^"]+"/.test(html)) errors.push("amp-story has no poster-portrait-src, so Discover has no card image");
  // [\s>] rather than \b: "page" followed by "-" is a word boundary too, so \b also counted
  // every <amp-story-page-outlink> as a page of its own (caught by story.test.ts).
  const count = (html.match(/<amp-story-page[\s>]/g) ?? []).length;
  if (count < 4) errors.push(`a story needs at least 4 pages, this has ${count}`);
  if (count > 12) errors.push(`a story may not have more than 12 pages, this has ${count}`);
  pages.forEach((p, i) => {
    if (!p.image) errors.push(`page ${i + 1} has no image`);
    if (!p.headline?.trim()) errors.push(`page ${i + 1} has no headline`);
    if ((p.headline ?? "").split(/\s+/).filter(Boolean).length > 12) errors.push(`page ${i + 1}'s headline is too long to read on a phone`);
    if (!p.alt?.trim()) errors.push(`page ${i + 1}'s image has no alt text`);
  });
  return errors;
}

/** The official validator when its ruleset can be fetched, ours otherwise — and the result
 *  says which ran, because "we checked it properly" and "we checked what we could" are two
 *  different claims. Never throws. */
export async function validateStory(html: string, pages: StoryPage[]): Promise<StoryCheck> {
  const mine = structuralErrors(html, pages);
  try {
    const { getInstance } = await import("amphtml-validator");
    const validator = await Promise.race([
      getInstance(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15_000)),
    ]);
    const result = validator.validateString(html);
    const official = (result.errors ?? [])
      .filter((e: any) => e.severity === "ERROR")
      .map((e: any) => `line ${e.line}: ${e.message}`);
    const all = [...new Set([...official, ...mine])];
    return { ok: all.length === 0, errors: all, checkedBy: "amphtml-validator" };
  } catch {
    // The validator downloads its ruleset from cdn.ampproject.org. On a box that cannot reach
    // it, our own checks still run — and the caller is told which check it got.
    return { ok: mine.length === 0, errors: mine, checkedBy: "structure" };
  }
}
