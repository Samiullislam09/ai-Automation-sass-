/** Putting a generated picture INTO the article it was made for (owner, 2026-09-12: "artical ke
 *  andar wo image lag jaya... artuical editor and livevisual pe wo images add ho jaya").
 *
 *  Until this file existed, an article's pictures lived only in a separate `image_set` review
 *  card (agents/image.ts's `fileForReview`) — the article's own `content_items.body` was never
 *  touched, so the in-app editor, the live workspace's article preview, and a webhook delivery
 *  all showed an article with no pictures in it at all. The only place an image ever actually
 *  reached a reader was a WordPress post, and only because lib/publish.ts's `withImages`
 *  inserted it fresh at that one moment, from scratch, every single publish.
 *
 *  This closes that gap at the source: the moment an image is generated, it is written into the
 *  article's own markdown, the same body `content_items.body` already holds. Downstream:
 *   - the dashboard's article-approval preview (lib/md.ts's `renderMarkdown`) now shows it,
 *   - a webhook delivery's `body` field now carries it inline, no separate `images` array needed,
 *   - lib/publish.ts's `withImages` now mostly SWAPS this same embedded picture's URL for the
 *     one WordPress gives it, instead of inserting a second, duplicate figure (see that
 *     function's own comment for the fallback it keeps for older articles).
 *
 *  IDEMPOTENT BY DESIGN: each embedded image is wrapped in an HTML comment pair
 *  (`<!-- image:slot -->` ... `<!-- /image:slot -->`). Re-running this (the owner's own
 *  "another image" button redoes ONE slot) finds and replaces just that slot's block, wherever
 *  it ended up, rather than leaving the old picture in place next to a new one.
 */

export type EmbeddableImage = { slot: string; anchor: string | null; url: string; alt: string };

function startMarker(slot: string): string {
  return `<!-- image:${slot} -->`;
}
function endMarker(slot: string): string {
  return `<!-- /image:${slot} -->`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The block for one image, as it is written into the body — always on its own lines, never
 *  inline with other text, which is what lets both markdown renderers (this repo has two,
 *  agent-server's own `markdownToHtml` and the dashboard's `lib/md.ts`) match it with a single,
 *  whole-line regex rather than a general (and riskier) inline-image rule. */
function imageBlock(slot: string, url: string, alt: string): string {
  // `]` inside alt text would break the markdown link/image syntax it sits in; alt text is the
  // model's own one-sentence description (lib/media/plan.ts), never user HTML, so stripping the
  // one character that matters here is enough, not a full escape.
  const safeAlt = alt.replace(/[[\]]/g, "");
  return `${startMarker(slot)}\n![${safeAlt}](${url})\n${endMarker(slot)}`;
}

/** Removes an existing block for this slot, wherever it is in the body — the redo-one-slot case.
 *  Matches loosely enough to tolerate the block having drifted slightly (an edit that added a
 *  blank line inside it, say) without matching anything outside its own two markers. */
function stripExistingBlock(body: string, slot: string): string {
  const re = new RegExp(`\\n?${escapeRe(startMarker(slot))}[\\s\\S]*?${escapeRe(endMarker(slot))}\\n?`, "g");
  return body.replace(re, "\n");
}

/** Inserts (or re-inserts) every embeddable image into the article's own markdown body.
 *
 *  - `hero` goes right after the intro — before the first `##`/`###` heading, or at the very
 *    end of the body if the article somehow has no heading at all.
 *  - each `inline_*` image goes right after the heading named in its own `anchor` — the same
 *    heading lib/media/plan.ts's gates already proved this picture actually describes. An
 *    anchor that no longer matches any heading (the article was hand-edited after the image
 *    plan ran) is skipped rather than guessed at; a picture in the wrong place is worse than no
 *    picture, the same rule lib/publish.ts's `withImages` was built on.
 *  - `thumb` and `og` are never inlined — they are the article's own cover/social image, not a
 *    picture that belongs inside the reading flow, and are returned separately so the caller can
 *    decide where a cover image belongs in its own schema.
 *
 *  Pure and synchronous: no network, no database, so it is trivial to unit-test and safe to call
 *  as many times as an image gets redone. */
export function embedImagesInBody(body: string, images: EmbeddableImage[]): { body: string; thumbnailUrl: string | null } {
  let out = body;

  const hero = images.find((i) => i.slot === "hero");
  if (hero) {
    out = stripExistingBlock(out, "hero");
    const lines = out.split("\n");
    let insertAt = lines.findIndex((l) => /^#{2,3}\s+\S/.test(l));
    if (insertAt === -1) insertAt = lines.length;
    lines.splice(insertAt, 0, imageBlock("hero", hero.url, hero.alt), "");
    out = lines.join("\n");
  }

  for (const img of images) {
    if (!img.slot.startsWith("inline") || !img.anchor) continue;
    out = stripExistingBlock(out, img.slot);
    const lines = out.split("\n");
    const anchorNorm = img.anchor.trim().toLowerCase();
    const headingIdx = lines.findIndex((l) => {
      const m = /^(#{2,3})\s+(.+?)\s*$/.exec(l);
      return !!m && m[2]!.replace(/[*_`]/g, "").trim().toLowerCase() === anchorNorm;
    });
    if (headingIdx === -1) continue; // the heading this image was made for is gone — skip, don't guess
    lines.splice(headingIdx + 1, 0, "", imageBlock(img.slot, img.url, img.alt));
    out = lines.join("\n");
  }

  const thumb = images.find((i) => i.slot === "thumb");
  return { body: out, thumbnailUrl: thumb?.url ?? null };
}
