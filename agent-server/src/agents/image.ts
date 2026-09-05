import { randomUUID } from "node:crypto";
import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { loadActiveProfile } from "../lib/siteProfile.js";
import { planImages, buildPrompt, seedFor, type ImageSlot, type ArticleSection } from "../lib/media/plan.js";
import { generateImage, NoProviderAnswered } from "../lib/media/providers.js";
import { toShape, templateCard, contentCard, type Shape } from "../lib/media/render.js";
import { saveImage, generatedToday, type StoredImage } from "../lib/media/store.js";
import { capFor } from "../config/caps.js";
import { supabase } from "../supabase.js";

/** Mr. Image — the pictures that go with an article (MASTER_PLAN §19.4).
 *
 *  THE THREE PROMISES THIS AGENT KEEPS, in the owner's own words (2026-09-05):
 *
 *   1. "har article pe min 2 image hoga" — a thumbnail and a hero, always, whatever else
 *      happens. Longer articles get up to three more, one per section (lib/media/plan.ts's
 *      ladder). The floor is not a target; it is a floor.
 *
 *   2. "jis chiz ke upar article/paragraph hai usi pe image ho — random nahi" — every inline
 *      picture is bound to a real heading of this article, and the binding is CHECKED by code,
 *      not taken from the model (plan.ts's three gates). A brief that describes nothing in the
 *      section is refused, and that section gets a card made of its own words instead.
 *
 *   3. An article is never left without images. The ladder runs Cloudflare → NVIDIA → stock →
 *      a template card drawn here with no network at all, so "the provider was down" produces
 *      a plainer picture, never a hole and never a failed job.
 *
 *  WHAT IT WILL NOT DO. It will not invent a fact in a picture. A section explaining a map, a
 *  chart or a set of figures does not go to the image model at all — a diffusion model draws a
 *  convincing WRONG map — it gets a card carrying that section's real lines (§19.4.3).
 *
 *  TWO ACTIONS, because who writes the brief is the whole design:
 *   · make_images  — for an article. The brief is written here, from the article + Site Brain.
 *   · render_images — for a caller who already knows what it wants (Mr. Story, Miss Social).
 *     Their briefs are rendered as given; this agent changes not one word of them.
 */

/** Which shape each slot is rendered at. */
const SHAPE_FOR: Record<string, Shape> = { thumb: "thumb", og: "og", hero: "hero", inline_1: "inline", inline_2: "inline", inline_3: "inline" };

export type ImageResultRow = StoredImage & { kind: string; note?: string; fellBackTo?: string };

export class ImageAgent extends Agent {
  type = "image";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const d = job.data as Record<string, any>;

    // render_images: a caller's own briefs, rendered as given (§19.4.3).
    if (Array.isArray(d.briefs) && d.briefs.length) return this.renderBriefs(tenantId, d, ctx);

    // make_image: one picture, on its own. "Sirf image banane bole to image hi bana ke de"
    // (owner, 2026-09-05) — no article is written, none is looked for, and the subject is the
    // user's own words rather than anything this agent invented for them.
    const subject = String(d.subject ?? "").trim();
    if (subject && !d.article && !d.articleId && !d.itemId) return this.oneOffImage(tenantId, subject, d, ctx);

    // The brain threads Mr. Writer's whole output in under the need's name (`article`), while a
    // direct enqueue passes an id. Both are accepted; neither is guessed.
    const articleId = String(d.article?.contentItemId ?? d.article?.id ?? d.articleId ?? d.article_id ?? d.itemId ?? "");
    if (!articleId) {
      // Returned, not thrown: nothing here is retryable and the fix is a caller passing an id.
      return { made: false, question: "I need to know which article the images are for.", images: [] };
    }

    ctx.onProgress({ phase: "reading", label: "Reading the article…", at: new Date().toISOString() });
    const article = await loadArticle(tenantId, articleId);
    if (!article) return { made: false, question: "That article isn't on file, so there's nothing to illustrate.", images: [] };

    const profileRow = await loadActiveProfile(tenantId).catch(() => null);
    const profile = (profileRow?.profile as any) ?? null;
    const brand = { color: (profile?.voice as any)?.brand_color || undefined, name: (profile?.what_they_do ?? "").split(/[.,]/)[0]?.trim() || undefined };

