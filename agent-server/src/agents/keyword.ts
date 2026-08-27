import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { dataForSeoConfigured, keywordSuggestions } from "../lib/dataforseo.js";
import { aiRelatedQueries } from "../lib/keywordFallback.js";
import { autocompleteRelated } from "../lib/autocomplete.js";
import { loadInsights, relatedFromSearchConsole, type SiteInsights } from "../lib/insights.js";
import { buildBlueprint, matchOfferings, nearestCluster, recommend, type GscOpportunity, type Related, type Research, type Source } from "../lib/blueprint.js";
import { loadActiveProfile, type SiteProfile } from "../lib/siteProfile.js";
import { embed } from "../lib/embeddings.js";
import { completeJson } from "../lib/llm.js";
import { supabase } from "../supabase.js";
import { enqueue } from "../queues.js";

/** Build Guide Step 9 — keyword validation.
 *
 *  FOUR SOURCES, IN ORDER OF EVIDENCE — the first one that answers wins:
 *   1. DataForSEO — average monthly search volume and competition for the whole market.
 *      Paid, therefore OPTIONAL: skipped (not failed) when its env vars are unset.
 *   2. Google Search Console — the searches THIS site is already shown for. Not market
 *      volume, but the strongest possible signal that the query is real and winnable here.
 *   3. Google Autocomplete — free, keyless: the completions Google shows in its own search
 *      box. Real phrases, no numbers. Throttled 1 req/s, cached 24h (lib/autocomplete.ts).
 *   4. NVIDIA — last resort. Queries only, never a number: an invented volume is
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
 *
 *  ── §25.3: MR. KEYWORD NOW READS THE SITE ──────────────────────────────────────────────
 *
 *  Everything above stayed. What changed is that a topic string is no longer the ONLY thing
 *  this agent knows about the business. It opens the Site Brain (lib/siteProfile.ts) first and
 *  three things follow from it, in the owner's own words: "agar website health ke upar hai to
 *  pehle samjho kya aur kis tarha ka content hai, fir us tarha ke keyword nikalo."
 *
 *    1 · SEED FROM THE SITE. "keyword do" with no topic used to be an error. With a profile
 *        it is answerable: content_gaps first (a search this site is ALREADY seen for with no
 *        page answering it — measured demand and a measured hole), then a rotation through the
 *        topic clusters so every part of the site gets a turn. Which one it used is in the
 *        result, so the "why this" column can show it.
 *
 *    2 · EXPAND IN CONTEXT. A given topic is expanded once, cheaply, against what_they_do +
 *        the nearest cluster + geo + offerings, so "ISO 27001" becomes the queries a real
 *        customer of THIS business types. One LLM call, skipped entirely when the profile is
 *        thin, and the expansions are carried as their own labelled list — never mixed into
 *        the provider numbers.
 *
 *    3 · FIT SCORE. Every candidate is embedded and scored against the nearest topic-cluster
 *        centroid. Below FIT_MIN_SCORE it is dropped and the reason recorded. A health site
 *        cannot return "crypto tax" any more.
 *
 *  Three columns, never one. searchVolume (or its honest absence), fitScore, and
 *  gscOpportunity are three different questions with three different sources, and the user
 *  must be able to take them apart. Blending them into a single "score" would be exactly the
 *  kind of number this product refuses to print.
 *
 *  NO PROFILE = NO CHANGE. Every one of the three is skipped when the analyst has not run,
 *  the result says `profileUsed: false` with a sentence saying why, and the agent behaves
 *  precisely as it did before. Missing evidence is never an error and never a question.
 */

const CHOICE_SECONDS = Math.max(5, Number(process.env.KEYWORD_CHOICE_SECONDS) || 20);

// ── the two numbers this file is tuned by, both written down ────────────────────────────────

