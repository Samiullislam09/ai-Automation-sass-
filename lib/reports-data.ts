import type { SupabaseClient } from "@supabase/supabase-js";

/** What the Reports pages read, in one place: the API route (refresh) and the pages themselves
 *  (first paint) share it, so Reports arrives WITH its data instead of showing a spinner and then
 *  asking for it.
 *
 *  Slim on purpose. The old list asked /api/content for whole rows, and `meta` is the fat column
 *  (SEO details, publish logs). A report needs four things out of it, so only those four are
 *  pulled (`meta->wordCount` and friends) and the rest never leaves the database.
 *
 *  Image sets and web stories are parts of an article (approving the article approves them), not
 *  separate "pieces written", so they are left out of the counts. */
const COLUMNS =
  "id, type, status, title, cluster, created_at, updated_at, wordCount:meta->wordCount, publishedUrl:meta->>publishedUrl, publishError:meta->>publishError, seoScore:meta->seo->score";

/** How far back and how many rows. 120 days is more than a person reads; 1000 rows is far above
 *  anything a day-by-day list needs, and still a small payload because of the slim columns. */
export const REPORT_DAYS = 120;
export const REPORT_ROWS = 1000;

export type ReportItem = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  cluster: string | null;
  created_at: string;
  updated_at?: string;
  meta: { wordCount?: number; publishedUrl?: string | null; publishError?: string; seo?: { score?: number } };
};

export async function listReportItems(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ items: ReportItem[]; truncated: boolean; error?: string }> {
  const since = new Date(Date.now() - REPORT_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("content_items")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .not("type", "in", "(image_set,web_story)")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(REPORT_ROWS);
  if (error) return { items: [], truncated: false, error: error.message };
  const rows = (data ?? []) as any[];
  const items: ReportItem[] = rows.map(({ wordCount, publishedUrl, publishError, seoScore, ...row }) => ({
    ...row,
    meta: {
      ...(typeof wordCount === "number" ? { wordCount } : {}),
      publishedUrl: publishedUrl ?? null,
      ...(publishError ? { publishError } : {}),
      ...(typeof seoScore === "number" ? { seo: { score: seoScore } } : {}),
    },
  }));
  return { items, truncated: rows.length >= REPORT_ROWS };
}
