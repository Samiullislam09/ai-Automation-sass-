import crypto from "node:crypto";
import { supabase } from "../supabase.js";

/** Publishing, for the half of the product that has no browser in front of it.
 *
 *  Until now this only existed in the Next.js app (lib/publish.ts), reached by a human
 *  pressing "Approve & publish". A scheduled run at 9am has nobody to press anything, so when
 *  the schedule is set to auto-publish the writer has to be able to ship the article itself.
 *
 *  This is a deliberate PORT, not an import: agent-server and the web app are separate builds
 *  with separate tsconfigs (NodeNext + strict here, bundler + strict:false there) and separate
 *  dependency trees — reaching across that line does not compile and would not deploy. Keep
 *  the two in step by hand; the wire formats below (WordPress REST, the X-MrLxwa-Signature
 *  header) are what a customer's site is already built against and must not drift.
 *
 *  Only what auto-publish needs is here. Everything else — connecting an integration,
 *  verifying it, rotating a webhook secret — stays in the app, where the customer is.
 */

// wpPostId lets a later chat "isko site se hata do" address the SAME WordPress post instead of
// guessing one from a title — see agents/publish.ts, which stores this in content_items.meta.
export type PublishResult = { ok: boolean; url?: string; wpPostId?: number; error?: string };

/** One of the article's own pictures, as agents/image.ts filed it (MASTER_PLAN §19.4).
 *  `anchor` is the exact heading an inline image belongs under — the whole point of the image
 *  plan is that a picture sits with the paragraph it is about, and that only survives the trip
 *  to WordPress if the heading comes with it. */
export type PublishImage = { slot: string; url: string; alt: string; anchor: string | null };

export async function publishContentItem(
  tenantId: string,
  item: { id: string; title: string | null; body: string | null; type: string },
  /** The approved image set, if there is one. Absent or empty publishes exactly as before. */
  images: PublishImage[] = []
): Promise<PublishResult> {
  // This client is service-role, so RLS is not doing the scoping — the tenant filter is.
  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("id, type, status, encrypted_credentials")
    .eq("tenant_id", tenantId)
    .eq("status", "connected");

  if (error) return { ok: false, error: `Could not read your publishing integrations: ${error.message}` };

  const wp = (integrations ?? []).find((i: any) => i.type === "wordpress");
  const webhook = (integrations ?? []).find((i: any) => i.type === "webhook");

  // Same order of preference as the app, so "Approve & publish" and an automatic run always
  // land in the same place.
  if (wp) return publishToWordPress(wp.encrypted_credentials as any, item, images);
  if (webhook) return deliverWebhook(webhook.encrypted_credentials as any, item, images);
  return { ok: false, error: "No connected publishing destination (WordPress or webhook) — add one in Connect (/app/connect) first." };
}