/** THE FIT THRESHOLD. cosine(candidate keyword, nearest topic-cluster centroid) below this and
 *  the candidate is not about this business.
 *
 *  Why 0.45, and why LOWER than the analyst's 0.62 gap threshold, which is measured with the
 *  same model on the same scale:
 *
 *   · a CENTROID is a mean of many page vectors, and a mean sits further from any individual
 *     point than that point's nearest neighbour does. The analyst compares a query to the
 *     single nearest PAGE; we compare it to the average of a whole cluster. The same query
 *     scores systematically lower here, so the same cut-off would throw away good keywords;
 *   · the two mistakes are not symmetric, and they point opposite ways in the two files. A
 *     false gap costs a duplicate article (expensive), so the analyst is strict. A dropped
 *     keyword costs a suggestion the user asked for and never sees (also expensive), so this
 *     is loose — but it only has to be tight enough to do its one job, which is the plan's
 *     own example: on nv-embedqa-e5-v5, "crypto tax" against a health site's clusters lands
 *     around 0.2, far under this; "diabetes diet plan" lands well over it.
 *
 *  One number in one place so it can be recalibrated from a week of real data (plan §12)
 *  rather than argued about in a prompt. */
export const FIT_MIN_SCORE = 0.45;

/** THE EMBEDDING CAP. At most this many candidates get an embedding call in one run.
 *
 *  embed() is one HTTP call per string (lib/embeddings.ts, off-limits to this change) through
 *  the shared 30 rpm NVIDIA limiter, which the crawler and the chat share. A keyword run
 *  produces at most ~15 provider candidates + 6 expansions, so 24 covers every realistic run
 *  with room to spare, and caps the worst case at under a minute of limiter time.
 *
 *  BEYOND THE CAP the remaining candidates keep `fitScore: null` and are KEPT, not dropped.
 *  Unscored is not the same as off-topic, and silently deleting a keyword because we ran out
 *  of budget would be the worst of both worlds. The result says how many were scored. */
export const FIT_MAX_EMBEDDINGS = 24;

/** How many embedding calls are in flight at once. The limiter serialises them anyway; this
 *  only stops 24 promises queueing up behind it at the same moment. */
