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
