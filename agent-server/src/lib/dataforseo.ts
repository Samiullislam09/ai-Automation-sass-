import { env } from "../env.js";

/** DataForSEO client — Basic Auth (API login + API password from their dashboard,
 *  NOT your account login password). Build Guide Step 9. */

export type KeywordIdea = {
  keyword: string;
  searchVolume: number | null;
  competition: number | null; // 0-1
  competitionLevel: string | null;
  cpc: number | null;
};

const AUTH = Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");

/** Paid provider — absent on a free install, present once a customer buys an account. */
export const dataForSeoConfigured = () => !!(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);

async function dfsPost(path: string, body: unknown) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw new Error("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not configured");
  }
  const res = await fetch(`https://api.dataforseo.com/v3${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${AUTH}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const json: any = await res.json();
  if (!res.ok || json.status_code >= 40000) {
    throw new Error(`DataForSEO ${path} failed (${json.status_code}): ${json.status_message}`);
  }
  const task = json.tasks?.[0];
  if (!task || task.status_code >= 40000) {
    throw new Error(`DataForSEO task failed (${task?.status_code}): ${task?.status_message}`);
  }
  return task.result?.[0];
}

/** Related keyword ideas + search volume for a seed keyword/topic — the actual
 *  "keyword research" behind Mr. Keyword validating a topic before Mr. Writer
 *  gets a blueprint. location_code 2840 = United States, language "en". */
export async function keywordSuggestions(seed: string, limit = 15): Promise<KeywordIdea[]> {
  const result = await dfsPost("/dataforseo_labs/google/keyword_suggestions/live", [
    { keyword: seed, location_code: 2840, language_code: "en", limit, include_seed_keyword: true },
  ]);
  const items = result?.items ?? [];
  return items.map((it: any) => ({
    keyword: it.keyword,
    searchVolume: it.keyword_info?.search_volume ?? null,
    competition: it.keyword_info?.competition ?? null,
    competitionLevel: it.keyword_info?.competition_level ?? null,
    cpc: it.keyword_info?.cpc ?? null,
  }));
}

export type RankResult = { position: number | null; url: string | null };

/** MASTER_PLAN §17.1/§17.8's "SerpBear rank tracking", built as a live SERP check against the
 *  DataForSEO account every other keyword feature already uses — not the SerpBear app itself
 *  (a separate self-hosted Next.js service + its own DB), same "real engine, no bundled
 *  dashboard" substitution already made for Mr. Audit's Lighthouse (§17.3). Same optional-
 *  provider convention as keywordSuggestions: absent without an account, present once a
 *  customer's account is configured (dataForSeoConfigured()).
 *
 *  `domain` should be a bare host (no scheme, no path) — normalizeHost() below handles a full
 *  URL being passed in by mistake. Only the first 100 organic results are ever fetched: a page
 *  ranking below that is, for this product's purposes, not ranking. */
export async function checkRank(keyword: string, domain: string): Promise<RankResult> {
  const result = await dfsPost("/serp/google/organic/live/regular", [
    { keyword, location_code: 2840, language_code: "en", device: "desktop", depth: 100 },
  ]);
  return findRank(result?.items ?? [], domain);
}

/** The matching logic pulled out of checkRank so it's testable without a live DataForSEO
 *  account — same treatment scheduler.ts's isDue and workers.ts's concurrencyFor/withCost get.
 *  Exported for that reason alone. */
export function findRank(items: any[], domain: string): RankResult {
  const target = normalizeHost(domain);
  const hit = (items ?? []).find((it) => it?.type === "organic" && normalizeHost(it?.domain ?? it?.url ?? "") === target);
  if (!hit) return { position: null, url: null };

  return {
    position: typeof hit.rank_absolute === "number" ? hit.rank_absolute : null,
    url: typeof hit.url === "string" ? hit.url : null,
  };
}

/** "https://Www.Example.com/blog" and "example.com" have to compare equal — DataForSEO
 *  returns bare domains for `it.domain` but this also has to survive a tenant's website_url
 *  (which does carry a scheme) being passed in directly. */
export function normalizeHost(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed.toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}