const FIT_CONCURRENCY = 4;

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

    // ── the Site Brain, first, once ───────────────────────────────────────────────────────
    // Never fatal. A tenant whose analyst has not run yet gets `null` here and falls all the
    // way through to the behaviour this agent had before the profile existed.
    let profileRow = null as Awaited<ReturnType<typeof loadActiveProfile>>;
    try {
      profileRow = await loadActiveProfile(tenantId);
    } catch (e: any) {
      console.error("[keyword] site profile unreadable, carrying on without it:", e?.message);
    }
    const profile = profileRow?.profile ?? null;
    const thin = profileIsThin(profile);

    // Seeding from the site only happens when the caller gave us nothing. With a topic in
    // hand the user's words win — we expand them, we never replace them.
    let seed: SeedChoice | null = null;
    let t: string;
    if (topic?.trim()) {
      t = topic.trim();
    } else {
      // Rotation offset: how much this tenant has already had written. Cheap, and it is what
      // stops "keyword do" three days running from proposing the same cluster three times.
      const rotationOffset = await countWritten(tenantId);
      const resolved = resolveSeed(topic, profile, rotationOffset);
      t = resolved.topic;
      seed = resolved.seed;
      if (seed) ctx.onProgress({ label: `Nothing was specified, so I picked "${seed.keyword}" off your own site — ${seed.why}` });
    }

    ctx.onProgress({ label: `Looking up search data for "${t}"` });

    const insights = await loadInsights(tenantId);
    const ownSearches = relatedFromSearchConsole(insights, t, 10);

    // ── expand the seed in the site's context (one LLM call, at most) ─────────────────────
    // Skipped when the profile is thin (nothing to expand against), and skipped when WE chose
    // the seed — a seed taken from a content gap or a cluster is already in the site's context
    // by construction, and expanding it again would only spend a call to say the same thing.
    let siteContextQueries: string[] = [];
    let expansionError: string | null = null;
    if (!thin && !seed) {
      try {
        siteContextQueries = await expandInSiteContext(t, profile!);
      } catch (e: any) {
        // A failed expansion costs nothing: the provider chain below is untouched by it.
        expansionError = String(e?.message ?? e).slice(0, 200);
        console.error("[keyword] site-context expansion failed, continuing without it:", expansionError);
      }
    }

    let seedVolume: number | null = null;
    let seedCompetition: string | null = null;
    let related: Related[] = [];
    let source: Source | null = null;
    let providerError: string | null = null;

    // ── 1. DataForSEO — the only source with real volume, and the only paid one. ────────
    // Not configured is not an error: it is the normal state of a free install, and the
    // chain below is built to work without it. When a customer buys an account, set the
    // two env vars and this step simply starts winning.
    if (dataForSeoConfigured()) {
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
        source = "dataforseo";
      } catch (e: any) {
        providerError = e?.message ?? "Keyword provider unavailable";
        console.error("[keyword] DataForSEO failed:", providerError);
      }
    } else {
      providerError = "DataForSEO not configured (paid provider — optional)";
    }

    // ── 2. Search Console — this site's own real searches. ─────────────────────────────
    if (!source && ownSearches.length >= 3) {
      source = "gsc";
      related = ownSearches.map((q) => ({
        keyword: q.query,
        searchVolume: null, // impressions ≠ search volume and must never be printed as one
        impressions: q.impressions,
        position: q.position,
      }));
    }

    // ── 3. Google Autocomplete — free, real phrases people type, no numbers. ───────────
    if (!source) {
      ctx.onProgress({ label: `Asking Google Autocomplete what people type around "${t}"` });
      const ac = await autocompleteRelated(t, 12);
      // ONE extra lookup, on the best site-context phrasing, when we have one. This is where
      // "expand before searching" actually earns its keep: Google's completions for "iso 27001
      // certification cost india" are a different and far more useful list than its
      // completions for the bare "ISO 27001", and autocomplete is free and keyless.
      let acContext: typeof ac = [];
      if (siteContextQueries[0]) {
        try {
          acContext = await autocompleteRelated(siteContextQueries[0], 8);
        } catch (e: any) {
          console.error("[keyword] site-context autocomplete failed, using the plain topic only:", e?.message);
        }
      }
      const merged = dedupeByKeyword([...ac, ...acContext]);
      if (merged.length >= 3) {
        source = "autocomplete";
        related = merged.map((r) => ({ keyword: r.keyword, searchVolume: null }));
      }
    }

    // ── 4. The model — last resort, queries only. ──────────────────────────────────────
    if (!source) {
      const { data: tenant } = await supabase.from("tenants").select("niche").eq("id", tenantId).single();
      related = (await aiRelatedQueries(t, tenant?.niche ?? null, 8)).map((r) => ({
        keyword: r.keyword,
        searchVolume: null,
      }));
      source = "ai";
      if (!related.length) {
        throw new Error(`Keyword research failed and every fallback returned nothing. Last provider error: ${providerError}`);
      }
    }

    // ── does this belong on THIS site? (§25.3, the fit score) ─────────────────────────────
    // The expansions ride along in the same scoring pass so they share one cap, and the seed
    // topic is protected: the user asked for it by name, and a suggestion engine that deletes
    // the thing you typed is broken, whatever its maths says.
    const expansionCandidates: Related[] = siteContextQueries.map((q) => ({ keyword: q, searchVolume: null, fromSiteContext: true }));
    if (!thin && (related.length || expansionCandidates.length)) {
      ctx.onProgress({ label: `Checking which of these actually fit your site` });
    }
    const fit = await scoreFitAgainstSite([...related, ...expansionCandidates], profile, { protect: [t] });
    related = fit.kept.filter((r) => !r.fromSiteContext);
    const siteContext = fit.kept.filter((r) => r.fromSiteContext);
    siteContextQueries = siteContext.map((r) => r.keyword);

    // ── is this site already being SEEN for it? (§25.3, the third column) ─────────────────
    // Attached, never blended. A keyword can fit the site perfectly and have no Search Console
    // history at all; the two facts stay two facts.
    for (const r of [...related, ...siteContext]) r.gscOpportunity = gscOpportunityFor(r.keyword, insights, profile);
    const seedOpportunity = gscOpportunityFor(t, insights, profile);

    // One event per keyword, in the order they will be shown. This is what the live workspace
    // renders as a table filling row by row (plan §24.4b) — the granularity rule is one event
    // per user-meaningful thing, so a keyword, never a token. No-op when nobody is watching.
    for (const r of related) {
      ctx.data("keyword", {
        keyword: r.keyword,
        // The three columns stay three columns here too. Blending them into one number is
        // exactly what the plan forbids, and the UI cannot un-blend what we send blended.
        searchVolume: r.searchVolume ?? null,
        competitionLevel: r.competitionLevel ?? null,
        fitScore: r.fitScore ?? null,
        fitCluster: r.fitCluster ?? null,
        gsc: r.gscOpportunity ?? null,
        source,
      });
    }

    const research: Research = {
      topic: t,
      source,
      seedSearchVolume: seedVolume,
      seedCompetition,
      relatedKeywords: related,
      providerError,
      ownSearchConsole: ownSearches,
      siteContextQueries,
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
      // ── the Site Brain receipt: what was known, what was used, and what it cost ──────────
      // `profileUsed: false` is a normal answer, not a complaint, and it always comes with a
      // sentence a non-technical owner can act on.
      profileUsed: !!profile && !thin,
      profileVersion: profileRow?.version ?? null,
      profileNote: profileNote(profile, thin, fit),
      seededFromSite: seed,
      siteContextQueries,
      siteContextError: expansionError,
      seedGscOpportunity: seedOpportunity,
      fit: {
        threshold: FIT_MIN_SCORE,
        scored: fit.scored,
        cap: FIT_MAX_EMBEDDINGS,
        capped: fit.capped,
        available: fit.available,
        error: fit.error,
        dropped: fit.dropped,
      },
      droppedOffTopic: fit.dropped.length,
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
      const blueprint = buildBlueprint(t, research, profile);
      await enqueue("writer", { tenantId, topic: t, blueprint, scheduleRunId, autoPublish, taskLabel: `Writing "${t}"` });
      return { ...base, chained: true, blueprint };
    }

    // ── Ask first, then write ───────────────────────────────────────────────────────────
    const candidates = buildCandidates(t, related, siteContext, seedVolume, seedCompetition, seedOpportunity);
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
      const blueprint = buildBlueprint(t, research, profile);
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
 *  front of a list nobody can read in time.
 *
 *  Each row now carries THREE independent columns, in the order they are trusted:
 *    searchVolume    — measured monthly demand, or null when no source could measure it;
 *    fitScore        — how close this is to what the site is about, or null when unscored;
 *    gscOpportunity  — this site is already shown for this exact search, or null.
 *  Never combined. A blend would hide which of the three the recommendation actually rests on. */
