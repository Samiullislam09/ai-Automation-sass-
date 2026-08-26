import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { keywordSuggestions } from "../lib/dataforseo.js";
import { aiRelatedQueries } from "../lib/keywordFallback.js";
import { loadInsights, relatedFromSearchConsole } from "../lib/insights.js";
import { buildBlueprint, recommend, type Related, type Research, type Source } from "../lib/blueprint.js";
import { supabase } from "../supabase.js";
import { enqueue } from "../queues.js";

/** Build Guide Step 9 — keyword validation.
 *
 *  THREE SOURCES, IN ORDER OF EVIDENCE:
 *   1. DataForSEO — average monthly search volume and competition for the whole market.
 *   2. Google Search Console — the searches THIS site is already shown for. Not market
 *      volume, but the strongest possible signal that the query is real and winnable here.
 *   3. NVIDIA — last resort. Queries only, never a number: an invented volume is
 *      indistinguishable from a measured one.
 *
 *  THREE MODES, set by whoever enqueues it:
 *   chain: false     — research only. Nothing is written. This is what "sirf keyword nikalo"
 *                      has to do, and it used to be impossible to ask for.
 *   chain: true      — research, then write about the seed topic immediately.
 *   chain: "choose"  — research, put the candidates in front of the human with a countdown,
 *                      and schedule the writer to start on whichever keyword wins. The
 *                      scheduling is server-side on purpose: a 9am automated run has no
 *                      browser open, and the article still has to get written.
 */

const CHOICE_SECONDS = Math.max(5, Number(process.env.KEYWORD_CHOICE_SECONDS) || 20);

export class KeywordAgent extends Agent {
  type = "keyword";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const topic = (job.data as any).topic as string | undefined;
    const rawChain = (job.data as any).chain;
    const mode: "none" | "write" | "choose" = rawChain === "choose" ? "choose" : rawChain === true ? "write" : "none";
    // Carried, not interpreted. Only the writer acts on these; this agent's job is to make
    // sure they survive the hop, including the "choose" path where the writer job is
    // scheduled minutes ahead and there is nobody left to pass them on later.
    const scheduleRunId = (job.data as any).scheduleRunId as string | undefined;
    const autoPublish = (job.data as any).autoPublish === true;
    if (!topic?.trim()) throw new Error("keyword job needs a 'topic' string");
    const t = topic.trim();

    ctx.onProgress({ label: `Looking up search data for "${t}"` });

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
      // Competition is kept now, not dropped — the choice table is useless without it.
      related = ideas
        .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
        .slice(0, 12)
        .map((i) => ({
          keyword: i.keyword,
          searchVolume: i.searchVolume ?? null,
          competitionLevel: i.competitionLevel ?? null,
        }));
    } catch (e: any) {
      providerError = e?.message ?? "Keyword provider unavailable";
      console.error("[keyword] DataForSEO failed:", providerError);

      if (ownSearches.length >= 3) {
        source = "gsc";
        related = ownSearches.map((q) => ({
          keyword: q.query,
          searchVolume: null, // impressions ≠ search volume and must never be printed as one
          impressions: q.impressions,
          position: q.position,
        }));
      } else {
        const { data: tenant } = await supabase.from("tenants").select("niche").eq("id", tenantId).single();
        related = (await aiRelatedQueries(t, tenant?.niche ?? null, 8)).map((r) => ({
          keyword: r.keyword,
          searchVolume: null,
        }));
        source = "ai";
        if (!related.length) {
          throw new Error(`Keyword research failed and every fallback returned nothing. Original error: ${providerError}`);
        }
      }
    }

    const research: Research = {
      topic: t,
      source,
      seedSearchVolume: seedVolume,
      seedCompetition,
      relatedKeywords: related,
      providerError,
      ownSearchConsole: ownSearches,
    };

    const worthWriting = source === "dataforseo" ? (seedVolume ?? 0) > 0 || related.length > 0 : related.length > 0;
    const base = {
      topic: t,
      source,
      searchDataAvailable: source === "dataforseo",
      searchDataError: providerError,
      seedSearchVolume: seedVolume,
      seedCompetition,
      relatedKeywords: related,
      ownSearchConsole: ownSearches,
      worthWriting,
    };

    // ── Research only ───────────────────────────────────────────────────────────────────
    if (mode === "none") {
      const pick = recommend(source, related);
      return {
        ...base,
        chained: false,
        researchOnly: true,
        recommended: pick?.keyword ?? null,
        recommendedWhy: pick?.why ?? null,
        reason: "Research only — no article was written, because none was asked for.",
      };
    }

    // "Nobody searches for this" is only a real finding when we actually measured the market.
    if (source === "dataforseo" && !worthWriting) {
      return { ...base, chained: false, reason: "No search demand found — not passed to the writer." };
    }

    // ── Straight to the writer ──────────────────────────────────────────────────────────
    if (mode === "write") {
      const blueprint = buildBlueprint(t, research);
      await enqueue("writer", { tenantId, topic: t, blueprint, scheduleRunId, autoPublish, taskLabel: `Writing "${t}"` });
      return { ...base, chained: true, blueprint };
    }

    // ── Ask first, then write ───────────────────────────────────────────────────────────
    const candidates = buildCandidates(t, source, related, seedVolume, seedCompetition);
    const pick = recommend(source, candidates) ?? { keyword: t, why: "Only one option was available." };
    const expiresAt = new Date(Date.now() + CHOICE_SECONDS * 1000);

    const { data: choice, error } = await supabase
      .from("keyword_choices")
      .insert({
        tenant_id: tenantId,
        topic: t,
        candidates: candidates.map((c) => ({ ...c, recommended: c.keyword === pick.keyword, why: c.keyword === pick.keyword ? pick.why : null })),
        research: research as unknown as Record<string, unknown>,
        recommended: pick.keyword,
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single();

    if (error || !choice) {
      // Migration 012 missing, or the insert failed. Do NOT drop the article on the floor —
      // fall back to the old behaviour and say why in the result.
      console.error("[keyword] could not open a keyword choice, writing the seed topic instead:", error?.message);
      const blueprint = buildBlueprint(t, research);
      await enqueue("writer", { tenantId, topic: t, blueprint, scheduleRunId, autoPublish, taskLabel: `Writing "${t}"` });
      return { ...base, chained: true, blueprint, choiceError: error?.message ?? "could not open a choice" };
    }

    // Scheduled, not sent now: the window is the human's chance to pick a different one.
    // pg-boss holds it and the writer reads the row when it wakes.
    await enqueue(
      "writer",
      { tenantId, choiceId: choice.id, scheduleRunId, autoPublish, taskLabel: `Writing the keyword you pick for "${t}"` },
      { startAfter: CHOICE_SECONDS }
    );

    return {
      ...base,
      chained: true,
      awaitingChoice: true,
      choiceId: choice.id,
      choiceSeconds: CHOICE_SECONDS,
      candidates,
      recommended: pick.keyword,
      recommendedWhy: pick.why,
    };
  }
}

/** The rows the table shows. The seed topic is included so "the thing you asked for" is
 *  always one of the options, and everything is capped at five — a countdown is no use in
 *  front of a list nobody can read in time. */
function buildCandidates(
  topic: string,
  source: Source,
  related: Related[],
  seedVolume: number | null,
  seedCompetition: string | null
): Related[] {
  const seen = new Set<string>();
  const out: Related[] = [];

  const push = (r: Related) => {
    const key = r.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  push({ keyword: topic, searchVolume: seedVolume, competitionLevel: seedCompetition });
  related.forEach(push);
  return out.slice(0, 5);
}
