import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { completeJson } from "../lib/llm.js";
import { loadActiveProfile } from "../lib/siteProfile.js";
import { imagesForArticle, saveImage, type StoredImage } from "../lib/media/store.js";
import { toShape, overlayHeadline, templateCard, type Variant } from "../lib/media/render.js";
import { renderStory, validateStory, type StoryPage } from "../lib/media/story.js";
import { ImageAgent } from "./image.js";
import { supabase } from "../supabase.js";

/** Mr. Story — the article as a Web Story (MASTER_PLAN §19.4.5, §19.2).
 *
 *  THE ECONOMICS, WHICH ARE THE DESIGN. §19.2 originally said "send Mr. Image 6-8 portrait
 *  briefs". A free Cloudflare account is about 57 images a DAY for the whole platform, so one
 *  story would have eaten a seventh of it. The owner's instruction (2026-09-05) fixed it:
 *  "jo thumbnail ka image ya jo article pe image hai uska hi reuse karunga, but 1-2 image jo
 *  web story pe first dikhai dega wo AI se generate karwayenge".
 *
 *  So a story costs TWO new pictures:
 *    · page 1, the cover — the only image Discover's carousel ever shows;
 *    · page 2, the hook — the first thing a reader sees after tapping.
 *  Every other page re-crops the article's OWN images out of the `media` table (§19.4.5), and
 *  the last page is a template call-to-action. Nothing random is ever pulled in: if the
 *  article has fewer pictures than the story has pages, the same picture comes back at a
 *  different crop rather than a stranger's photograph appearing in the middle of it.
 *
 *  WHO WRITES THE BRIEF. This agent does, for its own two pictures, and hands them to Mr.
 *  Image to draw exactly as written (image.ts's renderBriefs). That is §19.4.3's rule —
 *  whoever owns the content owns the brief — and it is why Mr. Image has a render-only path
 *  at all.
 *
 *  IT WILL NOT PUBLISH SOMETHING GOOGLE WILL REFUSE. The AMP is validated before it is filed;
 *  an invalid story is reported as one, never quietly shipped, because an invalid Web Story
 *  gets no carousel place at all and the carousel is the entire point.
 */

/** §19.2: 6-8 pages. Two are always ours (cover, hook) and one is always the CTA. */
const MIN_PAGES = 5;
const MAX_PAGES = 8;

type OutlinePage = { headline: string; body: string; imageIntent: string };

export class StoryAgent extends Agent {
  type = "story";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const d = job.data as Record<string, any>;
    const articleId = String(d.article?.contentItemId ?? d.article?.id ?? d.articleId ?? d.itemId ?? "");
    if (!articleId) return { made: false, question: "I need to know which article the story is for.", pages: 0 };

    ctx.onProgress({ phase: "reading", label: "Reading the article…", at: new Date().toISOString() });
    const article = await loadArticle(tenantId, articleId);
    if (!article) return { made: false, question: "That article isn't on file, so there's nothing to turn into a story.", pages: 0 };

    const profileRow = await loadActiveProfile(tenantId).catch(() => null);
    const profile = (profileRow?.profile as any) ?? null;
    const brandName = (profile?.what_they_do ?? "").split(/[.,]/)[0]?.trim() || "Our blog";
    const brandColor = (profile?.voice as any)?.brand_color || undefined;

    // ── 1 · the outline ────────────────────────────────────────────────────────────────
    ctx.onProgress({ phase: "outline", label: "Planning the pages…", at: new Date().toISOString() });
    const outline = await this.outline(article, ctx);
    ctx.log(`Story outline: ${outline.length} page(s).`);

    // ── 2 · the article's own pictures, for the body pages ─────────────────────────────
    const existing = await imagesForArticle(articleId);
    const reusable = existing.filter((i) => i.slot !== "og").sort(bySlotOrder);
    ctx.log(reusable.length ? `Reusing ${reusable.length} of the article's own images.` : "The article has no images on file — the body pages will be branded cards.");