    ctx.onProgress({ phase: "planning", label: "Deciding what each picture should show…", at: new Date().toISOString() });
    const plan = await planImages(article, profile);
    ctx.log(`Planned ${plan.slots.length} image(s): ${plan.slots.map((s) => `${s.slot}${s.anchor ? ` → "${s.anchor}"` : ""}${s.kind === "card" ? " (card)" : ""}`).join(", ")}`);

    // The day's remaining allowance, counted from what was actually generated (store.ts), not
    // from how many jobs ran. Cards do not count — they cost nothing.
    const plan_ = await tenantPlan(tenantId);
    const cap = capFor("image", plan_.plan, plan_.overrides);
    const usedToday = await generatedToday(tenantId);
    let budget = cap === null ? Number.POSITIVE_INFINITY : Math.max(0, cap - usedToday);
    if (cap !== null) ctx.log(`Image budget today: ${usedToday}/${cap} used${budget === 0 ? " — this article's pictures will be template cards" : ""}.`);

    // "Another image" on ONE picture (the Approvals card's per-image button, §19.4.7): only
    // that slot is redone, at seed + bump, and every other image on the article is left exactly
    // as it is — a regenerate must never quietly change the four pictures nobody complained
    // about, and it must not spend four more of the day's allowance either.
    const onlySlot = String(d.slot ?? "").trim();
    const slotsToDo = onlySlot ? plan.slots.filter((s) => s.slot === onlySlot) : plan.slots;
    if (onlySlot && !slotsToDo.length) {
      return { made: false, question: `This article has no "${onlySlot}" image to redo.`, images: [] };
    }

    const out: ImageResultRow[] = [];
    let generated = 0;
    let fallbacks = 0;

    for (const [i, slot] of slotsToDo.entries()) {
      ctx.onProgress({ phase: "rendering", label: `Making ${slot.slot}…`, done: i, total: slotsToDo.length, at: new Date().toISOString() });
      const row = await this.oneSlot({ tenantId, article, slot, plan, profile, brand, budget, bump: Number(d.bump) || 0 }, ctx);
      if (row.provider !== "template") {
        generated++;
        budget -= 1;
      } else if (slot.kind !== "card") {
        fallbacks++;
      }
      out.push(row);
      ctx.data("image", { slot: row.slot, url: row.url, alt: row.alt, anchor: row.anchor, provider: row.provider });
    }

    // The images are their own reviewable thing (§19.4.7) — approved, regenerated or rejected
    // without touching the article. A single-slot redo updates the card that already exists
    // rather than filing a second one next to it.
    const setId = onlySlot ? await updateReview(tenantId, article, out) : await fileForReview(tenantId, article, out);

