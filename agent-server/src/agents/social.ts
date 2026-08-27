import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { completeJson } from "../lib/llm.js";
import { loadActiveProfile, type SiteProfile } from "../lib/siteProfile.js";
import { supabase } from "../supabase.js";

/** Miss Social — drafts the social posts for an article (MASTER_PLAN §7.7).
 *
 *  §7.7 IS EXPLICIT ABOUT WHAT THIS AGENT MUST NOT PRETEND TO DO. Instagram/Facebook publish
 *  needs Meta Graph API App Review — 2 to 6 weeks, business verification, a manual step
 *  (docs/MANUAL_STEPS.md). Pinterest needs its own approval. X's API is paid. LinkedIn's
 *  Marketing API is partner-only. None of that exists yet, so this agent's whole job today is
 *  what the plan calls the honest first version: "draft + image + copy/schedule" — a post
 *  someone reads, likes or edits, and pastes in themselves.
 *
 *  It does not attempt to post anywhere, does not claim to have scheduled anything, and does
 *  not pretend a network is connected when none is. The manifest's `draft_social` output is
 *  exactly that: drafts to copy, nothing more.
 *
 *  "IMAGE" — §19 (Mr. Image) has not been built. Rather than silently drop that half of the
 *  plan's sentence, each draft carries an `imageBrief`: what a photo alongside this post
 *  should show, grounded in the tenant's own offerings and proof (§16's note: "image prompt
 *  me industry sahi, social post me proof/CTA offerings se") — plain instruction for a human,
 *  or for Mr. Image the day it exists, never a generated image.
 *
 *  ONE MODEL CALL, ALL NETWORKS AT ONCE — not a call per network. The article, the voice and
 *  the proof are the same context for all four drafts, and asking once means the CTA in the
 *  LinkedIn post and the CTA in the Facebook post are provably about the same offering rather
 *  than two independent guesses that can drift apart.
 */

const NETWORKS = ["facebook", "instagram", "linkedin", "x"] as const;
type Network = (typeof NETWORKS)[number];

/** Character ceilings a draft that ignores them would just get cut off in. Not enforced by
 *  truncating — a truncated CTA is worse than an over-length one — but the model is told, and
 *  a draft that still runs over gets a warning alongside it (`overLimit`) rather than silently
 *  publishing a mid-sentence cut on the network.
 */
const LIMIT: Record<Network, number> = { facebook: 630, instagram: 2200, linkedin: 700, x: 280 };

const LABEL: Record<Network, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X (Twitter)" };

type Draft = { network: Network; text: string; hashtags: string[]; imageBrief: string };

export type { ArticleForSocial, Draft, Network };
export { NETWORKS, LIMIT, LABEL, readNetworks };

/** §7.7's promise, kept as one constant rather than a string written fresh at the return site
 *  — so the test that asserts nothing here auto-posts is asserting the exact words shipped. */
export const NO_AUTOPOST_NOTE =
  "Ye posts kahin auto-post nahi honge — Meta App Review abhi pending hai. Approve karke text copy kar lo aur khud paste kar do.";

export class SocialAgent extends Agent {
  type = "social";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const d = job.data as Record<string, any>;

    ctx.onProgress({ phase: "reading", label: "Reading the article…" });
    ctx.progress(0.1, "Reading the article");

    const article = await loadArticle(tenantId, d);
    if (!article) {
      const question = "Social posts ke liye article hi nahi mila — pehle ek article likh lo, phir uske liye social post banaunga.";
      ctx.log(question, "warn");
      return { drafted: false, question, posts: [] };
    }

    const profileRow = await loadActiveProfile(tenantId);
    const profile = profileRow?.profile ?? null;

    ctx.onProgress({ phase: "drafting", label: "Writing the posts…" });
    ctx.progress(0.35, "Writing the posts");

    const requested = readNetworks(d.networks);
    const drafts = await draftPosts(article, profile, requested, completeJson);

    ctx.onProgress({ phase: "saving", label: "Saving drafts…" });
    ctx.progress(0.75, "Saving drafts");

    const saved: { id: string; network: Network }[] = [];
    for (const post of drafts) {
      const row = await saveDraft(tenantId, article, post);
      if (row) saved.push({ id: row.id, network: post.network });
      // One at a time as they land — the workspace renders each network's card as it appears
      // rather than all four arriving in a single burst at the end (§24).
      ctx.data("post", { network: post.network, label: LABEL[post.network], text: post.text, hashtags: post.hashtags, imageBrief: post.imageBrief, overLimit: post.text.length > LIMIT[post.network] });
    }

    ctx.progress(1, "Posts drafted");

    return {
      drafted: true,
      articleTitle: article.title,
      // §7.7's own words, kept true in the output as well as in the code: nothing here posts
      // or schedules anything. approvals.status "approved" means "ready to copy", not "live".
      note: NO_AUTOPOST_NOTE,
      posts: drafts.map((p) => ({ network: p.network, text: p.text, hashtags: p.hashtags, imageBrief: p.imageBrief, overLimit: p.text.length > LIMIT[p.network] })),
      saved,
    };
  }
}

/* ---------------------------------------------------------------- reading the article ---- */

type ArticleForSocial = { id: string | null; title: string; body: string; url: string | null };