async function publishToWordPress(
  creds: { siteUrl: string; username: string; appPassword: string },
  item: { title: string | null; body: string | null },
  images: PublishImage[] = []
): Promise<PublishResult> {
  try {
    const auth = Buffer.from(`${creds.username}:${decrypt(creds.appPassword)}`).toString("base64");

    // The pictures go into the customer's OWN media library, and the post refers to those
    // copies. Hot-linking our storage would be easier and would also mean their post breaks
    // the day we move a file — the images belong to them once published.
    const uploaded = await uploadToMediaLibrary(creds.siteUrl, auth, images);
    const featured = uploaded.find((u) => u.slot === "thumb") ?? uploaded.find((u) => u.slot === "hero");
    const html = withImages(markdownToHtml(item.body ?? ""), uploaded);

    const res = await fetch(`${creds.siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        title: item.title ?? "Untitled",
        content: html,
        status: "publish",
        ...(featured ? { featured_media: featured.id } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, error: `WordPress publish failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}` };
    const data: any = await res.json();
    return { ok: true, url: data?.link, wpPostId: typeof data?.id === "number" ? data.id : undefined };
  } catch (e: any) {
    return { ok: false, error: `WordPress publish error: ${e?.message ?? e}` };
  }
}

type UploadedImage = PublishImage & { id: number; wpUrl: string };

/** Puts each picture in the site's media library. Best effort per image: one that will not
 *  upload is skipped and the post still goes out — a picture is not worth failing a publish
 *  for, which is the same promise agents/image.ts makes when a provider is down. */
async function uploadToMediaLibrary(siteUrl: string, auth: string, images: PublishImage[]): Promise<UploadedImage[]> {
  const out: UploadedImage[] = [];
  for (const image of images) {
    try {
      const got = await fetch(image.url, { signal: AbortSignal.timeout(20_000) });
      if (!got.ok) continue;
      const bytes = Buffer.from(await got.arrayBuffer());
      // The filename is what WordPress turns into the media slug, and Google reads it — the
      // slot name plus the article's own words beats "download (3).webp".
      const name = `${image.slot}-${(image.alt || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "image"}.webp`;
      const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "image/webp",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        console.warn(`[publish] ${image.slot} could not be uploaded to the media library (${res.status}) — the post goes out without it`);
        continue;
      }
      const data: any = await res.json();
      if (typeof data?.id !== "number" || !data?.source_url) continue;
      // Alt text is not accepted on the upload itself; it is a second, small call, and a
      // failure there costs the alt text, not the image.
      await fetch(`${siteUrl}/wp-json/wp/v2/media/${data.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({ alt_text: image.alt ?? "" }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => {});
      out.push({ ...image, id: data.id, wpUrl: String(data.source_url) });
    } catch (e: any) {
      console.warn(`[publish] ${image.slot} upload failed (${String(e?.message ?? e).slice(0, 80)}) — the post goes out without it`);
    }
  }
  return out;
}

/** Puts the hero above the first paragraph and each inline picture directly under the heading
 *  it was made for. An image whose heading is not in the HTML is left out rather than dropped
 *  somewhere arbitrary — a picture in the wrong place is worse than no picture (§19.4.3). */
export function withImages(html: string, images: UploadedImage[]): string {
  const figure = (i: UploadedImage) =>
    `<figure class="wp-block-image size-large"><img src="${escapeAttr(i.wpUrl)}" alt="${escapeAttr(i.alt ?? "")}" loading="lazy"/></figure>`;

  let out = html;
  for (const image of images) {
    if (!image.anchor) continue;
    // Match the heading WordPress will render, whatever level markdownToHtml gave it.
    const heading = new RegExp(`(<h[23][^>]*>\\s*${escapeRegExp(image.anchor.trim())}\\s*</h[23]>)`, "i");
    if (heading.test(out)) out = out.replace(heading, `$1\n${figure(image)}`);
  }

  const hero = images.find((i) => i.slot === "hero");
  if (hero) out = `${figure(hero)}\n${out}`;
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function deliverWebhook(
  creds: { url: string; secret: string },
  item: { id: string; title: string | null; body: string | null; type: string },
  images: PublishImage[] = []
): Promise<PublishResult> {
  try {
    const secret = decrypt(creds.secret);
    // Markdown, exactly as the app sends it — the customer's own endpoint renders it, and
    // changing the shape here would break sites already parsing it. `images` is additive: an
    // endpoint written before this existed ignores an extra key; one written after it can put
    // the pictures where its own template wants them.
    const payload = JSON.stringify({ id: item.id, type: item.type, title: item.title, body: item.body, images });
    const res = await fetch(creds.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MrLxwa-Signature": signPayload(secret, payload) },
      body: payload,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, error: `Webhook delivery failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Webhook delivery error: ${e?.message ?? e}` };
  }
}

/** Mirrors lib/crypto.ts. Read straight off process.env rather than through src/env.ts because
 *  env.ts's required() throws at import time — an agent-server that has never auto-published
 *  must not refuse to boot over a key it does not use. A missing key surfaces here instead, as
 *  a publish error the customer can actually see. */
function decrypt(payload: string): string {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY missing on agent-server (64-char hex). It must be the SAME key the web app uses, or the saved credentials cannot be read."
    );
  }
  const [ivB64, tagB64, dataB64] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(hex, "hex"), Buffer.from(ivB64!, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64!, "base64")), decipher.final()]).toString("utf8");
}

/** Mirrors lib/webhook.ts — the customer's site verifies this exact string. */
function signPayload(secret: string, payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** WordPress wants HTML; Mr. Writer produces markdown.
 *
 *  The app uses `marked` for this. It is not a dependency of agent-server and adding one to
 *  ship a scheduled post is a poor trade, so this covers the subset the writer actually emits
 *  (agent-server/src/lib/writer.ts): headings, paragraphs, both list kinds, blockquotes, rules,
 *  and inline bold/italic/code/links. Anything it does not recognise is escaped and passed
 *  through as a paragraph — worst case a stray asterisk reaches the post, never raw HTML from
 *  a model into someone's live site.
 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) { flushAll(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flushAll(); out.push("<hr />"); continue; }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph(); flushQuote();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(bullet[1]!);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph(); flushQuote();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(numbered[1]!);
      continue;
    }

    const blockquote = /^\s*>\s?(.*)$/.exec(line);
    if (blockquote) { flushParagraph(); flushList(); quote.push(blockquote[1]!); continue; }

    flushList(); flushQuote();
    paragraph.push(line.trim());
  }

  flushAll();
  return out.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape FIRST, then add markup — the other order would let a model-written `<script>` out. */
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Links before emphasis: a title full of underscores inside a URL is not italics.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}