    // ── 3 · the two new ones, briefed here and drawn by Mr. Image ──────────────────────
    ctx.onProgress({ phase: "cover", label: "Making the cover and the opening picture…", at: new Date().toISOString() });
    ctx.progress(0.4, "Making the cover");
    const briefs = [
      {
        slot: "story_cover",
        shape: "story",
        style: profile ? undefined : "photo",
        // The cover is a portrait composition on purpose: a landscape scene cropped to 9:16
        // loses its subject, and this is the one image Discover shows.
        subject: `${outline[0]?.imageIntent || article.title} — a tall, vertical composition with the subject centred and space above it`,
        depicts: outline[0]?.imageIntent || article.title,
        alt: outline[0]?.headline || article.title,
        headline: outline[0]?.headline || article.title,
      },
      {
        slot: "story_hook",
        shape: "story",
        subject: `${outline[1]?.imageIntent || article.title} — a tall, vertical composition`,
        depicts: outline[1]?.imageIntent || article.title,
        alt: outline[1]?.headline || article.title,
        headline: outline[1]?.headline || article.title,
      },
    ];
    const drawn = await new ImageAgent().renderBriefs(tenantId, { briefs, articleId, bump: Number(d.bump) || 0 }, ctx);
    const newImages = new Map((drawn.images ?? []).map((i: any) => [String(i.slot), String(i.url)]));

    // ── 4 · every page gets a picture, and every picture is accounted for ──────────────
    ctx.onProgress({ phase: "pages", label: "Building the pages…", at: new Date().toISOString() });
    ctx.progress(0.7, "Building the pages");
    const pages: StoryPage[] = [];
    for (const [i, page] of outline.entries()) {
      const isCta = i === outline.length - 1;
      const image = await this.pictureFor({ tenantId, articleId, index: i, page, newImages, reusable, brandName, brandColor, title: article.title });
      pages.push({
        headline: page.headline,
        body: isCta ? undefined : page.body,
        image: image.url,
        alt: image.alt,
        ...(isCta && article.url ? { cta: { text: "Read the full article", href: article.url } } : {}),
      });
    }

    // ── 5 · the AMP, and the check that it is real AMP ─────────────────────────────────
    ctx.onProgress({ phase: "render", label: "Writing the story page…", at: new Date().toISOString() });
    const canonical = article.url || `${profile?.website_url ?? ""}`.trim() || "";
    const html = renderStory({
      title: article.title,
      canonical: canonical || "about:blank",
      publisher: brandName,
      publisherLogo: newImages.get("story_cover") ?? pages[0].image,
      poster: pages[0].image,
      brandColor,
      pages,
    });
    const check = await validateStory(html, pages);
    if (!check.ok) ctx.log(`The story is not valid AMP yet: ${check.errors.slice(0, 3).join("; ")}`, "warn");
    else ctx.log(`Valid AMP (${check.checkedBy === "amphtml-validator" ? "checked with Google's own validator" : "structural checks only — the validator's ruleset could not be fetched"}).`);

    // ── 6 · its own reviewable item (§19.4.7) ──────────────────────────────────────────
    const storyId = await fileForReview(tenantId, article, pages, html, check, canonical);

