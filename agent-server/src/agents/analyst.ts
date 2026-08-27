import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { supabase } from "../supabase.js";
import { completeJson } from "../lib/llm.js";
import { embed } from "../lib/embeddings.js";
import { loadInsights } from "../lib/insights.js";
import {
  loadActiveProfile,
  saveProfile,
  diffProfiles,
  emptyProfile,
  type SiteProfile,
  type Offering,
  type Proof,
  type TopicCluster,
  type ContentGap,
  type ProfileField,
  type Confidence,
} from "../lib/siteProfile.js";

/** Mr. Analyst — the step that turns a crawl into an understanding (rebuild plan §25).
 *
 *  The crawler already reads the whole site and stores text + embeddings. Nothing then reads
 *  it properly: the planner gets 40 page TITLES and the writer gets a list of URLs. This agent
 *  is the missing middle. It reads the pages, reads Search Console, and writes one versioned
 *  `site_profile` that every other agent starts from.
 *
 *  Chain position:   crawler  ->  ANALYST  ->  (keyword | boss | writer | leads | support)
 *
 *  The rule the whole thing hangs on, from the plan: the profile is EVIDENCE, not a guess.
 *  Concretely, in this file:
 *
 *   · every field carries the URL(s) it came from, and a field with no source is not written;
 *   · the model is asked for facts and then CHECKED against the crawled text — an offering
 *     whose page we never crawled is dropped, a proof claim whose quote does not appear
 *     verbatim on the page is dropped. The model gets to find things, not to assert them;
 *   · anything the site does not say and the user has not told us stays null/empty. There is
 *     no "unknown" placeholder anywhere, because a placeholder is an invitation to fill it in;
 *   · a field the user edited by hand is copied forward untouched (§25.9). We suggest; we
 *     never overwrite a correction;
 *   · one bad model reply cannot lose the run. Each field group is its own try/catch: it logs,
 *     leaves the field empty, and the other nine fields still get written.
 */
export class AnalystAgent extends Agent {
  type = "analyst";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;

    ctx.onProgress({ phase: "loading", label: "Opening everything we know about this site..." });

    const [{ data: tenant }, { data: pageRows }, insights, previous] = await Promise.all([
      supabase.from("tenants").select("name, website_url, niche, tone_profile, icp_profile").eq("id", tenantId).single(),
      supabase
        .from("site_pages")
        .select("id, url, title, content_text, embedding")
        .eq("tenant_id", tenantId)
        .limit(MAX_PAGES),
      loadInsights(tenantId),
      loadActiveProfile(tenantId),
    ]);

    const pages: Page[] = (pageRows ?? [])
      .map((r: any) => ({
        id: String(r.id),
        url: String(r.url ?? ""),
        title: String(r.title ?? "").trim(),
        text: String(r.content_text ?? "").trim(),
        embedding: parseEmbedding(r.embedding),
        path: pathOf(String(r.url ?? "")),
      }))
      .filter((p) => p.url);

    // No crawl, no profile. Returned rather than thrown: nothing about this is retryable, and
    // the fix ("run the crawler") belongs in front of the user, not in a stack trace.
    if (!pages.length) {
      return {
        built: false,
        reason: "No crawled pages on file — run the site crawler first; there is nothing here to read.",
      };
    }

    const profile = emptyProfile();
    const sources: Partial<Record<ProfileField, string[]>> = {};
    const confidence: Partial<Record<ProfileField, Confidence>> = {};
    // Every field group that failed, so a half-built profile says which half and why instead
    // of looking like a complete one with holes in it.
    const failures: { field: string; error: string }[] = [];

    const ranked = [...pages].sort((a, b) => keyPageScore(b) - keyPageScore(a));
    const keyPages = ranked.filter((p) => p.text).slice(0, KEY_PAGES_FOR_LLM);

