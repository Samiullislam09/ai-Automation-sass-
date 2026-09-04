import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { publishContentItem, type PublishImage } from "../lib/publish.js";
import { supabase } from "../supabase.js";

/** Mr. Publish — the only agent that touches the customer's live website.
 *
 *  Everything here exists because this step is the one that cannot be quietly undone. A bad
 *  keyword costs a few seconds; a bad publish is a page on a real business's site, indexed by
 *  Google, seen by their customers. So this agent is deliberately the most suspicious one in
 *  the building:
 *
 *   1. It refuses to publish a draft that failed its quality gate, whatever anyone asked for.
 *   2. It refuses to publish twice — a content item already marked published is left alone,
 *      and the existing URL is returned instead of a second post.
 *   3. It VERIFIES: after WordPress says "created", the URL is fetched and must answer 200
 *      and contain the title. "The API returned 201" and "there is a page there" are not the
 *      same claim, and only the second one is worth telling a user.
 *   4. Nothing here decides whether publishing was allowed. That is the brain's echo-and-
 *      confirm (manifest `irreversible: true`), recorded with a timestamp before this agent
 *      is ever queued.
 *
 *  Unpublishing lives OUTSIDE this file, in lib/publish.ts's unpublishContentItem — reached
 *  synchronously from the chat route the same way approveAndPublish already is, not as an
 *  agent-server job. There is nothing here for a job to wait on: like "publish it now", "take it
 *  down" either succeeds or fails inside one request. This agent still stores `wpPostId` on
 *  every successful publish (below) so that later unpublish call has a post to address.
 */
export class PublishAgent extends Agent {
  type = "publish";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const itemId = resolveItemId(job.data);

    if (!itemId) {
      throw new Error(
        "Publish ke liye ye nahi pata chala ki kaunsa article publish karna hai. " +
          "(Koi content_item_id nahi mila — writer step ka output isme aana chahiye tha.)",
      );
    }

    ctx.onProgress({ label: "Checking the draft before it goes live…" });
    ctx.progress(0.1, "Checking the draft before it goes live…");

    const { data: item, error } = await supabase
      .from("content_items")
      .select("id, title, body, type, status, meta")
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`Draft nahi padha ja saka: ${error.message}`);
    if (!item) throw new Error("Wo draft mila hi nahi — shayad delete ho gaya.");

    // ── Guard 2: already live ────────────────────────────────────────────────────────────
    const existingUrl = (item.meta as any)?.publishedUrl ?? null;
    if (item.status === "published" && existingUrl) {
      ctx.log(`item ${itemId} already published at ${existingUrl}; returning the existing URL`);
      return { url: existingUrl, verified: true, alreadyPublished: true };
    }

    // ── Guard 1: it must have passed the gate ───────────────────────────────────────────
    const gate = (item.meta as any)?.qualityGate;
    if (gate && gate.passed === false) {
      const why = Array.isArray(gate.reasons) && gate.reasons.length ? gate.reasons.join("; ") : "quality gate failed";
      throw new Error(
        `Ye draft quality gate pass nahi kar paya, isliye live nahi kiya: ${why}. ` +
          `Pehle isse theek karwa lo — publish wapas lena mushkil hota hai.`,
      );
    }
    const seo = (job.data as any).seo_passed ?? (job.data as any).seoPassed;
    if (seo && seo.passed === false) {
      const issues = Array.isArray(seo.issues) ? seo.issues.length : 0;
      throw new Error(`SEO check pass nahi hua (${issues} issue). Live kuch nahi kiya gaya.`);
    }

    if (!item.body?.trim()) throw new Error("Draft khaali hai — publish karne ko kuch nahi.");

    // ── Publish ─────────────────────────────────────────────────────────────────────────
    ctx.onProgress({ label: `Publishing "${item.title ?? "the draft"}"…` });
    ctx.progress(0.5, `Publishing "${item.title ?? "the draft"}"…`);

    // The article's own pictures go with it (MASTER_PLAN §19.4): the thumbnail becomes the
    // featured image and each inline picture lands under the heading it was made for. Only
    // APPROVED ones — an image set the customer has not looked at, or has rejected, must not
    // appear on their live site, and an article whose images were rejected still publishes
    // (plainly) rather than being held hostage by them.
    const images = await approvedImages(tenantId, item.id);
    if (images.length) ctx.log(`Publishing with ${images.length} approved image(s).`);

    const result = await publishContentItem(
      tenantId,
      { id: item.id, title: item.title, body: item.body, type: item.type },
      images,
    );

    if (!result.ok) {
      // The failure text comes from publish.ts, which knows whether it was credentials, the
      // site being down, or WordPress refusing the post. Passing it through unchanged is the
      // difference between a user fixing it and a user filing a ticket.
      throw new Error(result.error ?? "Publish fail ho gaya, aur wajah nahi mili.");
    }

    // ── Guard 3: verify, do not trust ───────────────────────────────────────────────────
    ctx.onProgress({ label: "Checking the page actually loads…" });
    ctx.progress(0.85, "Checking the page actually loads…");
    const verification = await verifyLive(result.url, item.title);

    await supabase
      .from("content_items")
      .update({
        status: "published",
        meta: {
          ...((item.meta as any) ?? {}),
          publishedUrl: result.url ?? null,
          publishedAt: new Date().toISOString(),
          publishVerified: verification.verified,
          publishVerifyNote: verification.note,
          // Needed to unpublish the SAME post later from chat (lib/publish.ts's
          // unpublishContentItem) instead of guessing one from a title match.
          wpPostId: result.wpPostId ?? null,
        },
      })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);

    ctx.data("published", { url: result.url ?? null, verified: verification.verified, title: item.title });

    return {
      url: result.url ?? null,
      verified: verification.verified,
      // Said out loud rather than hidden: a published-but-unverified page is a different
      // situation from a verified one, and the user has to be able to tell them apart.
      note: verification.note,
      title: item.title,
    };
  }
}

