import type { SupabaseClient } from "@supabase/supabase-js";
import { removeMediaFile } from "@/lib/media-files";

/** The reviewable parts of one order (an image_set and a web_story) point at their article with
 *  `blueprint.parent_article_id` (MASTER_PLAN §19.4.7). When the article is approved or rejected,
 *  every part still waiting moves with it, so a reviewer decides once per article, not per file.
 *  Only items still `awaiting_approval` change; anything already decided is left alone.
 *  Returns the ids that moved so the caller can reflect it without refetching. */
export async function settleChildren(
  supabase: SupabaseClient,
  tenantId: string,
  articleId: string,
  status: "approved" | "rejected",
): Promise<string[]> {
  const { data, error } = await supabase
    .from("content_items")
    .update({ status })
    .eq("tenant_id", tenantId)
    .eq("blueprint->>parent_article_id", articleId)
    .eq("status", "awaiting_approval")
    .select("id, type, meta");
  if (error) {
    console.error("[content] could not settle the parts of article", articleId, error.message);
    return [];
  }
  const rows = (data ?? []) as { id: string; type: string; meta: any }[];
  if (status === "approved") {
    for (const r of rows) if (r.type === "image_set") await finalizeImageSet(supabase, r.id, r.meta);
  }
  return rows.map((r) => r.id);
}

/** Approving is "save": the previous version of any redone picture is deleted for good (its file
 *  and its place on the card), so only the pictures that were kept remain. */
export async function finalizeImageSet(supabase: SupabaseClient, id: string, meta: any): Promise<void> {
  const images: any[] = Array.isArray(meta?.images) ? meta.images : [];
  if (!images.some((i) => i?.previous?.url)) return;
  for (const i of images) if (i?.previous?.url) await removeMediaFile(i.previous.url);
  const cleaned = images.map(({ previous, ...rest }) => rest);
  const { error } = await supabase.from("content_items").update({ meta: { ...meta, images: cleaned } }).eq("id", id);
  if (error) console.error("[content] could not clear the previous pictures of", id, error.message);
}