    // ── 1 · what they do / who for / what those buyers ask ────────────────────────────────
    ctx.onProgress({ phase: "reading", label: "Working out what this business actually does...", pages: pages.length });
    try {
      const evidence = keyPages.slice(0, 8);
      const answer = await completeJson<{ what_they_do?: string; audience?: string; buyer_intent?: string[] }>(
        [
          "You are reading a real business's own website in order to describe it factually.",
          "",
          pageDigest(evidence, 1200),
          "",
          "From ONLY the text above, answer:",
          '- what_they_do: ONE paragraph (max 45 words) saying what this business sells and to whom. Use their own words where you can.',
          "- audience: who buys from them, in one short phrase. Null if the pages never say.",
          "- buyer_intent: up to 5 short questions a real buyer would arrive with, phrased as they would type them.",
          "",
          "Rules: state nothing the pages do not say. No adjectives of your own (no 'leading', 'premier', 'trusted').",
          "If the pages do not support a field, return null (or [] for the list) rather than guessing.",
          "",
          'Reply with ONLY JSON: {"what_they_do": "..."|null, "audience": "..."|null, "buyer_intent": ["..."]}',
        ].join("\n")
      );

      profile.what_they_do = cleanText(answer?.what_they_do, 400);
      profile.audience = cleanText(answer?.audience, 200);
      profile.buyer_intent = uniqStrings(answer?.buyer_intent, 5, 140);

      const urls = evidence.map((p) => p.url);
      if (profile.what_they_do) { sources.what_they_do = urls; confidence.what_they_do = evidence.length >= 3 ? "high" : "medium"; }
      if (profile.audience) { sources.audience = urls; confidence.audience = evidence.length >= 3 ? "medium" : "low"; }
      if (profile.buyer_intent.length) { sources.buyer_intent = urls; confidence.buyer_intent = "low"; }
    } catch (e: any) {
      console.error("[analyst] identity extraction failed:", e?.message);
      failures.push({ field: "what_they_do", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 2 · offerings — what they sell, and the page that sells it ────────────────────────
    ctx.onProgress({ phase: "offerings", label: "Listing what they sell..." });
    try {
      const candidates = ranked.filter((p) => OFFERING_PATH.test(p.path) || keyPageScore(p) >= 60).slice(0, 40);
      const list = candidates.length ? candidates : ranked.slice(0, 25);
      const answer = await completeJson<{ offerings?: { name?: string; url?: string; kind?: string }[] }>(
        [
          "These are pages from one business's website (URL then page title, then a short extract of some):",
          "",
          list.map((p) => `- ${p.url} | ${p.title}`).join("\n"),
          "",
          pageDigest(list.filter((p) => p.text).slice(0, 4), 600),
          "",
          "List the products and services this business sells, one entry per distinct offering.",
          "For each: the name as THEY write it, the URL from the list above that sells it (copy it exactly, never invent one),",
          'and kind: "product" or "service".',
          "Do not list blog posts, news, careers, policies or contact pages. Do not merge two different offerings into one.",
          "If the pages do not show any offering, return an empty list.",
          "",
          'Reply with ONLY JSON: {"offerings":[{"name":"...","url":"...","kind":"service"}]}',
        ].join("\n")
      );

      // The check that makes this evidence rather than a list of plausible services: an
      // offering must point at a page we actually crawled, or at minimum be named on one.
      const byUrl = new Map(pages.map((p) => [normalizeUrl(p.url), p]));
      const haystack = pages.map((p) => `${p.title} ${p.text}`.toLowerCase()).join(" \n ");
      const seen = new Set<string>();
      const offerings: Offering[] = [];

      for (const o of answer?.offerings ?? []) {
        const name = cleanText(o?.name, 120);
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;

        const page = o?.url ? byUrl.get(normalizeUrl(String(o.url))) : undefined;
        // No known page AND the name never appears in any crawled text = invented. Drop it.
        if (!page && !haystack.includes(key)) continue;

        seen.add(key);
        offerings.push({
          name,
          url: page?.url ?? null,
          kind: o?.kind === "product" ? "product" : o?.kind === "service" ? "service" : "unknown",
        });
        if (offerings.length >= 25) break;
      }

      profile.offerings = offerings;
      if (offerings.length) {
        sources.offerings = uniqStrings(offerings.map((o) => o.url).filter(Boolean) as string[], 25, 500);
        const withUrl = offerings.filter((o) => o.url).length;
        confidence.offerings = withUrl >= 3 ? "high" : withUrl > 0 ? "medium" : "low";
      }
    } catch (e: any) {
      console.error("[analyst] offerings extraction failed:", e?.message);
      failures.push({ field: "offerings", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 3 · proof — the only facts the writer will be allowed to state ────────────────────
    ctx.onProgress({ phase: "proof", label: "Collecting the facts they can prove..." });
    try {
      const evidence = ranked.filter((p) => p.text && (PROOF_PATH.test(p.path) || keyPageScore(p) >= 70)).slice(0, 6);
      const pool = evidence.length ? evidence : keyPages.slice(0, 4);
      const answer = await completeJson<{ proof?: { claim?: string; quote?: string; url?: string }[] }>(
        [
          "Read these pages from a business's own website:",
          "",
          pageDigest(pool, 1500),
          "",
          "Extract only VERIFIABLE claims this business makes about itself: certifications and accreditations,",
          "awards, years in business, number of clients or projects, named qualifications, memberships, locations.",
          "For each, give: claim (short, factual), quote (the exact words from the page, copied character for character),",
          "and url (the page it came from, copied from the headings above).",
          "Do NOT include marketing adjectives, promises, or anything you cannot quote. An empty list is a correct answer.",
          "",
          'Reply with ONLY JSON: {"proof":[{"claim":"...","quote":"...","url":"..."}]}',
        ].join("\n")
      );

      // Verified, not trusted: a quote that is not on the page is a hallucination, and this is
      // the one field an article will state as fact. Whitespace/case normalised, nothing else.
      const normalized = new Map(pool.map((p) => [p.url, norm(p.text)]));
      const proof: Proof[] = [];
      for (const item of answer?.proof ?? []) {
        const claim = cleanText(item?.claim, 200);
        const quote = cleanText(item?.quote, 300);
        if (!claim || !quote) continue;
        const q = norm(quote);
        if (q.length < 8) continue;
        const from = [...normalized.entries()].find(([, text]) => text.includes(q));
        if (!from) continue; // not on any page we read -> not proof
        proof.push({ claim, quote, url: from[0] });
        if (proof.length >= 12) break;
      }

      profile.proof = proof;
      if (proof.length) {
        sources.proof = uniqStrings(proof.map((p) => p.url).filter(Boolean) as string[], 12, 500);
        confidence.proof = "high"; // every entry survived a verbatim check against the page
      }
    } catch (e: any) {
      console.error("[analyst] proof extraction failed:", e?.message);
      failures.push({ field: "proof", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 4 · voice — how they write, so we do not write like someone else ──────────────────
    ctx.onProgress({ phase: "voice", label: "Learning how they write..." });
    try {
      const evidence = keyPages.slice(0, 4);
      const answer = await completeJson<{ tone?: string; do?: string[]; dont?: string[]; samples?: string[] }>(
        [
          "Here is writing from one business's website:",
          "",
          pageDigest(evidence, 1200),
          "",
          "Describe HOW they write, so another writer could match it:",
          '- tone: a few words (e.g. "formal, plain, no hype")',
          "- do: up to 4 concrete habits to copy (person used, sentence length, whether they quote numbers, how they address the reader)",
          "- dont: up to 4 things they never do",
          "- samples: up to 3 sentences copied EXACTLY from the text above that are typical of them",
          "",
          'Reply with ONLY JSON: {"tone":"...","do":["..."],"dont":["..."],"samples":["..."]}',
        ].join("\n")
      );

      // Samples are quotes too — same rule as proof. A "typical sentence" the model wrote
      // itself would teach the writer the wrong voice, which is the exact opposite of the job.
      const corpus = norm(evidence.map((p) => p.text).join(" \n "));
      const samples = uniqStrings(answer?.samples, 3, 300).filter((s) => corpus.includes(norm(s)));

      const tone = cleanText(answer?.tone, 160);
      const dos = uniqStrings(answer?.do, 4, 160);
      const donts = uniqStrings(answer?.dont, 4, 160);

      if (tone || dos.length || donts.length || samples.length) {
        profile.voice = { tone, do: dos, dont: donts, samples };
        sources.voice = evidence.map((p) => p.url);
        confidence.voice = samples.length ? "medium" : "low";
      }
    } catch (e: any) {
      console.error("[analyst] voice extraction failed:", e?.message);
      failures.push({ field: "voice", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 5 · geo + language ────────────────────────────────────────────────────────────────
    ctx.onProgress({ phase: "place", label: "Finding where they work..." });
    try {
      const evidence = ranked.filter((p) => p.text && (GEO_PATH.test(p.path) || keyPageScore(p) >= 90)).slice(0, 4);
      const pool = evidence.length ? evidence : keyPages.slice(0, 3);
      const answer = await completeJson<{ geo?: string; language?: string }>(
        [
          "Read these pages from a business's website:",
          "",
          pageDigest(pool, 900),
          "",
          "- geo: the places this business serves or operates in, as the pages state them (city, region, countries).",
          "  Null if the pages never say. Do not infer a country from the language or the domain.",
          '- language: the language the pages are written in, as an ISO code ("en", "hi", "ar").',
          "",
          'Reply with ONLY JSON: {"geo": "..."|null, "language": "..."|null}',
        ].join("\n")
      );

      profile.geo = cleanText(answer?.geo, 160);
      const lang = cleanText(answer?.language, 12);
      profile.language = lang ? lang.toLowerCase().slice(0, 5) : null;

      if (profile.geo) { sources.geo = pool.map((p) => p.url); confidence.geo = evidence.length ? "high" : "low"; }
      if (profile.language) { sources.language = pool.map((p) => p.url); confidence.language = "high"; }
    } catch (e: any) {
      console.error("[analyst] geo/language extraction failed:", e?.message);
      failures.push({ field: "geo", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 6 · competitors and goals — the two fields only a HUMAN can fill ──────────────────
    // §25.2 says both come from user input, and §25.7 adds the onboarding screen that asks.
    // Until that screen exists these stay empty rather than being guessed from the site: a
    // wrong goal ("traffic" when they wanted enquiries) misdirects every agent downstream.
    // If onboarding already stored something on the tenant, it is carried in as-is.
    const stored = (tenant?.icp_profile as any) ?? {};
    const storedGoals = stored?.goals ?? (tenant?.tone_profile as any)?.goals ?? null;
    if (storedGoals && typeof storedGoals === "object") {
      const primary = String(storedGoals.primary ?? "").toLowerCase();
      profile.goals = {
        primary: primary === "leads" || primary === "traffic" || primary === "sales" ? (primary as any) : null,
        kpis: uniqStrings(storedGoals.kpis, 5, 120),
      };
      sources.goals = ["onboarding"];
      confidence.goals = "high";
    }
    const storedCompetitors = uniqStrings(stored?.competitors, 8, 200);
    if (storedCompetitors.length) {
      profile.competitors = storedCompetitors;
      sources.competitors = ["onboarding"];
      confidence.competitors = "high";
    }

    // ── 7 · topic clusters, from the embeddings the crawler already paid for ──────────────
    ctx.onProgress({ phase: "clustering", label: "Grouping the site into topics..." });
    const embedded = pages.filter((p) => p.embedding && p.embedding.length);
    let clusters: TopicCluster[] = [];
    try {
      clusters = buildClusters(embedded);
      if (clusters.length) {
        clusters = await labelClusters(clusters, failures, new Map(pages.map((p) => [p.url, p.title])));
        profile.topic_clusters = clusters;
        sources.topic_clusters = uniqStrings(clusters.flatMap((c) => c.page_urls.slice(0, 3)), 40, 500);
        // Derived from measured vectors, but the LABEL is a model's word for the group, so
        // never "high": it is a name we would happily let the user correct.
        confidence.topic_clusters = embedded.length >= CLUSTER_MIN_PAGES * 2 ? "medium" : "low";
      }
    } catch (e: any) {
      console.error("[analyst] clustering failed:", e?.message);
      failures.push({ field: "topic_clusters", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 8 · content gaps: searches they are seen for, with no page answering ──────────────
    ctx.onProgress({ phase: "gaps", label: "Comparing Search Console against the pages we have..." });
    let gapsChecked = 0;
    try {
      if (insights.connected && embedded.length) {
        // Candidates come from the two buckets that mean "real people saw us for this and did
        // not get what they wanted": striking distance (position 5-25) and missed (lots of
        // impressions, near-zero clicks). insights.winning is deliberately excluded — a query
        // already earning clicks has a page serving it, which is the opposite of a gap.
        const candidates = [...insights.strikingDistance, ...insights.missed]
          .filter((q) => q.impressions >= GAP_MIN_IMPRESSIONS)
          .filter((q, i, all) => all.findIndex((o) => o.query === q.query) === i)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, GAP_MAX_QUERIES);

        // Normalised once, not once per query: 40 queries against 300 pages would otherwise
        // re-normalise twelve thousand 1024-dimension vectors for no reason.
        const unitPages = embedded.map((p) => ({ page: p, vec: normalize(p.embedding!) }));

        const gaps: ContentGap[] = [];
        for (const q of candidates) {
          gapsChecked++;
          ctx.onProgress({ phase: "gaps", done: gapsChecked, total: candidates.length, current: q.query });
          let vector: number[];
          try {
            vector = normalize(await embed(q.query));
          } catch (e: any) {
            // One rate-limited embedding must not end the run — skip this query, keep going.
            console.error("[analyst] gap embed failed for", q.query, e?.message);
            continue;
          }

          let best = -1;
          let bestPage: Page | null = null;
          for (const { page, vec } of unitPages) {
            const sim = dot(vector, vec);
            if (sim > best) { best = sim; bestPage = page; }
          }

          if (best >= GAP_MAX_SIMILARITY) continue; // a page already answers this
          gaps.push({
            query: q.query,
            impressions: q.impressions,
            position: Number.isFinite(q.position) ? q.position : null,
            nearest_similarity: Number(best.toFixed(4)),
            nearest_url: bestPage?.url ?? null,
            nearest_cluster: bestPage ? (clusters.find((c) => c.page_urls.includes(bestPage!.url))?.name ?? null) : null,
          });
        }

        profile.content_gaps = gaps.sort((a, b) => b.impressions - a.impressions).slice(0, 20);
        if (profile.content_gaps.length) {
          sources.content_gaps = ["google-search-console"];
          // Measured on both sides — real impressions, real page vectors. The only judgement
          // in it is the similarity threshold, which is written down (GAP_MAX_SIMILARITY).
          confidence.content_gaps = "high";
        }
      }
    } catch (e: any) {
      console.error("[analyst] content gaps failed:", e?.message);
      failures.push({ field: "content_gaps", error: String(e?.message ?? e).slice(0, 200) });
    }

    // ── 9 · carry the user's own corrections forward, then save a new version ─────────────
    profile.confidence = confidence;
    profile.sources = sources;

    const userEdited = previous?.profile.user_edited ?? [];
    for (const field of userEdited) {
      // §25.9: "user-edited field ko agent kabhi nahi chhoota, sirf suggestion deta hai."
      // Copying the old value forward is how that survives a re-run; the agent's version of
      // the field is simply discarded rather than being offered as a change the user has to
      // reject again every week.
      (profile as any)[field] = (previous!.profile as any)[field];
      if (previous!.profile.sources?.[field]) sources[field] = previous!.profile.sources[field];
      confidence[field] = previous!.profile.confidence?.[field] ?? "high";
    }
    if (userEdited.length) profile.user_edited = [...userEdited];

    // A profile with nothing in it is not worth a version row: it would show up in the UI as
    // "we understood your site" while saying nothing at all.
    const filled = countFilled(profile);
    if (!filled) {
      return {
        built: false,
        pages: pages.length,
        failures,
        reason: "Nothing could be established from the crawled pages — no version was written.",
      };
    }

    ctx.onProgress({ phase: "saving", label: "Writing the site profile..." });
    const saved = await saveProfile(tenantId, profile, {
      builtFrom: {
        pages: pages.length,
        page_urls: pages.slice(0, 50).map((p) => p.url),
        gsc_period: insights.connected ? insights.period : null,
        gsc_queries: gapsChecked,
        clustered_pages: embedded.length,
      },
      createdBy: "agent:analyst",
    });

    // The freshness card of §25.9 ("3 new service pages found, 1 gone -- update the profile?")
    // is this list. Computed here, while both versions are in hand.
    const changes = previous ? diffProfiles(previous.profile, profile) : [];

    return {
      built: true,
      version: saved.version,
      pages: pages.length,
      clustered: embedded.length,
      clusters: profile.topic_clusters.map((c) => ({ name: c.name, pages: c.size })),
      offerings: profile.offerings.length,
      proof: profile.proof.length,
      gaps: profile.content_gaps.length,
      gapsChecked,
      changes: changes.map((c) => c.text),
      // Named, not just counted — a profile that quietly lost its proof section should say so.
      failures,
    };
  }
}

// ── tuning, all in one place and all justified ──────────────────────────────────────────────

// The crawler's own ceiling is 300 pages; reading them all back is one query and a few MB.
const MAX_PAGES = 300;

// The pool of "pages that describe the business" (home/about/services/contact, never the
// blog) that the field extractors draw from. Each call takes a slice of it -- eight pages at
// ~1200 characters is a few thousand tokens, comfortably inside the context and cheap enough
// to re-run on every re-crawl.
const KEY_PAGES_FOR_LLM = 12;

// Below this many embedded pages there is no clustering to do -- one cluster called "the site"
// is worse than no clusters, because the planner would rotate through a list of one.
const CLUSTER_MIN_PAGES = 6;

// A GSC query with fewer impressions than this is noise, not demand. Same floor insights.ts
// already uses for its striking-distance list, deliberately: two different numbers for "enough
// people searched this" would produce two different answers to the same question.
const GAP_MIN_IMPRESSIONS = 20;

// THE GAP THRESHOLD. cosine(query, nearest page) below this = nobody on this site answers it.
//
// Both sides are embedded with the same model and the same input_type (nv-embedqa-e5-v5,
// "passage" -- see lib/embeddings.ts), so the numbers are comparable. On that model, pages from
// one business's site sit high against each other (~0.7-0.9) because they share a subject; a
// page that genuinely answers a query lands above that band, and an unrelated query drops well
// below it. 0.62 is set on the CONSERVATIVE side of that band on purpose: the cost of a missed
// gap is one article we did not suggest, and the cost of a false gap is a duplicate article on
// a subject the site already covers -- which is the exact failure §25.5's locks exist to
// prevent. Missing a few is the cheaper mistake.
//
// Written down here rather than tuned in a prompt so it can be recalibrated from real data
// (plan §12: replace estimates with a week of measurements) by changing one number.
const GAP_MAX_SIMILARITY = 0.62;

// One embedding call per query checked. 40 keeps the whole gap pass inside ~90 seconds at the
// shared 30 rpm limiter (lib/nvidia.ts) while covering every query worth acting on.
const GAP_MAX_QUERIES = 40;

// Path shapes that mark a page as describing the business rather than being its blog.
const OFFERING_PATH = /(^|\/)(services?|products?|solutions?|courses?|training|pricing|plans?|packages?)(\/|$)/i;
const PROOF_PATH = /(^|\/)(about|about-us|why-us|credentials?|accreditations?|certifications?|awards?|clients?|testimonials?)(\/|$)/i;
const GEO_PATH = /(^|\/)(contact|contact-us|locations?|offices?|branches?)(\/|$)/i;

type Page = {
  id: string;
  url: string;
  title: string;
  text: string;
  embedding: number[] | null;
  path: string;
};

/** How much this page is likely to say about the business itself. The homepage first, then
 *  about/services/contact, then everything else — a blog post is a poor place to learn what a
 *  company sells. Deterministic, so two runs read the same pages and the diff stays honest. */
function keyPageScore(p: Page): number {
  const path = p.path;
  if (!path || path === "/") return 100;
  if (GEO_PATH.test(path)) return 92;
  if (PROOF_PATH.test(path)) return 80;
  if (OFFERING_PATH.test(path)) return 70;
  if (/(^|\/)(blog|news|articles?|posts?|category|tag)(\/|$)/i.test(path)) return 5;
  // Shallow pages beat deep ones: /services beats /services/iso/9001/faq.
  const depth = path.split("/").filter(Boolean).length;
  return Math.max(10, 50 - depth * 8);
}

function pageDigest(pages: Page[], perPage: number): string {
  return pages
    .map((p) => `--- ${p.url}\nTITLE: ${p.title}\n${p.text.slice(0, perPage)}`)
    .join("\n\n");
}

// ── clustering: spherical k-means over the embeddings the crawler already stored ────────────

/** Topic clusters (plan §25.2) in plain TypeScript, no new dependency.
 *
 *  Spherical k-means: every vector is unit length, so cosine similarity IS the dot product and
 *  "nearest centroid" is one multiply-add per dimension. On a few hundred 1024-dim pages this
 *  is milliseconds.
 *
 *  k = round(sqrt(n / 2)), clamped to 2..8. This is the standard rule-of-thumb and it is used
 *  here instead of a fixed cosine cut-off for one specific reason: an absolute similarity
 *  threshold means something completely different on a single-subject site (where every page
 *  is ~0.85 similar to every other) than on a broad one, so a threshold that groups a plumber's
 *  site sensibly puts an ISO consultancy in one lump. A k that scales with size does not have
 *  that failure. The 8 ceiling is a product decision: the planner rotates coverage across
 *  clusters, and more than eight "topics" is a list nobody can act on.
 *
 *  Seeding is deterministic (farthest-point, starting from the page nearest the site's overall
 *  mean), not random. Two runs over an unchanged site must produce the same clusters, or every
 *  weekly re-crawl would show the user a diff full of renamed topics that did not change. */
function buildClusters(pages: Page[]): TopicCluster[] {
  if (pages.length < CLUSTER_MIN_PAGES) return [];

  const vectors = pages.map((p) => normalize(p.embedding!));
  const n = vectors.length;
  const k = Math.max(2, Math.min(8, Math.round(Math.sqrt(n / 2))));

  // Seed 1: the page closest to the middle of the site — its most representative page.
  const mean = normalize(sum(vectors));
  let seedIdx = argmax(vectors.map((v) => dot(v, mean)));
  const centroids: number[][] = [vectors[seedIdx].slice()];

  // Seeds 2..k: each time, the page least like everything chosen so far.
  while (centroids.length < k) {
    const worst = vectors.map((v) => Math.max(...centroids.map((c) => dot(v, c))));
    seedIdx = argmin(worst);
    centroids.push(vectors[seedIdx].slice());
  }

  let assignment = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 15; iter++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const best = argmax(centroids.map((c) => dot(vectors[i], c)));
      if (best !== assignment[i]) { assignment[i] = best; moved++; }
    }
    if (iter > 0 && moved === 0) break;

    for (let c = 0; c < k; c++) {
      const members = vectors.filter((_, i) => assignment[i] === c);
      // An emptied centroid keeps its old position rather than being re-seeded at random:
      // it simply collects nothing and is dropped below. Determinism over tidiness.
      if (members.length) centroids[c] = normalize(sum(members));
    }
  }

  const clusters: TopicCluster[] = [];
  for (let c = 0; c < k; c++) {
    const members = pages.filter((_, i) => assignment[i] === c);
    if (members.length < 2) continue; // a "cluster" of one page is just a page
    clusters.push({
      // Provisional name until the model reads the titles. Never left as this if the call
      // works, and readable if it does not.
      name: fallbackLabel(members),
      page_urls: members.map((p) => p.url),
      centroid: centroids[c].map((v) => Number(v.toFixed(6))),
      size: members.length,
    });
  }

  return clusters.sort((a, b) => b.size - a.size);
}

/** Ask the model for a human name for each cluster, given only its page titles. One call for
 *  all clusters. If it fails or comes back the wrong shape, the fallback labels stand — a
 *  cluster called "iso, certification" is still usable, a crashed run is not. */
async function labelClusters(clusters: TopicCluster[], failures: { field: string; error: string }[], titlesByUrl?: Map<string, string>): Promise<TopicCluster[]> {
  try {
    const blocks = clusters.map((c, i) => {
      const titles = c.page_urls.slice(0, 10).map((u) => titlesByUrl?.get(u) ?? lastSegmentWords(u));
      return `${i + 1}. ${titles.join(" | ")}`;
    });
    const answer = await completeJson<{ labels?: string[] }>(
      [
        "Each numbered line below is a group of pages from one website, shown as their titles.",
        "",
        ...blocks,
        "",
        `Give a short topic name (2-4 words) for each group, in the same order. Exactly ${clusters.length} names.`,
        "Use the vocabulary of the pages themselves. No marketing words.",
        "",
        'Reply with ONLY JSON: {"labels":["...","..."]}',
      ].join("\n")
    );
    const labels = Array.isArray(answer?.labels) ? answer.labels : [];
    return clusters.map((c, i) => {
      const label = cleanText(labels[i], 60);
      return label ? { ...c, name: label } : c;
    });
  } catch (e: any) {
    console.error("[analyst] cluster labelling failed:", e?.message);
    failures.push({ field: "topic_clusters.labels", error: String(e?.message ?? e).slice(0, 200) });
    return clusters;
  }
}

/** The most common meaningful words across a cluster's titles — a name derived from the data,
 *  used when the model is unavailable. */
function fallbackLabel(pages: Page[]): string {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const w of `${p.title} ${lastSegmentWords(p.url)}`.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < 3 || STOP.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([w]) => w);
  return top.length ? top.join(", ") : `${pages.length} pages`;
}

const STOP = new Set([
  "the", "and", "for", "with", "you", "your", "our", "how", "what", "why", "are", "is", "in", "of", "to",
  "home", "page", "com", "www", "html", "index", "best", "top", "new", "all", "about", "more",
]);

// ── small numeric helpers (no dependency, and none needed) ───────────────────────────────────

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (!n) return v;
  return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

function sum(vectors: number[][]): number[] {
  const out = new Array<number>(vectors[0]?.length ?? 0).fill(0);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i] ?? 0;
  return out;
}

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function argmin(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[best]) best = i;
  return best;
}

/** pgvector comes back over PostgREST as the string "[0.1,0.2,...]", not as an array — and as
 *  an array when it was written in the same process. Handle both, refuse anything else. */
function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const nums = raw.map(Number);
    return nums.every(Number.isFinite) && nums.length ? nums : null;
  }
  if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const nums = parsed.map(Number);
      return nums.every(Number.isFinite) && nums.length ? nums : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ── text helpers ────────────────────────────────────────────────────────────────────────────

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  const v = String(url ?? "").trim().replace(/[#?].*$/, "").replace(/\/+$/, "");
  return v.toLowerCase();
}

function lastSegmentWords(url: string): string {
  const path = pathOf(url);
  const seg = path.split("/").filter(Boolean).pop() ?? "";
  return seg.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ");
}

/** Collapsed whitespace, lower case — the only normalisation applied before a verbatim check.
 *  Anything looser would let a paraphrase pass as a quote. */
function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A trimmed string, or null. Null — not "" and never "unknown": an empty field has to be
 *  visibly empty, both in the database and in the prompt. */
function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s || /^(null|none|n\/?a|unknown|not (stated|specified|mentioned))$/i.test(s)) return null;
  return s.slice(0, max);
}

function uniqStrings(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = cleanText(item, maxLen);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** How many of the profile's fields actually carry evidence. Zero means do not write a version. */
function countFilled(p: SiteProfile): number {
  let n = 0;
  if (p.what_they_do) n++;
  if (p.audience) n++;
  if (p.geo) n++;
  if (p.language) n++;
  if (p.offerings.length) n++;
  if (p.proof.length) n++;
  if (p.topic_clusters.length) n++;
  if (p.content_gaps.length) n++;
  if (p.buyer_intent.length) n++;
  if (p.competitors.length) n++;
  if (p.voice) n++;
  if (p.goals) n++;
  return n;
}
