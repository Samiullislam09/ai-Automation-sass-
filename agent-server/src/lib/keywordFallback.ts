import { completeJson } from "./llm.js";

/** Plan B for Mr. Keyword.
 *
 *  DataForSEO is the only real source of search VOLUME, and when its account is unverified,
 *  out of credit or simply down, the whole content chain used to stop there. Rather than stop,
 *  we fall back to the model we already run everything else on (NVIDIA Nemotron) and ask it for
 *  the questions a real customer would type around the topic.
 *
 *  The one rule that makes this honest: the fallback returns QUERIES ONLY — never a number.
 *  An invented "480/mo" would look exactly like a measured one, so no volume is returned at
 *  all, and every consumer (the blueprint, the office panel, the job log) labels these as
 *  AI-suggested rather than measured. */
export type FallbackKeyword = { keyword: string; searchVolume: null; source: "ai" };

export async function aiRelatedQueries(topic: string, niche?: string | null, max = 8): Promise<FallbackKeyword[]> {
  const prompt = [
    `A small business${niche ? ` (${niche})` : ""} is about to publish an article about: "${topic}".`,
    "",
    `List the ${max} questions or phrases their real customers would most likely type into Google around this topic.`,
    "Rules: each must be a realistic search phrase (not a headline), specific, 3-9 words, no duplicates,",
    "no brand names, and no numbers you cannot know (never invent search volumes).",
    "",
    'Reply with ONLY JSON: {"queries":["...","..."]}',
  ].join("\n");

  const out = await completeJson<{ queries?: string[] }>(prompt);
  return (out?.queries ?? [])
    .map((q) => String(q ?? "").trim())
    .filter((q) => q.length > 2 && q.toLowerCase() !== topic.toLowerCase())
    .slice(0, max)
    .map((keyword) => ({ keyword, searchVolume: null as null, source: "ai" as const }));
}