function buildCandidates(
  topic: string,
  related: Related[],
  siteContext: Related[],
  seedVolume: number | null,
  seedCompetition: string | null,
  seedOpportunity: GscOpportunity | null
): Related[] {
  const seen = new Set<string>();
  const out: Related[] = [];

  const push = (r: Related) => {
    const key = r.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  // If a provider also returned the seed, it was scored in the same pass — reuse that score
  // rather than showing the one row in the table with an empty fit column.
  const scoredSeed = related.find((r) => r.keyword.trim().toLowerCase() === topic.trim().toLowerCase());
  push({
    keyword: topic,
    searchVolume: seedVolume,
    competitionLevel: seedCompetition,
    fitScore: scoredSeed?.fitScore ?? null,
    fitCluster: scoredSeed?.fitCluster ?? null,
    gscOpportunity: seedOpportunity,
  });
  related.forEach(push);
  // Site-context phrasings go last. They are real phrasings of what this business sells, but
  // they carry no measured number and must never push a measured candidate off the table.
  siteContext.forEach(push);
  return out.slice(0, 5);
}

// ── 1 · seeding from the site (§25.3) ───────────────────────────────────────────────────────

export type SeedChoice = {
  keyword: string;
  from: "content_gap" | "topic_cluster";
  /** One sentence for the "why this" column, in the words the user should see. */
  why: string;
};

/** What "keyword do" means when nobody said what about.
 *
 *  Before the Site Brain this threw, and that was the honest answer: we had a topic string or
 *  nothing. With a profile there is a better one, and the plan is specific about its order.
 *
 *    CONTENT GAPS FIRST. A gap is a search this site is ALREADY shown for, with impressions to
 *    prove it, and no page answering it (agents/analyst.ts). Measured demand plus a measured
 *    hole is the strongest seed that exists — nothing a keyword tool could suggest beats it.
 *
 *    THEN A ROTATION THROUGH THE CLUSTERS. Not "the biggest cluster" every time, which would
 *    write the same corner of the site forever; a rotation, so every topic area gets a turn.
 *    `rotationOffset` (how much has already been written for this tenant) makes it advance on
 *    its own between runs and stay deterministic within one.
 *
 *  Returns null when there is nothing to seed from. The caller then does what it always did. */
export function chooseSeed(profile: SiteProfile | null | undefined, rotationOffset = 0): SeedChoice | null {
  if (!profile) return null;

  const gaps = [...(profile.content_gaps ?? [])]
    .filter((g) => g && String(g.query ?? "").trim())
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));

  const clusters = [...(profile.topic_clusters ?? [])]
    .filter((c) => c && String(c.name ?? "").trim())
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

  // One list, gaps ahead of clusters, and the offset walks it. Once the gaps are used up the
  // rotation carries on into the clusters, and wraps — no run is ever left with nothing.
  const wheel: SeedChoice[] = [
    ...gaps.map((g) => ({
      keyword: g.query.trim(),
      from: "content_gap" as const,
      why:
        `Google already shows your site for "${g.query.trim()}" — ${g.impressions} time${g.impressions === 1 ? "" : "s"}` +
        `${g.position != null ? `, at position ${g.position.toFixed(1)}` : ""} — and no page on your site answers it.`,
    })),
    ...clusters.map((c) => ({
      keyword: c.name.trim(),
      from: "topic_cluster" as const,
      why: `"${c.name.trim()}" is one of the ${clusters.length} subjects your site covers (${c.size} page${c.size === 1 ? "" : "s"}) — this run's turn in the rotation.`,
    })),
  ];

  if (!wheel.length) return null;
  const offset = Number.isFinite(rotationOffset) ? Math.abs(Math.trunc(rotationOffset)) : 0;
  return wheel[offset % wheel.length];
}