    ctx.progress(1, `${pages.length}-page story ready`);
    return {
      made: true,
      articleId,
      storyId,
      pages: pages.length,
      valid: check.ok,
      validatedBy: check.checkedBy,
      errors: check.errors.slice(0, 5),
      generated: (drawn.images ?? []).filter((i: any) => i.provider !== "template").length,
      reused: pages.length - 2 - 1,
    };
  }

  /** 6-8 pages from the article. A model that will not answer does not stop the story: the
   *  article's own headings are a perfectly good outline, and using them is honest. */
  private async outline(article: LoadedArticle, ctx: AgentContext): Promise<OutlinePage[]> {
    const want = Math.max(MIN_PAGES, Math.min(MAX_PAGES, article.sections.length + 3));
    const prompt = [
      "Turn this article into a Web Story: a sequence of full-screen phone pages, each a picture with a line of text over it.",
      "",
      `TITLE: ${article.title}`,
      `INTRO: ${article.intro.slice(0, 400)}`,
      "SECTIONS:",
      article.sections.slice(0, 8).map((s, i) => `${i + 1}. ${s.heading} — ${s.text.replace(/\s+/g, " ").slice(0, 200)}`).join("\n"),
      "",
      `Give exactly ${want} pages.`,
      "- page 1 is the cover: the promise of the article in at most 8 words.",
      "- the last page asks the reader to read the full article.",
      "- every headline: 8 words or fewer. Every body: 25 words or fewer. They are read on a phone, over a picture.",
      "- imageIntent: what a picture for THAT page should show, in a few words, taken from the article — never a stock cliché.",
      "",
      'Reply with ONLY JSON: {"pages":[{"headline":"","body":"","imageIntent":""}]}',
    ].join("\n");

    try {
      const out = await completeJson<{ pages?: OutlinePage[] }>(prompt);
      const pages = (out?.pages ?? [])
        .map((p) => ({
          headline: trim(String(p?.headline ?? ""), 12),
          body: trim(String(p?.body ?? ""), 30),
          imageIntent: String(p?.imageIntent ?? "").trim(),
        }))
        .filter((p) => p.headline);
      if (pages.length >= MIN_PAGES) return pages.slice(0, MAX_PAGES);
      ctx.log(`The outline came back with only ${pages.length} usable page(s) — using the article's own headings instead.`, "warn");
    } catch (e: any) {
      ctx.log(`The outline call failed (${e?.message ?? e}) — using the article's own headings instead.`, "warn");
    }
    return this.fallbackOutline(article, want);
  }

  /** The article's title, its headings and a closing page. Every word comes from the article,
   *  so this is a plainer story, never a wrong one. */
  private fallbackOutline(article: LoadedArticle, want: number): OutlinePage[] {
    const pages: OutlinePage[] = [{ headline: trim(article.title, 12), body: trim(article.intro, 30), imageIntent: article.title }];
    for (const s of article.sections.slice(0, want - 2)) {
      pages.push({ headline: trim(s.heading, 12), body: trim(s.text, 30), imageIntent: s.heading });
    }
    pages.push({ headline: "Read the full guide", body: "", imageIntent: article.title });
    return pages.slice(0, MAX_PAGES);
  }

  /** Cover and hook are the new pictures; the middle pages re-crop the article's own; the last
   *  page is a branded card. When the article has fewer images than pages, the same picture
   *  comes back at a different crop — never a picture from somewhere else. */
  private async pictureFor(input: {
    tenantId: string;
    articleId: string;
    index: number;
    page: OutlinePage;
    newImages: Map<string, string>;
    reusable: StoredImage[];
    brandName: string;
    brandColor?: string;
    title: string;
  }): Promise<{ url: string; alt: string }> {
    const { index, page, newImages, reusable } = input;
    const slot = `story_p${index + 1}`;

    if (index === 0 && newImages.get("story_cover")) return { url: newImages.get("story_cover")!, alt: page.headline };
    if (index === 1 && newImages.get("story_hook")) return { url: newImages.get("story_hook")!, alt: page.headline };

    // Body pages: the article's own images, in order, re-cropped to portrait with the page's
    // own line over them. The variant changes each time round the list, so a story with more
    // pages than pictures does not look like the same slide four times.
    const bodyIndex = Math.max(0, index - 2);
    if (reusable.length) {
      const source = reusable[bodyIndex % reusable.length];
      const variant = (Math.floor(bodyIndex / reusable.length) % 3) as Variant;
      try {
        const bytes = await fetchImage(source.url);
        const shaped = await toShape(bytes, "story", variant);
        const withText = await overlayHeadline(shaped.webp, page.headline, { color: input.brandColor, name: input.brandName });
        const stored = await saveImage({
          tenantId: input.tenantId,
          articleId: input.articleId,
          slot,
          webp: withText,
          width: shaped.width,
          height: shaped.height,
          anchor: source.anchor,
          alt: page.headline,
          prompt: null,
          seed: null,
          // Not "template" and not a provider either — this is the article's own picture, used
          // again. Recorded as such so the day's AI budget is not charged for it.
          provider: "reuse",
          providerAccount: null,
          neurons: 0,
          attribution: null,
        });
        return { url: stored.url, alt: page.headline };
      } catch {
        /* fall through to a card — a page without a picture is not a page */
      }
    }

    const card = await templateCard(page.headline || input.title, "story", { color: input.brandColor, name: input.brandName });
    const stored = await saveImage({
      tenantId: input.tenantId,
      articleId: input.articleId,
      slot,
      webp: card.webp,
      width: card.width,
      height: card.height,
      anchor: null,
      alt: page.headline || input.title,
      prompt: null,
      seed: null,
      provider: "template",
      providerAccount: null,
      neurons: 0,
      attribution: null,
    });
    return { url: stored.url, alt: page.headline || input.title };
  }
}

