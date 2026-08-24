import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { keywordSuggestions } from "../lib/dataforseo.js";
import { aiRelatedQueries } from "../lib/keywordFallback.js";
import { loadInsights, relatedFromSearchConsole } from "../lib/insights.js";
import { supabase } from "../supabase.js";
import { enqueue } from "../queues.js";

/** Build Guide Step 9 — keyword validation.
 *  Mr. Keyword's job: given a topic, come back with the queries real customers type, so
 *  Mr Lxwa (and Mr. Writer's blueprint) know what the article has to answer.
 *
 *  THREE SOURCES, IN ORDER OF EVIDENCE:
 *   1. DataForSEO — measured monthly search volume for the whole market. Tried first.
 *   2. Google Search Console — the searches THIS site is already being shown for. Not
 *      market volume, but the strongest possible signal that the query is real and that
 *      this business can rank for it. Used when DataForSEO is down/unverified.
 *   3. NVIDIA (the model the rest of the product runs on) — last resort. Returns QUERIES
 *      ONLY, never a number: an invented volume is indistinguishable from a measured one.
 *  Everything downstream is told which source it got (`source`).
 *
 *  Search Console data, when present, is ALSO attached regardless of which source won —
 *  knowing "you already get 340 impressions for this and sit at position 12" changes what
 *  the article has to do, no matter where the keyword list came from.
 *
 *  With `chain: true` (how Mr Lxwa dispatches it — see boss.ts) he doesn't stop at research:
 *  he turns the result into a blueprint and hands it to Mr. Writer. */

type Related = { keyword: string; searchVolume: number | null; impressions?: number; position?: number };
type Source = "dataforseo" | "gsc" | "ai";

export class KeywordAgent extends Agent {
  type = "keyword";

  async run(job: Job<AgentJobData>) {
    const { tenantId } = job.data;
    const topic = (job.data as any).topic as string | undefined;
    const chain = (job.data as any).chain === true;
    if (!topic?.trim()) throw new Error("keyword job needs a 'topic' string");
    const t = topic.trim();

    const insights = await loadInsights(tenantId);
    const ownSearches = relatedFromSearchConsole(insights, t, 10);

    let seedVolume: number | null = null;
    let seedCompetition: string | null = null;
    let related: Related[] = [];
    let source: Source = "dataforseo";
    let providerError: string | null = null;

    try {
      const ideas = await keywordSuggestions(t, 15);
      const seed = ideas.find((i) => i.keyword.toLowerCase() === t.toLowerCase());
      seedVolume = seed?.searchVolume ?? null;
      seedCompetition = seed?.competitionLevel ?? null;
      related = ideas
        .filter((i) => i.keyword.toLowerCase() !== t.toLowerCase())
        .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
        .slice(0, 10)
        .map((i) => ({ keyword: i.keyword, searchVolume: i.searchVolume ?? null }));
    } catch (e: any) {
      providerError = e?.message ?? "Keyword provider unavailable";
      console.error("[keyword] DataForSEO failed:", providerError);

      if (ownSearches.length >= 3) {
        // Real impressions from this site's own Search Console beat anything a model can
        // guess, so this outranks the AI fallback whenever there's enough of it.
        source = "gsc";
        related = ownSearches.map((q) => ({
          keyword: q.query,
          searchVolume: null, // impressions ≠ search volume, and must never be printed as one
          impressions: q.impressions,
          position: q.position,
        }));
      } else {
        const { data: tenant } = await supabase.from("tenants").select("niche").eq("id", tenantId).single();
        related = await aiRelatedQueries(t, tenant?.niche ?? null, 8);
        source = "ai";
        if (!related.length) {
          throw new Error(`Keyword research failed and every fallback returned nothing. Original error: ${providerError}`);
        }
      }
    }

    const worthWriting = source === "dataforseo" ? (seedVolume ?? 0) > 0 || related.length > 0 : related.length > 0;
    const base = {
      topic: t,
      source,
      searchDataAvailable: source === "dataforseo",
      searchDataError: providerError,
      seedSearchVolume: seedVolume,
      seedCompetition,
      relatedKeywords: related,
      // Attached whatever the source was — this is the site's own measured performance.
      ownSearchConsole: ownSearches,
      worthWriting,
    };

    if (!chain) return base;

    // "Nobody searches for this" is only a real finding when we actually measured the market.
    if (source === "dataforseo" && !worthWriting) {
      return { ...base, chained: false, reason: "No search demand found — not passed to the writer." };
    }

    const blueprint = buildBlueprint(t, seedVolume, related, source, providerError, ownSearches);
    await enqueue("writer", { tenantId, topic: t, blueprint, taskLabel: `Writing "${t}"` });

    return { ...base, chained: true, blueprint };
  }
}

/** The "blueprint" Mr. Writer accepts (see lib/writer.ts) — plain text, not JSON, because it
 *  goes straight into the writing prompt. It states which source every number came from, so
 *  the writer never treats a suggestion as a measurement. */
function buildBlueprint(
  topic: string,
  seedVolume: number | null,
  related: Related[],
  source: Source,
  providerError: string | null,
  ownSearches: { query: string; impressions: number; clicks: number; position: number }[]
): string {
  const lines = [`Primary keyword: ${topic}`];

  if (source === "ai") {
    lines.push(
      "",
      `NOTE: live search data was unavailable (${providerError ?? "provider error"}), so the queries`,
      "below are AI-suggested customer questions, NOT measured search volumes. Do not state or imply",
      "any search volume, ranking difficulty or traffic number anywhere in the article."
    );
  } else if (source === "gsc") {
    lines.push(
      "",
      `NOTE: the keyword provider was unavailable (${providerError ?? "provider error"}), so the list`,
      "below comes from this site's own Google Search Console — real searches this site was shown for.",
      "Impressions are how often Google showed this site, NOT how many people search per month.",
      "Never print an impression count as a search volume, and never state a traffic number in the article."
    );
  } else if (seedVolume != null) {
    lines.push(`Monthly search volume: ${seedVolume}`);
  }

  if (related.length) {
    lines.push(
      "",
      source === "ai"
        ? "Questions to answer (AI-suggested — work each in naturally, as a section or a paragraph):"
        : source === "gsc"
        ? "Real searches this site already appears for (answer each one directly):"
        : "Related queries to cover (real search data — work each in naturally, as a section or a paragraph):",
      ...related.map((r) => {
        if (r.searchVolume != null) return `- ${r.keyword} (${r.searchVolume}/mo)`;
        if (r.impressions != null) return `- ${r.keyword} (${r.impressions} impressions, currently position ${r.position?.toFixed(1)})`;
        return `- ${r.keyword}`;
      })
    );
  }

  // Even when DataForSEO answered, this is the part that makes the article about THIS
  // business rather than about the topic in the abstract.
  if (source !== "gsc" && ownSearches.length) {
    lines.push(
      "",
      "This site is ALREADY shown in Google for these related searches — the article must answer them",
      "explicitly, because the audience is demonstrably real:",
      ...ownSearches.slice(0, 8).map((q) => `- ${q.query} (${q.impressions} impressions, position ${q.position.toFixed(1)}, ${q.clicks} clicks)`)
    );
  }

  lines.push(
    "",
    "Structure: open by answering the primary keyword directly, then one section per query",
    "above, then a short practical conclusion. Use ## headings."
  );
  return lines.join("\n");
}
