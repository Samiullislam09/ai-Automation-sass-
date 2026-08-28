import { supabase } from "../supabase.js";
import { checkRank, dataForSeoConfigured, normalizeHost, type RankResult } from "./dataforseo.js";

/** MASTER_PLAN §17.1/§17.8's "SerpBear rank tracking" (settled into Phase 4, 2026-08-28 —
 *  §17.8 left it as an open "which phase?" question). One live SERP check, one row saved —
 *  the scheduling ("who's due for a check") lives in scheduler.ts's tickRanks, matching
 *  tickAudits' own split of concerns (when vs how).
 *
 *  Optional provider, same convention as every other DataForSEO feature: `dataForSeoConfigured()`
 *  gates it, so this is a true no-op — no wasted call, no error — on an install with no
 *  DataForSEO account (which is every install today; MANUAL_STEPS.md #5 has the account
 *  currently unverified and its credentials pulled from Railway on purpose). */
export async function recordRank(
  tenantId: string,
  keyword: string,
  domain: string,
  contentItemId?: string | null
): Promise<RankResult | null> {
  if (!dataForSeoConfigured()) return null;

  const result = await checkRank(keyword, domain);

  const { error } = await supabase.from("keyword_ranks").insert({
    tenant_id: tenantId,
    keyword,
    domain: normalizeHost(domain),
    position: result.position,
    url: result.url,
    content_item_id: contentItemId ?? null,
  });
  // Migration 021 not applied yet = this insert fails on every tenant, every tick. Say it
  // once here rather than silently losing the check that was already paid for.
  if (error) console.error("[rankTracking] could not save rank check (apply migration 021):", error.message);

  return result;
}

/** For a future dashboard/chat answer ("kahan rank kar raha hai") — the latest position per
 *  keyword this tenant has ever checked, newest check per keyword only. */
export async function latestRanks(tenantId: string): Promise<{ keyword: string; position: number | null; url: string | null; checkedAt: string }[]> {
  const { data, error } = await supabase
    .from("keyword_ranks")
    .select("keyword, position, url, checked_at")
    .eq("tenant_id", tenantId)
    .order("checked_at", { ascending: false })
    .limit(500);

  if (error || !data) return [];

  // First row per keyword IS the latest, because of the order() above — a Map naturally keeps
  // only the first insertion per key.
  const seen = new Map<string, { keyword: string; position: number | null; url: string | null; checkedAt: string }>();
  for (const row of data as any[]) {
    if (seen.has(row.keyword)) continue;
    seen.set(row.keyword, { keyword: row.keyword, position: row.position, url: row.url, checkedAt: row.checked_at });
  }
  return [...seen.values()];
}
