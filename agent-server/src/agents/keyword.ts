import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { keywordSuggestions } from "../lib/dataforseo.js";
import { aiRelatedQueries } from "../lib/keywordFallback.js";
import { supabase } from "../supabase.js";
import { enqueue } from "../queues.js";

/** Build Guide Step 9 — keyword validation.
 *  Mr. Keyword's job: given a topic, come back with the queries real customers type, so
 *  Mr Lxwa (and Mr. Writer's blueprint) know what the article has to answer.
 *
 *  TWO SOURCES, IN ORDER:
 *   1. DataForSEO — real, measured monthly search volume. Always tried first.
 *   2. NVIDIA (the same model the rest of the product runs on) — if DataForSEO is down,
 *      unverified or out of credit. It returns QUERIES ONLY, never a volume: an invented
 *      number would be indistinguishable from a measured one, so there simply isn't one.
 *  Everything downstream is told which source it got (`source: "dataforseo" | "ai"`).
 *
 *  With `chain: true` (how Mr Lxwa dispatches it — see boss.ts) he doesn't stop at research:
 *  he turns the result into a blueprint and hands it to Mr. Writer. Without the flag it stays
 *  a one-off lookup, which is what the manual POST /jobs/keyword call has always been. */
export class KeywordAgent extends Agent {
  type = "keyword";

  async run(job: Job<AgentJobData>) {
    const { tenantId } = job.data;
    const topic = (job.data as any).topic as string | undefined;
    const chain = (job.data as any).chain === true;
    if (!topic?.trim()) throw new Error("keyword job needs a 'topic' string");
    const t = topic.trim();

    let seedVolume: number | null = null;
    let seedCompetition: string | null = null;
    let related: { keyword: string; searchVolume: number | null }[] = [];
    let source: "dataforseo" | "ai" = "dataforseo";
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
      console.error("[keyword] DataForSEO failed, falling back to the model:", providerError);

      // Plan B. If this ALSO fails there is genuinely nothing to go on, so the job fails
      // loudly rather than sending the writer off with nothing.
      const { data: tenant } = await supabase.from("tenants").select("niche").eq("id", tenantId).single();
      related = await aiRelatedQueries(t, tenant?.niche ?? null, 8);
      source = "ai";
      if (!related.length) throw new Error(`Keyword research failed and the fallback returned nothing. Original error: ${providerError}`);
    }

    const worthWriting = source === "ai" ? related.length > 0 : (seedVolume ?? 0) > 0 || related.length > 0;
    const base = {
      topic: t,
      source,
      searchDataAvailable: source === "dataforseo",
      searchDataError: providerError,
      seedSearchVolume: seedVolume,
      seedCompetition,
      relatedKeywords: related,
      worthWriting,
    };

    if (!chain) return base;

    // "Nobody searches for this" is only a real finding when we actually measured it.
    if (source === "dataforseo" && !worthWriting) {
      return { ...base, chained: false, reason: "No search demand found — not passed to the writer." };
    }

    const blueprint = buildBlueprint(t, seedVolume, related, source, providerError);
    await enqueue("writer", { tenantId, topic: t, blueprint, taskLabel: `Writing "${t}"` });

    return { ...base, chained: true, blueprint };
  }
}

/** The "blueprint" Mr. Writer accepts (see lib/writer.ts) — plain text, not JSON, because it
 *  goes straight into the writing prompt. It states which source the queries came from, so the
 *  writer never treats an AI-suggested query as a measured one. */
function buildBlueprint(
  topic: string,
  seedVolume: number | null,
  related: { keyword: string; searchVolume: number | null }[],
  source: "dataforseo" | "ai",
  providerError: string | null
): string {
  const lines = [`Primary keyword: ${topic}`];

  if (source === "ai") {
    lines.push(
      "",
      `NOTE: live search data was unavailable (${providerError ?? "provider error"}), so the queries`,
      "below are AI-suggested customer questions, NOT measured search volumes. Do not state or imply",
      "any search volume, ranking difficulty or traffic number anywhere in the article."
    );
  } else if (seedVolume != null) {
    lines.push(`Monthly search volume: ${seedVolume}`);
  }

  if (related.length) {
    lines.push(
      "",
      source === "ai"
        ? "Questions to answer (AI-suggested — work each in naturally, as a section or a paragraph):"
        : "Related queries to cover (real search data — work each in naturally, as a section or a paragraph):",
      ...related.map((r) => `- ${r.keyword}${r.searchVolume != null ? ` (${r.searchVolume}/mo)` : ""}`)
    );
  }

  lines.push(
    "",
    "Structure: open by answering the primary keyword directly, then one section per query",
    "above, then a short practical conclusion. Use ## headings."
  );
  return lines.join("\n");
}