/** The topic this run is about, and where it came from.
 *
 *  Keeps the pre-Site-Brain contract exactly: a blank topic with no profile to seed from
 *  still throws the same sentence it always threw, with the same wording, so nothing
 *  downstream that matches on it changes behaviour. */
export function resolveSeed(
  topic: string | null | undefined,
  profile: SiteProfile | null | undefined,
  rotationOffset = 0
): { topic: string; seed: SeedChoice | null } {
  const given = String(topic ?? "").trim();
  if (given) return { topic: given, seed: null };

  const seed = chooseSeed(profile, rotationOffset);
  if (!seed) throw new Error("keyword job needs a 'topic' string");
  return { topic: seed.keyword, seed };
}

/** A profile that exists but says almost nothing. Three of the fields this agent actually uses
 *  are empty, so expanding against it would be expanding against nothing and scoring against
 *  it is impossible. Treated as "no profile" everywhere, and said so in the result. */
export function profileIsThin(profile: SiteProfile | null | undefined): boolean {
  if (!profile) return true;
  const hasCentroid = (profile.topic_clusters ?? []).some((c) => Array.isArray(c?.centroid) && c.centroid.length > 0);
  return !profile.what_they_do && !(profile.offerings ?? []).length && !hasCentroid;
}

// ── 2 · expanding a given topic in the site's context (§25.3) ───────────────────────────────

/** "ISO 27001" → the queries a real customer of THIS business would type.
 *
 *  ONE LLM call, no numbers, capped output. The model is given what_they_do, the offerings
 *  that share words with the topic, the nearest cluster and the service area, and is asked for
 *  phrasings only. It is explicitly forbidden from inventing a service the business does not
 *  sell, because an expansion that invents an offering produces a keyword that produces an
 *  article about something the customer cannot buy.
 *
 *  Everything it returns is carried as a PHRASING, never as demand. There is no volume figure
 *  attached anywhere and the blueprint prints them under their own honesty note. */
export async function expandInSiteContext(
  topic: string,
  profile: SiteProfile,
  ask: (prompt: string) => Promise<any> = completeJson
): Promise<string[]> {
  const offerings = matchOfferings(topic, profile, 4);
  const cluster = nearestCluster(topic, profile);

  const prompt = [
    "You are rephrasing one topic as the searches a real customer of ONE specific business would type.",
    "",
    profile.what_they_do ? `The business: ${profile.what_they_do}` : "",
    profile.audience ? `Who buys from them: ${profile.audience}` : "",
    profile.geo ? `Where they work: ${profile.geo}` : "",
    offerings.length ? `Relevant things they actually sell:\n${offerings.map((o) => `- ${o.name}`).join("\n")}` : "",
    cluster ? `This topic sits in their "${cluster.name}" subject area.` : "",
    "",
    `TOPIC: ${topic}`,
    "",
    "Give up to 6 search queries someone would type into Google before buying this from THIS business.",
    "Rules: use their own vocabulary and their service area where it is natural; keep each query under 10 words;",
    "do NOT invent a service, product, price, certificate or location that is not stated above;",
    "do NOT return questions about a different industry.",
    "",
    'Reply with ONLY JSON: {"queries": ["...", "..."]}',
  ]
    .filter(Boolean)
    .join("\n");

  const answer = await ask(prompt);
  const raw = Array.isArray(answer?.queries) ? answer.queries : [];
  const seen = new Set<string>([topic.trim().toLowerCase()]);
  const out: string[] = [];
  for (const q of raw) {
    const v = String(q ?? "").trim().replace(/\s+/g, " ");
    if (!v || v.length > 90) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= 6) break;
  }
  return out;
}

