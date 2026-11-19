import type { SupabaseClient } from "@supabase/supabase-js";

/** The Approvals list, in one place: the API route (live search, refresh) and the page itself
 *  (first paint) read it the same way, so the page can arrive with its data already in it instead
 *  of loading, then fetching, then drawing.
 *
 *  `parent_article_id:blueprint->>parent_article_id`, not `blueprint`: the blueprint is the
 *  article's full outline; the ONE thing this list needs from it is which article an image_set
 *  or web_story belongs under, and the rows are rebuilt into that exact shape below. */
const COLUMNS = "id, type, status, title, cluster, meta, parent_article_id:blueprint->>parent_article_id, created_at, updated_at";

/** How many items wait in a status, WITHOUT reading them. The sidebar badge only needs the number; it used to download the whole list (up to 100 rows) every minute to count it.
 *  Capped at the list's own limit (100) so the badge never promises more than the Approvals page can show. */
export async function countContentItems(supabase: SupabaseClient, tenantId: string, status = "awaiting_approval"): Promise<number | null> {
  let query = supabase.from("content_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (status !== "all") query = query.eq("status", status);
  const { count, error } = await query;
  if (error || count == null) return null;
  return Math.min(count, 100);
}

export async function listContentItems(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { status?: string; q?: string } = {},
): Promise<{ items: any[]; error?: string }> {
  const status = opts.status || "awaiting_approval";
  let query = supabase
    .from("content_items")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);

  // `%`, `_`, `,` and brackets are stripped so a typed character can never change the pattern
  // or break the filter expression.
  const q = (opts.q || "").replace(/[%_,()]/g, " ").trim().slice(0, 80);
  if (q) query = query.ilike("title", `%${q}%`);

  const { data, error } = await query;
  if (error) return { items: [], error: error.message };
  const items = (data ?? []).map(({ parent_article_id, ...row }: any) => ({
    ...row,
    blueprint: parent_article_id ? { parent_article_id } : null,
  }));
  return { items };
}