/* ---------------------------------------------------------------- helpers --------------- */

function bySlotOrder(a: StoredImage, b: StoredImage): number {
  const rank = (s: string) => (s === "hero" ? 0 : s === "thumb" ? 1 : s.startsWith("inline") ? 2 : 3);
  return rank(a.slot) - rank(b.slot) || a.slot.localeCompare(b.slot);
}

/** Words, not characters: a headline is read at a glance and a mid-word cut reads as a bug. */
function trim(text: string, words: number): string {
  const parts = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return parts.length <= words ? parts.join(" ") : parts.slice(0, words).join(" ") + "…";
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`could not read ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

type LoadedArticle = { id: string; title: string; intro: string; sections: { heading: string; text: string }[]; url: string | null };

async function loadArticle(tenantId: string, articleId: string): Promise<LoadedArticle | null> {
  const { data } = await supabase.from("content_items").select("id, title, body, meta").eq("id", articleId).eq("tenant_id", tenantId).maybeSingle();
  if (!data || !String(data.body ?? "").trim()) return null;
  const body = String(data.body);
  const lines = body.split(/\r?\n/);
  const sections: { heading: string; text: string }[] = [];
  const intro: string[] = [];
  let current: { heading: string; text: string } | null = null;
  for (const line of lines) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[2].replace(/[*_`]/g, "").trim(), text: "" };
      continue;
    }
    if (current) current.text += (current.text ? "\n" : "") + line;
    else intro.push(line);
  }
  if (current) sections.push(current);
  return {
    id: String(data.id),
    title: String(data.title ?? "Untitled"),
    intro: intro.join(" ").replace(/^#\s+.*$/m, "").trim(),
    sections: sections.filter((s) => s.heading),
    url: ((data.meta as any)?.publishedUrl as string) ?? null,
  };
}

/** The story as its own reviewable item, beside the article and its images (§19.4.7). The AMP
 *  itself is the body, so a reviewer (and a later publish step) has the exact bytes. */
async function fileForReview(
  tenantId: string,
  article: LoadedArticle,
  pages: StoryPage[],
  html: string,
  check: { ok: boolean; errors: string[]; checkedBy: string },
  canonical: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("content_items")
    .insert({
      tenant_id: tenantId,
      type: "web_story",
      status: "awaiting_approval",
      title: `Web Story — ${article.title}`,
      body: html,
      blueprint: { parent_article_id: article.id },
      meta: {
        pages: pages.map((p) => ({ headline: p.headline, body: p.body ?? "", image: p.image })),
        canonical,
        ampValid: check.ok,
        ampCheckedBy: check.checkedBy,
        ampErrors: check.errors.slice(0, 10),
      },
    })
    .select("id")
    .single();
  if (error) {
    console.error("[story] the story was built but the review card could not be filed:", error.message);
    return null;
  }
  return String(data.id);
}
