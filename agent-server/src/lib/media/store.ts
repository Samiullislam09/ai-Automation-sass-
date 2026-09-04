/** Where an image lives once it exists, and how it is found again (MASTER_PLAN §19.4, the
 *  `media` table from migration 023).
 *
 *  Two jobs, and the second is the point:
 *   · put the bytes in Supabase Storage and hand back a public URL;
 *   · file a row saying what this image is — its slot, the article heading it was made for,
 *     the prompt and seed that made it, which provider and which Cloudflare account paid, and
 *     what it cost.
 *
 *  That row is what makes a Web Story cost two images instead of eight: the story does not
 *  generate body pictures, it reads the article's own back out of here (§19.4.5). It is also
 *  the only honest answer to "how much of today's free quota has this tenant used", because it
 *  records what the provider itself reported rather than a count we assumed.
 */

import { supabase } from "../../supabase.js";

const BUCKET = "media";

export type StoredImage = {
  id: string;
  slot: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  anchor: string | null;
  alt: string;
  provider: string;
  seed: number | null;
};

let bucketChecked = false;

/** Creates the public bucket on first use. A migration cannot do this (storage buckets are not
 *  ordinary tables), and asking the owner to click it in a dashboard is one more manual step
 *  that would silently break a fresh deploy. Idempotent, and a "already exists" is success. */
export async function ensureBucket(): Promise<void> {
  if (bucketChecked) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/webp", "image/jpeg", "image/png"],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.error(`[media] could not create the "${BUCKET}" storage bucket: ${error.message}`);
    // Not thrown: the upload below will fail with its own, clearer message if the bucket is
    // genuinely missing, and a bucket that already exists must never look like a failure.
  }
  bucketChecked = true;
}

export type SaveInput = {
  tenantId: string;
  articleId: string | null;
  slot: string;
  webp: Buffer;
  width: number;
  height: number;
  anchor: string | null;
  alt: string;
  prompt: string | null;
  seed: number | null;
  provider: string;
  providerAccount: number | null;
  neurons: number;
  attribution: string | null;
};

/** Uploads and files the row. Overwrites the same path on purpose: a regenerate ("another
 *  image") replaces the picture at the address the article already points at, so nothing has
 *  to be re-linked and no orphan file is left behind. */
export async function saveImage(input: SaveInput): Promise<StoredImage> {
  await ensureBucket();
  const path = `${input.tenantId}/${input.articleId ?? "loose"}/${input.slot}.webp`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.webp, {
    contentType: "image/webp",
    upsert: true,
    cacheControl: "31536000",
  });
  if (upErr) throw new Error(`could not store ${input.slot}: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // A regenerate must not leave the old row behind next to the new one — same article, same
  // slot, one row.
  if (input.articleId) await supabase.from("media").delete().eq("article_id", input.articleId).eq("slot", input.slot);

  const { data, error } = await supabase
    .from("media")
    .insert({
      tenant_id: input.tenantId,
      article_id: input.articleId,
      slot: input.slot,
      url: pub.publicUrl,
      width: input.width,
      height: input.height,
      bytes: input.webp.length,
      anchor: input.anchor,
      alt: input.alt,
      prompt: input.prompt,
      seed: input.seed,
      provider: input.provider,
      provider_account: input.providerAccount,
      neurons: input.neurons,
      attribution: input.attribution,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not file ${input.slot} in the media table: ${error.message}`);

  return {
    id: String(data.id),
    slot: input.slot,
    url: pub.publicUrl,
    width: input.width,
    height: input.height,
    bytes: input.webp.length,
    anchor: input.anchor,
    alt: input.alt,
    provider: input.provider,
    seed: input.seed,
  };
}

/** Every image an article has, in slot order — the lookup a Web Story does instead of
 *  generating its own (§19.4.5). */
export async function imagesForArticle(articleId: string): Promise<StoredImage[]> {
  const { data, error } = await supabase
    .from("media")
    .select("id, slot, url, width, height, bytes, anchor, alt, provider, seed")
    .eq("article_id", articleId)
    .order("slot", { ascending: true });
  if (error) {
    console.error(`[media] could not read the images for ${articleId}: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: String(r.id),
    slot: String(r.slot),
    url: String(r.url),
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
    bytes: Number(r.bytes) || 0,
    anchor: r.anchor ?? null,
    alt: String(r.alt ?? ""),
    provider: String(r.provider ?? "template"),
    seed: r.seed === null || r.seed === undefined ? null : Number(r.seed),
  }));
}

/** How many images this tenant has had GENERATED today (UTC, because that is when Cloudflare's
 *  free quota resets). Template cards are not counted — they cost nothing and must never use
 *  up an allowance. */
export async function generatedToday(tenantId: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .neq("provider", "template")
    .gte("created_at", since.toISOString());
  if (error) {
    // Fail OPEN, the same way the job caps do (jobsLog.dailyUsage): a counting hiccup must not
    // stop a customer's article having pictures.
    console.error(`[media] could not count today's images: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