// ── 3 · the fit score (§25.3) ───────────────────────────────────────────────────────────────

export type FitDrop = {
  keyword: string;
  fitScore: number;
  nearestCluster: string | null;
  /** The sentence the UI shows. It names the number and the threshold, so "why was this
   *  dropped" never needs a developer to answer it. */
  why: string;
};

export type FitOutcome = {
  kept: Related[];
  dropped: FitDrop[];
  /** How many candidates actually got an embedding call. */
  scored: number;
  /** True when the cap stopped us scoring everything — the rest were kept, unscored. */
  capped: boolean;
  /** False when there was nothing to score against (no profile, no centroids) or the
   *  embedding service could not be reached. Nothing is ever dropped when this is false. */
  available: boolean;
  error: string | null;
};

/** Score every candidate against what this site is about, and drop the ones that are not.
 *
 *  cosine(candidate, nearest topic-cluster centroid). The centroids are already in the
 *  profile — the analyst computed them from the crawl's page embeddings with the same model
 *  and the same input_type this function embeds with, so the numbers are directly comparable
 *  (agents/analyst.ts, buildClusters). Centroids are unit length, so cosine is a dot product.
 *
 *  What it will NOT do, each for a reason:
 *   · it never drops a keyword the user typed (`protect`) — a suggestion engine that deletes
 *     the thing you asked for is broken whatever its maths says;
 *   · it never drops an UNSCORED candidate. Past the cap, on a dimension mismatch (a profile
 *     built by an older embedding model), or when the embedding call fails, fitScore stays
 *     null and the candidate survives. "We did not measure it" is not "it is off topic";
 *   · it never fails the run. Every failure path returns the candidates untouched with
 *     `available: false` and the reason in `error`. */
export async function scoreFitAgainstSite(
  candidates: Related[],
  profile: SiteProfile | null | undefined,
  options?: { protect?: string[]; embedFn?: (text: string) => Promise<number[]>; cap?: number; min?: number }
): Promise<FitOutcome> {
  const cap = options?.cap ?? FIT_MAX_EMBEDDINGS;
  const min = options?.min ?? FIT_MIN_SCORE;
  const embedFn = options?.embedFn ?? embed;
  const protectedKeys = new Set((options?.protect ?? []).map((k) => k.trim().toLowerCase()));

  const centroids = (profile?.topic_clusters ?? [])
    .filter((c) => Array.isArray(c?.centroid) && c.centroid!.length > 0)
    .map((c) => ({ name: c.name, vec: unit(c.centroid as number[]) }));

  if (!candidates.length || !centroids.length) {
    return {
      kept: candidates,
      dropped: [],
      scored: 0,
      capped: false,
      available: false,
      error: centroids.length ? null : "No topic clusters with embeddings in the site profile — nothing to measure fit against.",
    };
  }

  const toScore = candidates.slice(0, cap);
  const capped = candidates.length > toScore.length;
  let error: string | null = null;
  let scored = 0;

  const vectors = await mapWithConcurrency(toScore, FIT_CONCURRENCY, async (c) => {
    try {
      return await embedFn(c.keyword);
    } catch (e: any) {
      // Recorded once, not per candidate: twenty copies of "NVIDIA_API_KEY missing" in a
      // result is noise. The candidate simply stays unscored.
      if (!error) error = String(e?.message ?? e).slice(0, 200);
      return null;
    }
  });

  const kept: Related[] = [];
  const dropped: FitDrop[] = [];

  toScore.forEach((c, i) => {
    const vec = vectors[i];
    if (!vec || !vec.length || vec.length !== centroids[0].vec.length) {
      // Unscored — kept, and honestly marked as unmeasured rather than as a zero.
      kept.push({ ...c, fitScore: null, fitCluster: null });
      return;
    }
    scored++;
    const v = unit(vec);
    let best = -1;
    let bestName: string | null = null;
    for (const centroid of centroids) {
      const sim = dot(v, centroid.vec);
      if (sim > best) { best = sim; bestName = centroid.name; }
    }
    const fitScore = Number(best.toFixed(4));

    if (fitScore < min && !protectedKeys.has(c.keyword.trim().toLowerCase())) {
      dropped.push({
        keyword: c.keyword,
        fitScore,
        nearestCluster: bestName,
        why: `Not what this site is about — it scores ${fitScore.toFixed(2)} against its closest subject${bestName ? ` ("${bestName}")` : ""}, and anything under ${min.toFixed(2)} is a different business's keyword.`,
      });
      return;
    }
    kept.push({ ...c, fitScore, fitCluster: bestName });
  });

  // Past the cap: kept as they were, explicitly unscored.
  for (const c of candidates.slice(toScore.length)) kept.push({ ...c, fitScore: null, fitCluster: null });

  return { kept, dropped, scored, capped, available: scored > 0, error };
}

