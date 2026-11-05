import type { SupabaseClient } from "@supabase/supabase-js";

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
    .select("id");
  if (error) {
    console.error("[content] could not settle the parts of article", articleId, error.message);
    return [];
  }
  return (data ?? []).map((r: { id: string }) => r.id);
}