    ctx.progress(1, `${out.length} image(s) ready`);
    return {
      made: true,
      articleId,
      imageSetId: setId,
      images: out.map((r) => ({ slot: r.slot, url: r.url, alt: r.alt, anchor: r.anchor, provider: r.provider, kind: r.kind, note: r.note })),
      generated,
      fallbacks,
      budgetLeft: Number.isFinite(budget) ? budget : null,
    };
  }

  /** One picture, asked for directly. The whole ladder still applies (Cloudflare → NVIDIA →
   *  stock → a branded card), so this never comes back empty-handed, and it is filed the same
   *  way an article's images are — a card in Approvals — so there is one place to look. */
  private async oneOffImage(tenantId: string, subject: string, d: Record<string, any>, ctx: AgentContext) {
    const profileRow = await loadActiveProfile(tenantId).catch(() => null);
    const profile = (profileRow?.profile as any) ?? null;
    const brand = { color: (profile?.voice as any)?.brand_color || undefined, name: (profile?.what_they_do ?? "").split(/[.,]/)[0]?.trim() || undefined };
    const style: "photo" | "illustration" = d.style === "illustration" ? "illustration" : "photo";
    const shape: Shape = (["thumb", "og", "hero", "inline", "story"] as const).includes(d.shape) ? (d.shape as Shape) : "hero";

    // Budgeted like any other picture: a one-off must not be a way around the day's allowance.
    const plan_ = await tenantPlan(tenantId);
    const cap = capFor("image", plan_.plan, plan_.overrides);
    const usedToday = await generatedToday(tenantId);
    if (cap !== null && usedToday >= cap) {
      return {
        made: false,
        question: `Aaj ka image budget khatam ho gaya (${usedToday}/${cap}). Kal UTC midnight pe reset hota hai — ya Cloudflare ka doosra account CLOUDFLARE_ACCOUNTS me jod dijiye.`,
        images: [],
      };
    }

    // A one-off gets its own id, so asking for the same thing twice gives two pictures rather
    // than silently overwriting the first — the seed is what makes an ARTICLE's images stable,
    // and that reasoning does not apply to a picture somebody just asked for.
    const setId = randomUUID();
    ctx.onProgress({ phase: "rendering", label: "Making the picture…", done: 0, total: 1, at: new Date().toISOString() });

    const drawn = await this.renderBriefs(
      tenantId,
      { briefs: [{ slot: `oneoff_${setId.slice(0, 8)}`, shape, style, subject, depicts: subject, alt: subject.slice(0, 120), headline: subject.slice(0, 80) }], bump: Number(d.bump) || 0 },
      ctx,
    );
    const image = drawn.images?.[0];
    if (!image) return { made: false, question: "The picture could not be made this time. Try again in a moment.", images: [] };

    // Filed as an image_set with no parent article — it belongs to nothing but itself, and the
    // Approvals card renders it the same way.
    const { data, error } = await supabase
      .from("content_items")
      .insert({
        tenant_id: tenantId,
        type: "image_set",
        status: "awaiting_approval",
        title: `Image — ${subject.slice(0, 80)}`,
        body: subject,
        blueprint: { standalone: true },
        meta: { standalone: true, subject, images: [{ slot: image.slot, url: image.url, alt: image.alt, anchor: null, provider: image.provider, kind: style }] },
      })
      .select("id")
      .single();
    if (error) console.error("[image] the picture was made but the review card could not be filed:", error.message);

    ctx.progress(1, "Picture ready");
    return {
      made: true,
      url: image.url,
      imageSetId: data ? String(data.id) : null,
      subject,
      provider: image.provider,
      images: [image],
    };
  }

  /** One slot, all the way from "what should this be" to a filed row. Never throws: whatever
   *  goes wrong, a template card is still an image. */
  private async oneSlot(
    input: {
      tenantId: string;
      article: LoadedArticle;
      slot: ImageSlot;
      plan: { style: "photo" | "illustration" };
      profile: any;
      brand: { color?: string; name?: string };
      budget: number;
      bump: number;
    },
    ctx: AgentContext,
  ): Promise<ImageResultRow> {
    const { tenantId, article, slot, brand } = input;
    const shape = SHAPE_FOR[slot.slot] ?? "inline";
    const save = (webp: Buffer, width: number, height: number, provider: string, extra: Partial<Parameters<typeof saveImage>[0]> = {}) =>
      saveImage({
        tenantId,
        articleId: article.id,
        slot: slot.slot,
        webp,
        width,
        height,
        anchor: slot.anchor,
        alt: slot.alt,
        prompt: null,
        seed: null,
        provider,
        providerAccount: null,
        neurons: 0,
        attribution: null,
        ...extra,
      });

    // A card is not a picture request at all — it is this section's own words, drawn.
    if (slot.kind === "card" && slot.card) {
      const card = await contentCard(slot.anchor ?? article.title, slot.card.lines, slot.card.type, shape, brand);
      const stored = await save(card.webp, card.width, card.height, "template");
      return { ...stored, kind: "card", note: slot.note };
    }

    if (input.budget <= 0) {
      const card = await templateCard(slot.anchor ?? article.title, shape, brand);
      const stored = await save(card.webp, card.width, card.height, "template");
      return { ...stored, kind: "template", note: "today's image budget is used up — this is a branded card, and the next run will make a picture" };
    }

    const prompt = buildPrompt(slot.subject, input.plan.style, input.profile);
    const seed = seedFor(article.id, slot.slot, input.bump);
    try {
      const image = await generateImage(prompt, seed, {
        // The article pipeline waits on this, so the two-minute NVIDIA queue is not an option
        // here; a story or a backfill can pass allowSlow itself.
        allowSlow: false,
        allowStock: input.plan.style === "photo",
        stockQuery: slot.depicts || slot.subject,
      });
      const shaped = await toShape(image.bytes, shape);
      const stored = await save(shaped.webp, shaped.width, shaped.height, image.provider, {
        prompt,
        seed,
        providerAccount: image.account,
        neurons: image.neurons,
        attribution: image.attribution,
      });
      return { ...stored, kind: slot.kind };
    } catch (e: any) {
      const why = e instanceof NoProviderAnswered ? e.tried.join("; ") : String(e?.message ?? e);
      ctx.log(`No picture for ${slot.slot} — ${why}. Using a branded card instead.`, "warn");
      const card = await templateCard(slot.anchor ?? article.title, shape, brand);
      const stored = await save(card.webp, card.width, card.height, "template");
      return { ...stored, kind: "template", note: why, fellBackTo: "template" };
    }
  }

  /** The caller wrote the briefs, this only draws them (§19.4.3). Used by Mr. Story for its
   *  cover and hook pages, and by Miss Social for a post's own image.
   *
   *  PUBLIC and called in-process, not through the queue: Mr. Story needs the pictures BEFORE
   *  it can render its AMP page, and a fire-and-forget job would hand it nothing to render.
   *  The agents already run in one process (brain/adapter.ts), so this is a direct call the
   *  same way the crawler reaches the analyst — and it is still "the caller writes the brief,
   *  Mr. Image only draws it", which is the whole point of the split. */
  async renderBriefs(tenantId: string, d: Record<string, any>, ctx: AgentContext) {
    const profileRow = await loadActiveProfile(tenantId).catch(() => null);
    const profile = (profileRow?.profile as any) ?? null;
    const brand = { color: (profile?.voice as any)?.brand_color || undefined, name: (profile?.what_they_do ?? "").split(/[.,]/)[0]?.trim() || undefined };
    const articleId = d.articleId ? String(d.articleId) : null;
    const out: ImageResultRow[] = [];

    for (const [i, raw] of (d.briefs as any[]).entries()) {
      const slot = String(raw?.slot ?? `given_${i + 1}`);
      const shape: Shape = (raw?.shape as Shape) ?? "story";
      const subject = String(raw?.subject ?? "").trim();
      const alt = String(raw?.alt ?? "").trim() || subject.slice(0, 120);
      const style: "photo" | "illustration" = raw?.style === "illustration" ? "illustration" : "photo";
      ctx.onProgress({ phase: "rendering", label: `Making ${slot}…`, done: i, total: d.briefs.length, at: new Date().toISOString() });

      const prompt = buildPrompt(subject, style, profile);
      const seed = seedFor(String(articleId ?? tenantId), slot, Number(d.bump) || 0);
      try {
        if (!subject) throw new Error("the brief had no subject");
        const image = await generateImage(prompt, seed, { allowSlow: !!d.allowSlow, allowStock: style === "photo", stockQuery: String(raw?.depicts ?? subject) });
        const shaped = await toShape(image.bytes, shape);
        const stored = await saveImage({
          tenantId,
          articleId,
          slot,
          webp: shaped.webp,
          width: shaped.width,
          height: shaped.height,
          anchor: raw?.anchor ? String(raw.anchor) : null,
          alt,
          prompt,
          seed,
          provider: image.provider,
          providerAccount: image.account,
          neurons: image.neurons,
          attribution: image.attribution,
        });
        out.push({ ...stored, kind: style });
      } catch (e: any) {
        const why = e instanceof NoProviderAnswered ? e.tried.join("; ") : String(e?.message ?? e);
        const card = await templateCard(String(raw?.headline ?? alt ?? "").slice(0, 120), shape, brand);
        const stored = await saveImage({
          tenantId,
          articleId,
          slot,
          webp: card.webp,
          width: card.width,
          height: card.height,
          anchor: raw?.anchor ? String(raw.anchor) : null,
          alt,
          prompt: null,
          seed: null,
          provider: "template",
          providerAccount: null,
          neurons: 0,
          attribution: null,
        });
        out.push({ ...stored, kind: "template", note: why, fellBackTo: "template" });
      }
      ctx.data("image", { slot, url: out[out.length - 1].url, alt });
    }

    ctx.progress(1, `${out.length} image(s) ready`);
    return { made: true, images: out.map((r) => ({ slot: r.slot, url: r.url, alt: r.alt, provider: r.provider })) };
  }
}

