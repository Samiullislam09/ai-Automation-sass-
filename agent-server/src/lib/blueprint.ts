import { profileBlock, type Offering, type SiteProfile, type TopicCluster } from "./siteProfile.js";

/** The brief Mr. Writer writes from.
 *
 *  Lifted out of the keyword agent because it is now needed twice: once when research
 *  finishes, and again when the writer wakes up and discovers the human picked a different
 *  keyword than the recommended one — the brief has to target the keyword that actually won,
 *  not the one we guessed at.
 *
 *  Plain text, not JSON, because it goes straight into the writing prompt. Every number in it
 *  is labelled with where it came from, so the writer can never present an AI suggestion or a
 *  Search Console impression count as a measured search volume.
 *
 *  §25.3 — THE BRIEF NOW CARRIES THE BUSINESS. Until now this file described a TOPIC: a
 *  keyword, some related queries, a structure. Any company on earth could have been the
 *  subject. The Site Brain (lib/siteProfile.ts) is passed in as an optional third argument and
 *  rendered by profileBlock(), which brings four things the writer never had:
 *
 *    · what_they_do / audience / geo — who this article is for;
 *    · offerings WITH THEIR REAL URLs — so the call to action is "book the ISO 27001 gap
 *      audit" pointing at /services/iso-27001-gap-audit, not "contact us";
 *    · proof[] under the rule that these are the ONLY facts about the business it may state;
 *    · the topic cluster this keyword belongs to, so internal links go to sibling pages.
 *
 *  The profile is OPTIONAL and absent is normal. Passed null (no analyst run yet, migration
 *  019 not applied, thin site) this function returns exactly the string it returned before —
 *  profileBlock() renders "" for an empty profile precisely so this stays true. */

export type Related = {
  keyword: string;
  searchVolume: number | null;
  competitionLevel?: string | null;
  impressions?: number;
  position?: number;
  /** §25.3 column 2 — cosine(this keyword, nearest topic-cluster centroid). Set by Mr.
   *  Keyword (agents/keyword.ts). null/absent means NOT SCORED, which is not the same as
   *  scoring badly: no profile, no centroids, or past the embedding cap. */
  fitScore?: number | null;
  fitCluster?: string | null;
  /** §25.3 column 3 — this exact query is already earning impressions for this site. Kept
   *  as its own object, never folded into fitScore: they answer different questions and a
   *  user must be able to take the two apart. */
  gscOpportunity?: GscOpportunity | null;
  /** True when the query came from expanding the seed in the site's context rather than from
   *  a search-data provider. It therefore has no volume and never will — see buildBlueprint. */
  fromSiteContext?: boolean;
};

/** "This site is already shown for this search." Measured, from Search Console — either the
 *  striking-distance list (insights.ts) or a content gap the analyst recorded. */
export type GscOpportunity = {
  query: string;
  impressions: number;
  position: number | null;
  clicks: number | null;
  from: "striking-distance" | "content-gap";
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
  /** Queries produced by expanding the seed topic in this business's own context (§25.3).
   *  Model-derived phrasings of a real offering — they have NO volume and are printed under
   *  their own heading so they can never be read as measured demand. */
  siteContextQueries?: string[];
};