/** This exact search, already earning impressions for this site (§25.3's third column).
 *
 *  Two measured sources, both from Search Console, checked in order of usefulness:
 *   · a content gap the analyst recorded — impressions with NO page answering them;
 *   · the striking-distance list (position 5-25, insights.ts) — a page ranks, just not well
 *     enough to be clicked.
 *
 *  Exact match on the normalised query only. A fuzzy match here would attach one query's
 *  impressions to a different query, which is precisely the sort of number-borrowing the rest
 *  of this pipeline refuses to do. */
export function gscOpportunityFor(
  keyword: string,
  insights: SiteInsights | null | undefined,
  profile: SiteProfile | null | undefined
): GscOpportunity | null {
  const wanted = normQuery(keyword);
  if (!wanted) return null;

  const gap = (profile?.content_gaps ?? []).find((g) => normQuery(g.query) === wanted);
  if (gap) {
    return { query: gap.query, impressions: gap.impressions, position: gap.position ?? null, clicks: null, from: "content-gap" };
  }

  const striking = (insights?.strikingDistance ?? []).find((q) => normQuery(q.query) === wanted);
  if (striking) {
    return { query: striking.query, impressions: striking.impressions, position: striking.position, clicks: striking.clicks, from: "striking-distance" };
  }
  return null;
}

// ── the receipt ─────────────────────────────────────────────────────────────────────────────

/** One sentence saying what the Site Brain did for this run — including when it did nothing.
 *  It is shown to a business owner, so it says what to do next rather than what was null. */
export function profileNote(profile: SiteProfile | null | undefined, thin: boolean, fit: FitOutcome): string {
  if (!profile) {
    return "Aapki site ka profile abhi nahi bana — ye keywords sirf topic se nikale gaye hain. Site crawl + analysis chalao, phir ye keywords aapki site ke hisaab se aayenge.";
  }
  if (thin) {
    return "Site profile to hai, par usme abhi itna kuch nahi ki keywords ko site se match kiya ja sake. Crawl dobara chalao ya Settings → Site Brain me apna business bhar do.";
  }
  if (!fit.available) {
    return `Site profile padha gaya, par fit score nahi nikal saka${fit.error ? ` (${fit.error})` : ""} — keywords poore dikhaye ja rahe hain, ek bhi hataya nahi gaya.`;
  }
  const dropped = fit.dropped.length;
  return (
    `Aapki site ka profile padh kar ${fit.scored} keyword check kiye` +
    (dropped ? `, aur ${dropped} jo aapke business ke baare me nahi the wo hata diye.` : ` — sabhi aapke business se match karte hain.`) +
    (fit.capped ? ` (Baaki keywords is run me score nahi hue, hataye bhi nahi gaye.)` : "")
  );
}

/** How much has already been written for this tenant. Only used to advance the seed rotation,
 *  so a failure is a zero and never an error — the rotation simply starts at the top. */
async function countWritten(tenantId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (error) return 0;
    return Number(count) || 0;
  } catch {
    return 0;
  }
}

// ── small maths and small helpers ───────────────────────────────────────────────────────────

function unit(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normQuery(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeByKeyword<T extends { keyword: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of items) {
    const key = normQuery(i.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

/** Promise.all over everything at once would stack the whole batch behind the shared NVIDIA
 *  limiter in one go; this keeps a small window moving instead. Order of results matches the
 *  order of the input, which the caller relies on to pair vectors back to candidates. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