/* ---------------------------------------------------------------- the article ----------- */

type LoadedArticle = { id: string; title: string; intro: string; sections: ArticleSection[]; wordCount: number };

/** The article as the image planner needs it: its title, its opening, and its sections split
 *  on the markdown headings the writer actually produced. */
async function loadArticle(tenantId: string, articleId: string): Promise<LoadedArticle | null> {
  const { data } = await supabase.from("content_items").select("id, title, body, meta").eq("id", articleId).eq("tenant_id", tenantId).maybeSingle();
  if (!data || !String(data.body ?? "").trim()) return null;
  const body = String(data.body);
  const meta = (data.meta as Record<string, any>) ?? {};
  const { intro, sections } = splitSections(body);
  return {
    id: String(data.id),
    title: String(data.title ?? "Untitled"),
    intro,
    sections,
    wordCount: Number(meta.wordCount) || body.split(/\s+/).filter(Boolean).length,
  };
}

/** Markdown H2/H3 → sections. Everything before the first heading is the intro. Exported for
 *  the tests: the anchor gate is only as good as the headings it is given. */
export function splitSections(markdown: string): { intro: string; sections: ArticleSection[] } {
  const lines = markdown.split(/\r?\n/);
  const sections: ArticleSection[] = [];
  let intro: string[] = [];
  let current: ArticleSection | null = null;
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
    intro: intro.join("\n").replace(/^#\s+.*$/m, "").trim(),
    sections: sections.filter((s) => s.heading),
  };
}

