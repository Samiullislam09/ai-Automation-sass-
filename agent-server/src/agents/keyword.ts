import type { Job } from "bullmq";
import { Agent, type AgentJobData } from "./base.js";
import { keywordSuggestions } from "../lib/dataforseo.js";

/** Build Guide Step 9 — real keyword validation via DataForSEO.
 *  Mr. Keyword's job: given a topic, pull real search volume + related queries
 *  so Mr Lxwa (and later Mr. Writer's blueprint) know it's worth writing about. */
export class KeywordAgent extends Agent {
  type = "keyword";
  async run(job: Job<AgentJobData>) {
    const topic = (job.data as any).topic as string | undefined;
    if (!topic?.trim()) throw new Error("keyword job needs a 'topic' string");

    const ideas = await keywordSuggestions(topic.trim(), 15);
    const seed = ideas.find((i) => i.keyword.toLowerCase() === topic.trim().toLowerCase());
    const related = ideas
      .filter((i) => i.keyword.toLowerCase() !== topic.trim().toLowerCase())
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
      .slice(0, 10);

    return {
      topic,
      seedSearchVolume: seed?.searchVolume ?? null,
      seedCompetition: seed?.competitionLevel ?? null,
      relatedKeywords: related,
      worthWriting: (seed?.searchVolume ?? 0) > 0 || related.length > 0,
    };
  }
}