export function buildBlueprint(primary: string, research: Research, profile?: SiteProfile | null): string {
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

  // Queries that came from expanding the seed in the site's own context. Their own heading,
  // their own honesty note: these are phrasings, not measurements, and the difference has to
  // survive all the way into the writer's prompt.
  const siteContext = (research.siteContextQueries ?? []).filter((q) => q && q.toLowerCase() !== primary.toLowerCase());
  if (siteContext.length) {
    lines.push(
      "",
      "HOW THIS BUSINESS'S OWN CUSTOMERS PHRASE IT (worked out from their site profile — these are",
      "phrasings, NOT measured demand; there is no volume figure for any of them):",
      ...siteContext.slice(0, 8).map((q) => `- ${q}`)
    );
  }

  // ── the business itself (§25.3) ───────────────────────────────────────────────────────────
  // Everything from here down is skipped entirely when there is no profile, which is what
  // keeps the no-Site-Brain output byte-identical to what this function produced before.
  if (profile) {
    const brain = profileBlock(profile, { maxOfferings: 8, maxClusters: 6, maxGaps: 4 });
    if (brain) lines.push(brain.replace(/\n+$/, ""));

    const offerings = matchOfferings(primary, profile, 3);
    if (offerings.length) {
      const cta = offerings.find((o) => o.url) ?? offerings[0];
      lines.push(
        "",
        "CALL TO ACTION — the article must end by pointing the reader at this specific thing they sell.",
        'Never a generic "contact us", never a made-up offer:',
        cta.url
          ? `- ${cta.name} — link the closing call to action to ${cta.url}`
          : `- ${cta.name} — no page URL is on file for it, so name it in words and do NOT invent a link`
      );
      const others = offerings.filter((o) => o !== cta && o.url);
      if (others.length) {
        lines.push("Also relevant to this keyword, link where it genuinely helps:", ...others.map((o) => `- ${o.name} — ${o.url}`));
      }
    }

    const cluster = nearestCluster(primary, profile);
    if (cluster?.page_urls.length) {
      lines.push(
        "",
        `INTERNAL LINKS — these pages are the same topic area ("${cluster.name}"). Link the relevant ones`,
        "first, using these exact URLs. Do not invent a URL that is not listed here:",
        ...cluster.page_urls.slice(0, 6).map((u) => `- ${u}`)
      );
    }
  }

  lines.push(
    "",
    "Structure: open by answering the primary keyword directly, then one section per query",
    "above, then a short practical conclusion. Use ## headings."
  );
  return lines.join("\n");
}

// ── matching the keyword to the business (§25.3) ────────────────────────────────────────────

/** The things this business sells that are actually about this keyword.
 *
 *  Word overlap, not embeddings, and deliberately so: buildBlueprint() is synchronous, pure
 *  and called from two places, and an offering list is a handful of short names where a shared
 *  content word ("audit", "27001", "training") is a strong enough signal. The embedding work
 *  is Mr. Keyword's fit score, where it earns its cost by ranking dozens of candidates.
 *
 *  Ranked by how many meaningful words are shared. Nothing shared = nothing returned, and the
 *  caller falls back to the FIRST offerings so the CTA still points at something real: an
 *  article about a subject none of the offerings names is exactly when a generic "contact us"
 *  would otherwise creep back in. */
export function matchOfferings(primary: string, profile: SiteProfile | null | undefined, max = 3): Offering[] {
  const offerings = (profile?.offerings ?? []).filter((o) => o && o.name);
  if (!offerings.length) return [];

  const wanted = new Set(tokens(primary));
  const scored = offerings
    .map((o) => ({ o, score: overlap(wanted, tokens(`${o.name} ${o.url ?? ""}`)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored.slice(0, max).map((s) => s.o);
  return offerings.slice(0, 1);
}

/** The topic cluster this keyword sits closest to, by the same word overlap. Null when the
 *  keyword shares nothing with any cluster name or any of its page URLs — better no internal
 *  link suggestion than a confidently wrong one. */
export function nearestCluster(primary: string, profile: SiteProfile | null | undefined): TopicCluster | null {
  const clusters = (profile?.topic_clusters ?? []).filter((c) => c && c.name);
  if (!clusters.length) return null;

  const wanted = new Set(tokens(primary));
  let best: TopicCluster | null = null;
  let bestScore = 0;
  for (const c of clusters) {
    // The cluster's own pages count too: a cluster labelled "infosec" whose pages live at
    // /iso-27001-* still matches the keyword "iso 27001 cost".
    const score = overlap(wanted, tokens(`${c.name} ${c.page_urls.slice(0, 8).join(" ")}`));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore > 0 ? best : null;
}

function overlap(wanted: Set<string>, candidate: string[]): number {
  let n = 0;
  const seen = new Set<string>();
  for (const w of candidate) {
    if (seen.has(w)) continue;
    seen.add(w);
    if (wanted.has(w)) n++;
  }
  return n;
}

// Same stopword idea as insights.ts's tokens(). Kept local rather than imported because that
// one is tuned for Search Console queries; this one also has to survive being fed a URL.
const STOP = new Set(["the", "and", "for", "with", "you", "your", "our", "how", "what", "why", "are", "is", "in", "of", "to", "a", "an", "best", "top", "www", "http", "https", "com", "org", "net", "html", "php"]);

function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
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