/** The article step hands its whole output down; the intent may name an item directly.
 *  Both shapes are accepted, neither is guessed at. */
function resolveItemId(data: AgentJobData): string | null {
  const d = data as any;
  const candidates = [d.content_item_id, d.contentItemId, d.article?.contentItemId, d.article?.content_item_id, d.article?.id];
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
  return null;
}

/** Fetch the URL WordPress reported and check a page really is there.
 *
 *  Not fatal when it fails: the post may genuinely exist behind a cache, a Cloudflare
 *  challenge, or a site that blocks unknown user agents. The distinction is recorded and
 *  returned rather than swallowed — "live, verified" and "live, could not check" are two
 *  different sentences and users deserve the right one. */
async function verifyLive(url: string | undefined, title: string | null): Promise<{ verified: boolean; note: string | null }> {
  if (!url) return { verified: false, note: "WordPress ne koi URL wapas nahi diya, isliye check nahi kar paye." };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MrLxwaBot/1.0 (+https://mrlxwa.com; verifying a page we just published)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return { verified: false, note: `Page abhi ${res.status} de raha hai — ho sakta hai cache thoda time le.` };
    const html = await res.text();
    if (title && !html.toLowerCase().includes(title.slice(0, 40).toLowerCase())) {
      return { verified: false, note: "Page khula par usme article ka title nahi mila — theme ya cache dekh lo." };
    }
    return { verified: true, note: null };
  } catch (e: any) {
    return { verified: false, note: `Page check nahi ho paya (${e?.message ?? "network error"}) — publish ho chuka hai.` };
  }
}

/** The approved image set for an article, in the order a post wants them: the thumbnail (which
 *  becomes the featured image), the hero, then the inline pictures in their own order. Empty
 *  when there is no set, or it is still awaiting review, or the customer rejected it — the
 *  article goes out either way (§19.4.7). */
async function approvedImages(tenantId: string, articleId: string): Promise<PublishImage[]> {
  const { data, error } = await supabase
    .from("content_items")
    .select("meta, status")
    .eq("tenant_id", tenantId)
    .eq("type", "image_set")
    .eq("blueprint->>parent_article_id", articleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return [];
  if (data.status !== "approved" && data.status !== "published") return [];

  const raw: any[] = Array.isArray((data.meta as any)?.images) ? (data.meta as any).images : [];
  const order = (slot: string) => (slot === "thumb" ? 0 : slot === "hero" ? 1 : slot === "og" ? 99 : 2);
  return raw
    .filter((i) => i?.url && i?.slot !== "og") // the OG card is for the share preview, not the page
    .map((i) => ({ slot: String(i.slot), url: String(i.url), alt: String(i.alt ?? ""), anchor: i.anchor ? String(i.anchor) : null }))
    .sort((a, b) => order(a.slot) - order(b.slot) || a.slot.localeCompare(b.slot));
}