/* ---------------------------------------------------------------- review ---------------- */

/** The image set as its own reviewable item (§19.4.7): the customer approves, regenerates or
 *  rejects the pictures without that touching the article's own approval. */
async function fileForReview(tenantId: string, article: LoadedArticle, images: ImageResultRow[]): Promise<string | null> {
  const { data, error } = await supabase
    .from("content_items")
    .insert({
      tenant_id: tenantId,
      type: "image_set",
      status: "awaiting_approval",
      title: `Images — ${article.title}`,
      body: images.map((i) => `${i.slot}${i.anchor ? ` (${i.anchor})` : ""}: ${i.alt}`).join("\n"),
      blueprint: { parent_article_id: article.id },
      meta: {
        images: images.map((i) => ({ slot: i.slot, url: i.url, alt: i.alt, anchor: i.anchor, provider: i.provider, kind: i.kind, note: i.note, width: i.width, height: i.height })),
      },
    })
    .select("id")
    .single();
  if (error) {
    // The pictures exist and are filed in `media` either way — losing the review card is worth
    // a loud log, not throwing away the work.
    console.error("[image] images made, but the review card could not be filed:", error.message);
    return null;
  }
  return String(data.id);
}

/** One slot was redone: swap that image into the review card the customer is looking at,
 *  leaving every other image (and the card's own status) alone. */
async function updateReview(tenantId: string, article: LoadedArticle, redone: ImageResultRow[]): Promise<string | null> {
  const { data } = await supabase
    .from("content_items")
    .select("id, meta")
    .eq("tenant_id", tenantId)
    .eq("type", "image_set")
    .eq("blueprint->>parent_article_id", article.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const meta = (data.meta as Record<string, any>) ?? {};
  const existing: any[] = Array.isArray(meta.images) ? meta.images : [];
  const bySlot = new Map(existing.map((i: any) => [String(i.slot), i]));
  for (const r of redone) {
    bySlot.set(r.slot, { slot: r.slot, url: r.url, alt: r.alt, anchor: r.anchor, provider: r.provider, kind: r.kind, note: r.note, width: r.width, height: r.height });
  }
  const images = [...bySlot.values()];
  const { error } = await supabase
    .from("content_items")
    .update({ meta: { ...meta, images }, body: images.map((i: any) => `${i.slot}${i.anchor ? ` (${i.anchor})` : ""}: ${i.alt}`).join("\n") })
    .eq("id", data.id);
  if (error) console.error("[image] the redone picture was saved but the review card was not updated:", error.message);
  return String(data.id);
}

/** The tenant's plan and any per-tenant override — same source jobsLog.ts reads for job caps. */
async function tenantPlan(tenantId: string): Promise<{ plan: string; overrides: Record<string, unknown> }> {
  const { data, error } = await supabase.from("tenants").select("plan, daily_cap_overrides").eq("id", tenantId).single();
  if (error) return { plan: "starter", overrides: {} };
  return { plan: (data as any)?.plan ?? "free", overrides: ((data as any)?.daily_cap_overrides as any) ?? {} };
}