async function loadArticle(tenantId: string, d: Record<string, any>): Promise<ArticleForSocial | null> {
  const article = d.article && typeof d.article === "object" ? d.article : null;
  const inlineTitle = article?.title ?? d.title;
  const inlineBody = article?.body ?? article?.markdown ?? d.body;
  if (typeof inlineTitle === "string" && typeof inlineBody === "string" && inlineBody.trim()) {
    return { id: article?.contentItemId ?? article?.id ?? null, title: inlineTitle, body: inlineBody, url: article?.publishedUrl ?? null };
  }

  const itemId = article?.contentItemId ?? article?.id ?? d.content_item_id ?? d.contentItemId ?? null;
  if (!itemId) return null;

  const { data: item } = await supabase.from("content_items").select("id, title, body, meta").eq("id", itemId).eq("tenant_id", tenantId).maybeSingle();
  if (!item || !String(item.body ?? "").trim()) return null;

  const meta = (item.meta as Record<string, any>) ?? {};
  return { id: String(item.id), title: String(item.title ?? "Untitled"), body: String(item.body), url: meta.publishedUrl ?? null };
}

function readNetworks(raw: unknown): Network[] {
  const list = Array.isArray(raw) ? raw.map((v) => String(v).toLowerCase()) : [];
  const valid = list.filter((n): n is Network => (NETWORKS as readonly string[]).includes(n));
  // §7.7: Facebook Pages is "jo aasaan hai" — the one to lead with when nobody asked for
  // anything specific, because it is the one closest to being postable once App Review lands.
  return valid.length ? valid : [...NETWORKS];
}

/* ---------------------------------------------------------------- drafting --------------- */

type Completer = <T = any>(prompt: string) => Promise<T>;

/** Split from `run()` so it can be tested with a fake `complete` — every claim this function
 *  makes (a missing network gets a real fallback, hashtags are cleaned and capped at 5, an
 *  over-length draft is still returned rather than truncated mid-sentence) is a test on this
 *  function, not on a network call. */
export async function draftPosts(
  article: ArticleForSocial,
  profile: SiteProfile | null,
  networks: Network[],
  complete: Completer,
): Promise<Draft[]> {
  const voice = profile?.voice?.tone ? `House voice: ${profile.voice.tone}.` : "";
  const proof = (profile?.proof ?? [])
    .slice(0, 3)
    .map((p) => p.claim)
    .filter(Boolean);
  const offerings = (profile?.offerings ?? []).slice(0, 5).map((o) => o.name).filter(Boolean);
  const industry = profile?.what_they_do ? `The business: ${profile.what_they_do}` : "";

  const excerpt = article.body.replace(/\s+/g, " ").trim().slice(0, 2400);

  const prompt = [
    "Write social media posts announcing this article, one per requested network.",
    "",
    `Article title: ${article.title}`,
    `Article excerpt: ${excerpt}`,
    industry,
    voice,
    proof.length ? `Things we can prove (use verbatim if it fits, never invent a new one): ${proof.join(" · ")}` : "",
    offerings.length ? `What this business sells: ${offerings.join(", ")}` : "",
    "",
    `Networks: ${networks.join(", ")}.`,
    "Facebook: 1-3 short sentences, friendly, a clear reason to click.",
    "Instagram: a hook line, 2-4 short sentences, more casual, ends with a question or a CTA.",
    "LinkedIn: professional, states the practical takeaway in the first line, no emoji spam.",
    "X: one sentence, under 280 characters including hashtags, punchy.",
    "Each post gets its own `hashtags` (2-5, no # symbol, lowercase, relevant — not generic like #business).",
    'Each post gets an `imageBrief`: one sentence describing a real photo that would suit THIS business — never a generic stock description like "office desk" or "handshake" unless that is genuinely what the business is.',
    "Do not invent statistics, quotes, or claims not in the article or the proof list above.",
    "",
    `Reply with ONLY JSON: {"posts":[{"network":"facebook","text":"...","hashtags":["..."],"imageBrief":"..."}]}`,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await complete<{ posts?: { network?: string; text?: string; hashtags?: string[]; imageBrief?: string }[] }>(prompt);
  const byNetwork = new Map((out?.posts ?? []).map((p) => [String(p.network ?? "").toLowerCase(), p]));

  return networks.map((network) => {
    const p = byNetwork.get(network);
    const text = String(p?.text ?? "").trim() || fallbackText(network, article);
    return {
      network,
      text,
      hashtags: Array.isArray(p?.hashtags) ? p!.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 5) : [],
      imageBrief: String(p?.imageBrief ?? "").trim() || "A real photo relevant to this article — nothing generic.",
    };
  });
}

/** The model call failed to produce this network's post — still better than dropping it
 *  silently, which is how a "4 posts requested" run quietly becomes 3 with nobody told. */
function fallbackText(network: Network, article: ArticleForSocial): string {
  return network === "x" ? article.title.slice(0, 260) : `New: ${article.title}`;
}

/* ---------------------------------------------------------------- saving ------------------ */

async function saveDraft(tenantId: string, article: ArticleForSocial, post: Draft): Promise<{ id: string } | null> {
  const body = post.hashtags.length ? `${post.text}\n\n${post.hashtags.map((h) => `#${h}`).join(" ")}` : post.text;
  const { data, error } = await supabase
    .from("content_items")
    .insert({
      tenant_id: tenantId,
      type: "social",
      status: "awaiting_approval",
      title: `${LABEL[post.network]} post — ${article.title}`,
      body,
      meta: {
        network: post.network,
        imageBrief: post.imageBrief,
        sourceArticleId: article.id,
        sourceArticleTitle: article.title,
        sourceArticleUrl: article.url,
        // Read by /api/content/[id]/approve — a social item is never actually published
        // anywhere by this codebase, so approving one must not call publishContentItem.
        copyOnly: true,
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[social] could not save a draft:", error.message);
    return null;
  }
  return { id: String(data.id) };
}
