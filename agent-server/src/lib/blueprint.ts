/** The brief Mr. Writer writes from.
 *
 *  Lifted out of the keyword agent because it is now needed twice: once when research
 *  finishes, and again when the writer wakes up and discovers the human picked a different
 *  keyword than the recommended one — the brief has to target the keyword that actually won,
 *  not the one we guessed at.
 *
 *  Plain text, not JSON, because it goes straight into the writing prompt. Every number in it
 *  is labelled with where it came from, so the writer can never present an AI suggestion or a
 *  Search Console impression count as a measured search volume. */

export type Related = {
  keyword: string;
  searchVolume: number | null;
  competitionLevel?: string | null;
  impressions?: number;
  position?: number;
};

export type Source = "dataforseo" | "gsc" | "autocomplete" | "ai";

export type Research = {
  topic: string;
  source: Source;
  seedSearchVolume: number | null;
  seedCompetition: string | null;
  relatedKeywords: Related[];
  providerError: string | null;
  ownSearchConsole: { query: string; impressions: number; clicks: number; position: number }[];
};

export function buildBlueprint(primary: string, research: Research): string {
  const { source, providerError, relatedKeywords, ownSearchConsole } = research;

  // Whatever the primary keyword is, it shouldn't also appear in the "related" list.
  const related = relatedKeywords.filter((r) => r.keyword.toLowerCase() !== primary.toLowerCase());
  const seed = relatedKeywords.find((r) => r.keyword.toLowerCase() === primary.toLowerCase());
  const seedVolume = seed?.searchVolume ?? (primary === research.topic ? research.seedSearchVolume : null);

  const lines = [`Primary keyword: ${primary}`];

  if (source === "ai") {
    lines.push(
      "",
      `NOTE: live search data was unavailable (${providerError ?? "provider error"}), so the queries`,
      "below are AI-suggested customer questions, NOT measured search volumes. Do not state or imply",
      "any search volume, ranking difficulty or traffic number anywhere in the article."
    );
  } else if (source === "autocomplete") {
    lines.push(
      "",
      "NOTE: the queries below are Google Autocomplete suggestions — real phrases people type into",
      "Google around this topic, in roughly Google's own popularity order. There is NO volume number",
      "for any of them. Do not state or imply any search volume, ranking difficulty or traffic figure."
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
    lines.push(`Average monthly searches: ${seedVolume}`);
    if (seed?.competitionLevel) lines.push(`Competition: ${seed.competitionLevel}`);
  }

  if (related.length) {
    lines.push(
      "",
      source === "ai"
        ? "Questions to answer (AI-suggested — work each in naturally, as a section or a paragraph):"
        : source === "gsc"
        ? "Real searches this site already appears for (answer each one directly):"
        : source === "autocomplete"
        ? "What people type into Google around this topic (Google Autocomplete — cover each as a section or paragraph):"
        : "Related queries to cover (real search data — work each in naturally, as a section or a paragraph):",
      ...related.map((r) => {
        if (r.searchVolume != null) return `- ${r.keyword} (${r.searchVolume}/mo)`;
        if (r.impressions != null) return `- ${r.keyword} (${r.impressions} impressions, currently position ${r.position?.toFixed(1)})`;
        return `- ${r.keyword}`;
      })
    );
  }

  // Even when the market data answered, this is what makes the article about THIS business
  // rather than about the topic in the abstract.
  if (source !== "gsc" && ownSearchConsole.length) {
    lines.push(
      "",
      "This site is ALREADY shown in Google for these related searches — the article must answer them",
      "explicitly, because the audience is demonstrably real:",
      ...ownSearchConsole.slice(0, 8).map((q) => `- ${q.query} (${q.impressions} impressions, position ${q.position.toFixed(1)}, ${q.clicks} clicks)`)
    );
  }

  lines.push(
    "",
    "Structure: open by answering the primary keyword directly, then one section per query",
    "above, then a short practical conclusion. Use ## headings."
  );
  return lines.join("\n");
}

/** The one we start writing about if nobody picks.
 *
 *  Highest measured demand that isn't brutally competitive: among keywords with real volume,
 *  prefer LOW/MEDIUM competition, and fall back to raw volume when competition is unknown.
 *  With Search Console data there is no market volume, so the signal is impressions — pages
 *  this site is already shown for are the ones it can realistically win.
 *
 *  Returns the reason too. "Why this one?" is a fair question and it deserves an answer that
 *  points at a number rather than at a vibe. */
export function recommend(source: Source, candidates: Related[]): { keyword: string; why: string } | null {
  if (!candidates.length) return null;

  if (source === "gsc") {
    const best = [...candidates].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))[0];
    return {
      keyword: best.keyword,
      why: `Your site is already shown for this ${best.impressions ?? 0} times — the easiest one to actually win.`,
    };
  }

  if (source === "autocomplete") {
    // Google lists completions in (roughly) popularity order; the first one is the only
    // ranking signal that exists here, and it is a real one.
    return { keyword: candidates[0].keyword, why: "Google's top autocomplete suggestion for this topic — the phrase people type most." };
  }

  if (source === "ai") {
    // No numbers exist for this source, so there is nothing to rank by. Say that plainly
    // rather than dressing the first item up as an analysis.
    return { keyword: candidates[0].keyword, why: "No measured search data was available, so this is the AI's closest match to your topic." };
  }

  const withVolume = candidates.filter((c) => (c.searchVolume ?? 0) > 0);
  if (!withVolume.length) return { keyword: candidates[0].keyword, why: "None of these had measured search volume." };

  const soft = withVolume.filter((c) => /low|medium/i.test(c.competitionLevel ?? ""));
  const pool = soft.length ? soft : withVolume;
  const best = [...pool].sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))[0];

  const comp = best.competitionLevel ? `${best.competitionLevel.toLowerCase()} competition` : "competition unknown";
  return {
    keyword: best.keyword,
    why: `${best.searchVolume}/mo average searches with ${comp} — the best demand-to-difficulty trade here.`,
  };
}
