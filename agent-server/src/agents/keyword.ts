import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { keywordSuggestions } from "../lib/dataforseo.js";
import { enqueue } from "../queues.js";

/** Build Guide Step 9 — real keyword validation via DataForSEO.
 *  Mr. Keyword's job: given a topic, pull real search volume + related queries
 *  so Mr Lxwa (and Mr. Writer's blueprint) know it's worth writing about.
 *
 *  With `chain: true` in the job data (which is how Mr Lxwa dispatches it — see boss.ts)
 *  he doesn't stop at research: he turns the keyword data into a blueprint and hands it
 *  straight to Mr. Writer. Without the flag it stays a one-off lookup, which is what the
 *  manual POST /jobs/keyword call has always been. */
export class KeywordAgent extends Agent {
  type = "keyword";

  async run(job: Job<AgentJobData>) {
    const { tenantId } = job.data;
    const topic = (job.data as any).topic as string | undefined;
    const chain = (job.data as any).chain === true;
    if (!topic?.trim()) throw new Error("keyword job needs a 'topic' string");

    const ideas = await keywordSuggestions(topic.trim(), 15);
    const seed = ideas.find((i) => i.keyword.toLowerCase() === topic.trim().toLowerCase());
    const related = ideas
      .filter((i) => i.keyword.toLowerCase() !== topic.trim().toLowerCase())
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
      .slice(0, 10);

    const worthWriting = (seed?.searchVolume ?? 0) > 0 || related.length > 0;
    const base = {
      topic,
      seedSearchVolume: seed?.searchVolume ?? null,
      seedCompetition: seed?.competitionLevel ?? null,
      relatedKeywords: related,
      worthWriting,
    };

    if (!chain) return base;

    // A topic nobody searches for is where the chain stops. Saying so is more useful than
    // spending a writer call on it, and it shows up in the activity feed as a real outcome.
    if (!worthWriting) return { ...base, chained: false, reason: "No search demand found — not passed to the writer." };

    const blueprint = buildBlueprint(topic.trim(), seed?.searchVolume ?? null, related);
    await enqueue("writer", {
      tenantId,
      topic: topic.trim(),
      blueprint,
      taskLabel: `Writing "${topic.trim()}"`,
    });

    return { ...base, chained: true, blueprint };
  }
}

/** The "blueprint" Mr. Writer already accepts (see lib/writer.ts) — plain text, not JSON,
 *  because it goes straight into the writing prompt. Built purely from the real DataForSEO
 *  numbers: no invented target word count, no fabricated competitor analysis. A real SERP
 *  top-10 analysis (Build Guide Step 10) would slot in here later. */
function buildBlueprint(
  topic: string,
  seedVolume: number | null,
  related: { keyword: string; searchVolume?: number | null }[]
): string {
  const lines = [`Primary keyword: ${topic}`];
  if (seedVolume != null) lines.push(`Monthly search volume: ${seedVolume}`);
  if (related.length) {
    lines.push(
      "",
      "Related queries to cover (real search data — work each in naturally, as a section or a paragraph):",
      ...related.map((r) => `- ${r.keyword}${r.searchVolume != null ? ` (${r.searchVolume}/mo)` : ""}`)
    );
  }
  lines.push(
    "",
    "Structure: open by answering the primary keyword directly, then one section per related",
    "query above, then a short practical conclusion. Use ## headings."
  );
  return lines.join("\n");
}
