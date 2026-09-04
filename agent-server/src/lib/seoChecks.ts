/** Mr. SEO's on-page checklist — the same discipline as qualityGate.ts, one level further on.
 *
 *  The quality gate asks "is this fit to publish at all?" (long enough, no placeholder slots,
 *  not the same paragraph twice). This file asks the next question: "will this page actually
 *  answer the query it was written for?" — title, headings, keyword placement, links that
 *  resolve, images that have alt text, sentences a human can finish.
 *
 *  THE RULES, inherited from qualityGate.ts because a draft must not be able to pass one gate
 *  and fail the other on the same evidence:
 *
 *   - Every check is DETERMINISTIC. Nothing here asks a model whether the writing is good.
 *     A number we measured beats a number we generated, every time.
 *   - Every check carries a SEVERITY:
 *       "block" — the page should not go live like this. Any block failure ⇒ passed:false.
 *       "warn"  — worth fixing, not worth stopping for. Costs score only.
 *       "info"  — a note or a skipped check (the evidence to run it does not exist).
 *                 It appears in `issues` so the user can see it, and costs nothing.
 *   - Every failing check carries a FIX the writer can act on: "Add a section on
 *     'installation cost'", not "improve topical coverage". Plan §17.2 step 5: writer-ready
 *     instruction, not an essay.
 *   - Scoring is the gate's: 100 − 25·block − 5·warn, clamped to 0..100.
 *
 *  WHAT IS DELIBERATELY NOT HERE. No "readability grade 8.2", because Flesch on markdown with
 *  a syllable estimator is a made-up number dressed as a measurement; we report the two things
 *  that actually make prose hard to read and can be counted exactly (long sentences, long
 *  paragraphs). No E-E-A-T score. No "originality %". Those would be inventions, and the whole
 *  product rests on not inventing numbers.
 *
 *  THE SERP COMPARISON IS OPTIONAL (plan §17.2: DataForSEO is the paid extra). With no
 *  DataForSEO account the checks above are the whole answer, `serpCompared` is false, and the
 *  result says so in words. It is never faked and never fatal.
 */

import * as cheerio from "cheerio";
import { env } from "../env.js";
import { dataForSeoConfigured } from "./dataforseo.js";
import { nearestCluster } from "./blueprint.js";
import type { SiteProfile } from "./siteProfile.js";

/* ---------------------------------------------------------------- types ----------------- */

export type SeoSeverity = "block" | "warn" | "info";

export type SeoCheck = {
  /** Stable id. The UI and the tests key off this, never off the prose. */
  id: string;
  /** Short human name, for a table row. */
  label: string;
  ok: boolean;
  severity: SeoSeverity;
  /** What we actually measured — a count, a percentage, a length. null when nothing could be. */
  value: number | string | null;
  /** The measurement in words, pass or fail. */
  detail: string;
  /** Writer-ready instruction. null when the check passed. */
  fix: string | null;
};

/** The plan's §7.3 output shape: `issues: [{severity, what, fix}]`. `id` is ours, so the UI can
 *  dedupe across two runs of the same draft. */
export type SeoIssue = { id: string; severity: SeoSeverity; what: string; fix: string };

export type SeoResult = {
  /** 100 − 25·block − 5·warn, clamped. */
  score: number;
  /** false if ANY block check failed, or if the score is under the pass mark. */
  passed: boolean;
  /** Every check that ran, pass or fail. */
  checks: SeoCheck[];
  /** Only the ones that did not pass, in severity order. */
  issues: SeoIssue[];
  /** Block-level failures, as sentences. */
  blockers: string[];
  /** Warn-level failures, as sentences. */
  warnings: string[];
  /** Was the draft compared against the live top 10? False whenever DataForSEO is unconfigured,
   *  the call failed, or too few competitor pages could be read to take a median. */
  serpCompared: boolean;
  /** Why, in one sentence — always set, so "no comparison" is never silent. */
  serpNote: string;
  primaryKeyword: string | null;
  wordCount: number;
};

export type CrawledPage = { url: string; title?: string | null };

export type SeoArticle = {
  /** Markdown, as the writer produces it. */
  body: string;
  /** The H1 is read out of the body when this is absent. */
  title?: string | null;
  /** The <title> tag, when something has produced one. Falls back to `title` for the
   *  SERP-title checks. */
  metaTitle?: string | null;
  metaDescription?: string | null;
  /** The URL slug, when one has been decided. Undefined = decided later, at publish. */
  slug?: string | null;
  /** The writer's own Article JSON-LD (lib/writerPipeline.ts's writeMeta), as a raw string —
   *  same field content_items.meta.jsonLd carries. Absent on anything written before this was
   *  read here, or when writeMeta's model call produced nothing usable; the E-E-A-T checks
   *  below skip rather than fail when it is missing, same convention as every other "the
   *  evidence to run this does not exist" case in this file. */
  jsonLd?: string | null;
};

export type SeoOptions = {
  /** [0] is the primary keyword; the rest are the cluster (plan §17.1: 3-8 per article). */
  keywords?: string[];
  /** The Site Brain. Used for the same-cluster internal-link preference. */
  profile?: SiteProfile | null;
  /** What the crawler has actually seen. An internal link to anything not in here is a 404
   *  waiting to happen on the customer's live site. */
  pages?: CrawledPage[];
  /** The customer's site root, so absolute internal links can be told from outbound ones. */
  siteUrl?: string | null;
  /** A SERP snapshot the caller already has (or a fixture, in tests). When absent, one is
   *  fetched IF DataForSEO is configured. */
  serp?: SerpSnapshot | null;
  /** Test seam / cost control: where the snapshot comes from. */
  fetchSerp?: (keyword: string) => Promise<SerpSnapshot | null>;
};

/* ---------------------------------------------------------------- thresholds ------------ */
/* Every number below is here, named, with the reason it is that number. Recalibrate from a
 * week of real data (plan §12) rather than arguing about it in a prompt. */

/** Google renders roughly 600px of title, which is ~60 characters for most latin text; under
 *  30 and the title is not saying enough to earn a click. Identical to qualityGate's
 *  META_TITLE_RANGE on purpose — one draft, one answer. */
const TITLE_LEN: [number, number] = [30, 65];

/** The keyword must START within the first 30 characters — half of what is displayed. Past
 *  that it risks being cut off in the SERP, and the first words are what a scanning reader
 *  matches against what they just typed. */
const TITLE_KEYWORD_HEAD = 30;

/** Same band as qualityGate's META_DESC_RANGE. Under 80 wastes the snippet; over ~165 is
 *  truncated mid-sentence. */
const META_DESC_LEN: [number, number] = [80, 165];

/** WRITING_RULES asks for one ## per related query, and the gate blocks under 3. Here 2 is the
 *  floor that blocks (a page with one section is not an article), and 3 is the warn — so a
 *  borderline draft is told, not binned, and the two gates never disagree about a real failure. */
const H2_BLOCK_UNDER = 2;
const H2_WARN_UNDER = 3;

/** Keyword density = occurrences × keyword-word-count ÷ total words.
 *   · under 0.5% (fewer than 6 mentions in a 1200-word article) the page never commits to
 *     the query it was written for;
 *   · 0.5–2.5% is the band natural writing lands in;
 *   · 2.5–3.5% reads repetitive — a warning, because a short article about a long phrase can
 *     legitimately sit here;
 *   · above 3.5% is stuffing. That is ~35 mentions in 1000 words: nobody writes that by
 *     accident, and it is the one on-page mistake search engines actively penalise. Block. */
const DENSITY_MIN = 0.005;
const DENSITY_MAX = 0.025;
const DENSITY_STUFFING = 0.035;

/** The opening the reader (and the crawler) sees before deciding to stay. Same 100 words the
 *  quality gate and the writer's prompt use. */
const FIRST_WORDS = 100;

/** Two internal links is the minimum that makes a page part of a site rather than an island.
 *  A warning, never a block: a brand-new site genuinely has nothing to link to yet. */
const MIN_INTERNAL_LINKS = 2;

/** One outbound citation. An article that references nothing reads as unsourced — but service
 *  pages legitimately cite nobody, so this is a warning. */
const MIN_EXTERNAL_LINKS = 1;

/** Cluster keywords the body should actually mention. Half: one article = one cluster of 3-8
 *  keywords (§17.1), and covering under half of it means the draft answered part of its brief. */
const SECONDARY_COVERAGE = 0.5;

/** ~60 characters ≈ 5-6 words: still readable in a SERP, still readable when pasted in chat. */
const SLUG_MAX = 60;

/** Sentences past 30 words are where a reader loses the thread. One in four being like that is
 *  a rewrite signal, not a stylistic quibble. Mean over 20 words is the same signal, milder. */
const LONG_SENTENCE_WORDS = 30;
const LONG_SENTENCE_SHARE = 0.25;
const MEAN_SENTENCE_WORDS = 20;

/** A 150-word paragraph is a full phone screen of unbroken grey. Also flagged when a fifth of
 *  the article is made of 100-word blocks. */
const LONG_PARAGRAPH_WORDS = 150;
const HEAVY_PARAGRAPH_WORDS = 100;
const HEAVY_PARAGRAPH_SHARE = 0.2;

/** Without a SERP median to compare against, this is the floor below which a page is almost
 *  certainly thinner than what ranks: the writer's own brief asks for 1200-1800, and 900 is
 *  three quarters of the bottom of that range. Replaced by the real median when SERP data
 *  exists — a measured competitor median always beats a rule of thumb. */
const THIN_WORDS = 900;

/** We do not have to match the median, but being materially thinner than the page we are
 *  trying to outrank is a real gap. 20% tolerance ≈ one section. */
const SERP_WORD_RATIO = 0.8;

/** A topic 40% of the top results cover and we do not is a hole worth naming (the plan's own
 *  example is 7 of 10). Under that it is one competitor's preference, not the market's. */
const SERP_TOPIC_SHARE = 0.4;

/** A median of two pages is not a median. Below this the comparison is skipped entirely
 *  rather than reported on thin evidence. */
const SERP_MIN_READABLE = 3;

/** Plan §17.2 step 6 and §7.3: under 75 the draft goes back to the writer (at most twice —
 *  the loop belongs to the orchestrator, the threshold belongs here). */
export const SEO_PASS_SCORE = 75;

/** What counts as an About/Contact-style trust page — exported so agents/writer.ts's
 *  `loadWriterContext` finds the SAME page this file's own "About/Contact linked" check looks
 *  for (2026-09-04). Two independent regexes finding two different pages would mean the writer
 *  could link a page and the check still fail it. */
export const TRUST_PAGE_PATTERN = /\/(about|about-us|contact|contact-us|team|who-we-are)(\/|$)/i;

const BLOCK_PENALTY = 25;
const WARN_PENALTY = 5;

/* ---------------------------------------------------------------- markdown ------------- */

type Heading = { level: number; text: string };

type Parsed = {
  h1s: string[];
  headings: Heading[];
  subheads: Heading[]; // H2 + H3, the ones that carry topical coverage
  prose: string;
  words: string[];
  paragraphs: string[];
  sentences: string[];
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
};

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function parseArticle(body: string): Parsed {
  const text = String(body ?? "").replace(/\r/g, "");

  // Images first, then links — otherwise every `![alt](src)` is also counted as a link.
  const images = [...text.matchAll(/!\[([^\]]*)\]\(\s*([^)\s]*)[^)]*\)/g)].map((m) => ({
    alt: (m[1] ?? "").trim(),
    src: (m[2] ?? "").trim(),
  }));
  const withoutImages = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const links = [...withoutImages.matchAll(/\[([^\]]+)\]\(\s*([^)\s]+)[^)]*\)/g)].map((m) => ({
    text: (m[1] ?? "").trim(),
    href: (m[2] ?? "").trim(),
  }));

  const headings: Heading[] = (withoutImages.match(/^#{1,6}[ \t]+\S.*$/gm) ?? []).map((line) => {
    const m = /^(#{1,6})[ \t]+(.*)$/.exec(line.trim())!;
    return { level: m[1].length, text: m[2].replace(/\s*#+\s*$/, "").trim() };
  });

  const prose = withoutImages
    .replace(/^#{1,6}[ \t]+.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>]/g, "");

  const paragraphs = withoutImages
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}[ \t]/.test(p) && !/^[-*+]\s|^\d+\.\s/.test(p));

  const sentences = prose
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 2);

  return {
    h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    subheads: headings.filter((h) => h.level === 2 || h.level === 3),
    prose,
    words: words(prose),
    paragraphs,
    sentences,
    links,
    images,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The keyword as a phrase, tolerant of the ways real prose writes it: any whitespace or
 *  hyphen between its words, straight or curly apostrophes, and a plural on words long enough
 *  for a plural to be the same word ("emergency plumbers in Leeds" is the keyword; "as" and
 *  "is" are not "a" and "i"). Deliberately not a stemmer — a matcher you cannot explain to a
 *  user is a matcher you cannot defend when they disagree with the count. */
function keywordRe(keyword: string, flags = "gi"): RegExp | null {
  const parts = String(keyword ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => escapeRe(w).replace(/'/g, "['’]"))
    .map((w) => (w.length >= 4 ? `${w}s?` : w));
  if (!parts.length) return null;
  return new RegExp(`(?<![\\w])${parts.join("[\\s\\-–—/]+")}(?![\\w])`, flags);
}

function countKeyword(haystack: string, keyword: string): number {
  const re = keywordRe(keyword);
  if (!re) return 0;
  return (haystack.match(re) ?? []).length;
}

function hasKeyword(haystack: string, keyword: string): boolean {
  const re = keywordRe(keyword, "i");
  return re ? re.test(haystack) : false;
}

/* ---------------------------------------------------------------- links ----------------- */

/** host+path and path-only keys for one URL, both normalised (lowercase host, no trailing
 *  slash, no query, no fragment) so two spellings of the same page compare equal. */
function urlKeys(raw: string, base?: string | null): { full: string | null; path: string | null } {
  const href = String(raw ?? "").trim();
  if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return { full: null, path: null };
  try {
    const u = new URL(href, base ? (base.startsWith("http") ? base : `https://${base}`) : "https://internal.invalid");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    return { full: host === "internal.invalid" ? null : `${host}${path}`, path };
  } catch {
    return { full: null, path: null };
  }
}

function isInternal(href: string, siteHosts: Set<string>): boolean {
  const h = String(href ?? "").trim();
  if (!h || h.startsWith("#") || /^(mailto|tel|javascript):/i.test(h)) return false;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) return true; // "/services", "./page", "page.html"
  const { full } = urlKeys(h);
  if (!full) return false;
  const host = full.split("/")[0];
  return siteHosts.has(host);
}

/* ---------------------------------------------------------------- the checks ------------ */

class Checklist {
  readonly checks: SeoCheck[] = [];

  add(c: {
    id: string;
    label: string;
    severity: SeoSeverity;
    ok: boolean;
    value: number | string | null;
    detail: string;
    fix?: string | null;
  }): void {
    this.checks.push({
      id: c.id,
      label: c.label,
      severity: c.severity,
      ok: c.ok,
      value: c.value,
      detail: c.detail,
      fix: c.ok ? null : (c.fix ?? null),
    });
  }

  /** A check we could not run because the evidence for it does not exist. Says so out loud
   *  and costs nothing — "not measured" and "measured and fine" must never look the same. */
  skip(id: string, label: string, detail: string): void {
    this.checks.push({ id, label, severity: "info", ok: true, value: null, detail, fix: null });
  }
}

/** Run the whole on-page checklist, plus the SERP comparison when it is available.
 *
 *  Async only because of the optional SERP call — with no DataForSEO account nothing here
 *  touches the network, and the function is pure with respect to its inputs. */
export async function runSeoChecks(article: SeoArticle, opts: SeoOptions = {}): Promise<SeoResult> {
  const p = parseArticle(article.body ?? "");
  const list = new Checklist();

  const keywords = (opts.keywords ?? []).map((k) => String(k ?? "").trim()).filter(Boolean);
  const primary = keywords[0] ?? null;
  const secondary = keywords.slice(1);

  const h1 = p.h1s[0] ?? null;
  const title = (article.title ?? h1 ?? "").trim();
  /** What Google would print: the <title> when we have one, otherwise the H1. */
  const serpTitle = (article.metaTitle ?? title).trim();
  const totalWords = p.words.length;

  // ── 1. title ───────────────────────────────────────────────────────────────────────────
  list.add({
    id: "title-present",
    label: "Title",
    severity: "block",
    ok: !!serpTitle,
    value: serpTitle || null,
    detail: serpTitle ? `title: "${serpTitle}"` : "the draft has no H1 and no meta title",
    fix: "Give the draft a single '# Title' line — it is what search results and social shares print.",
  });

  if (serpTitle) {
    const len = serpTitle.length;
    const okLen = len >= TITLE_LEN[0] && len <= TITLE_LEN[1];
    list.add({
      id: "title-length",
      label: "Title length",
      severity: "warn",
      ok: okLen,
      value: len,
      detail: okLen ? `title is ${len} characters` : `title is ${len} characters (want ${TITLE_LEN[0]}-${TITLE_LEN[1]})`,
      fix:
        len < TITLE_LEN[0]
          ? `Lengthen the title to ${TITLE_LEN[0]}-${TITLE_LEN[1]} characters — add the qualifier a searcher would type (a place, a year, "cost", "for beginners").`
          : `Shorten the title to ${TITLE_LEN[1]} characters or fewer; everything past that is cut off in Google.`,
    });
  }

  if (primary && serpTitle) {
    const inTitle = hasKeyword(serpTitle, primary);
    list.add({
      id: "title-keyword",
      label: "Keyword in title",
      severity: "block",
      ok: inTitle,
      value: primary,
      detail: inTitle ? `"${primary}" is in the title` : `"${primary}" is not in the title`,
      fix: `Rewrite the title so it contains "${primary}" as written — this is the strongest on-page signal there is.`,
    });

    if (inTitle) {
      const re = keywordRe(primary, "i")!;
      const at = serpTitle.search(re);
      const okPos = at >= 0 && at <= TITLE_KEYWORD_HEAD;
      list.add({
        id: "title-keyword-position",
        label: "Keyword position",
        severity: "warn",
        ok: okPos,
        value: at,
        detail: okPos
          ? `"${primary}" starts at character ${at} of the title`
          : `"${primary}" only starts at character ${at} (want it within the first ${TITLE_KEYWORD_HEAD})`,
        fix: `Move "${primary}" to the front of the title; past character ${TITLE_KEYWORD_HEAD} it can be truncated in the result.`,
      });
    }
  } else if (!primary) {
    list.skip("title-keyword", "Keyword in title", "no primary keyword was supplied, so keyword placement was not checked");
  }

  // ── 2. meta description ────────────────────────────────────────────────────────────────
  // A warning and not a block on purpose: nothing in today's pipeline produces a meta
  // description yet (see agents/writer.ts), so blocking here would stop every publish over a
  // field that has no producer. Mr. Publish's own pre-flight (plan §7.5) is where "meta
  // present" becomes a hard requirement, the day something writes one.
  {
    const desc = (article.metaDescription ?? "").trim();
    const len = desc.length;
    const ok = len >= META_DESC_LEN[0] && len <= META_DESC_LEN[1];
    list.add({
      id: "meta-description",
      label: "Meta description",
      severity: "warn",
      ok,
      value: len,
      detail: !len
        ? "no meta description"
        : ok
          ? `meta description is ${len} characters`
          : `meta description is ${len} characters (want ${META_DESC_LEN[0]}-${META_DESC_LEN[1]})`,
      fix: !len
        ? `Write a ${META_DESC_LEN[0]}-${META_DESC_LEN[1]} character meta description that answers${primary ? ` "${primary}"` : " the query"} and ends with the reason to click.`
        : len < META_DESC_LEN[0]
          ? `Extend the meta description to at least ${META_DESC_LEN[0]} characters — the snippet is free space you are leaving empty.`
          : `Cut the meta description to ${META_DESC_LEN[1]} characters; the rest is truncated.`,
    });
  }

  // ── 3. headings ────────────────────────────────────────────────────────────────────────
  list.add({
    id: "h1-unique",
    label: "One H1",
    severity: "block",
    ok: p.h1s.length === 1,
    value: p.h1s.length,
    detail: p.h1s.length === 1 ? "exactly one H1" : `${p.h1s.length} H1 heading(s)`,
    fix:
      p.h1s.length === 0
        ? "Add a single '# Heading' line at the top of the draft."
        : "Demote the extra '# ' headings to '## ' — a page makes one claim about what it is, and two H1s split it.",
  });

  const h2s = p.headings.filter((h) => h.level === 2);
  {
    const blocked = h2s.length < H2_BLOCK_UNDER;
    const warned = h2s.length < H2_WARN_UNDER;
    list.add({
      id: "h2-count",
      label: "Sections",
      severity: blocked ? "block" : "warn",
      ok: !warned,
      value: h2s.length,
      detail: `${h2s.length} H2 section(s)${warned ? ` (want ${H2_WARN_UNDER}+)` : ""}`,
      fix: `Break the body into at least ${H2_WARN_UNDER} '## ' sections, one per question the reader actually has.`,
    });
  }

  {
    // An H3 before any H2, or a jump from H1 straight past H2 — the outline is not a tree, and
    // both readers and parsers walk it as one.
    const firstH2 = p.headings.findIndex((h) => h.level === 2);
    const firstDeep = p.headings.findIndex((h) => h.level >= 3);
    const orphanDeep = firstDeep !== -1 && (firstH2 === -1 || firstDeep < firstH2);
    let jumped = false;
    let prev = 1;
    for (const h of p.headings) {
      if (h.level > prev + 1) jumped = true;
      prev = h.level;
    }
    const ok = !orphanDeep && !jumped;
    list.add({
      id: "heading-order",
      label: "Heading order",
      severity: "warn",
      ok,
      value: p.headings.map((h) => `H${h.level}`).join(" "),
      detail: ok ? "headings nest H1 → H2 → H3 in order" : orphanDeep ? "an H3 appears before the first H2" : "a heading level is skipped (e.g. H2 → H4)",
      fix: "Fix the outline so every H3 sits under an H2 and no level is skipped — the heading tree is how a reader (and a snippet) navigates the page.",
    });
  }

  if (primary) {
    const inHeading = p.subheads.some((h) => hasKeyword(h.text, primary));
    list.add({
      id: "keyword-in-heading",
      label: "Keyword in a heading",
      severity: "warn",
      ok: inHeading,
      value: p.subheads.length,
      detail: inHeading ? `"${primary}" appears in a subheading` : `"${primary}" is in none of the ${p.subheads.length} subheading(s)`,
      fix: `Work "${primary}" (or a close variant) into one H2 — usually the section that answers it most directly.`,
    });
  }

  if (secondary.length) {
    const covered = secondary.filter((k) => hasKeyword(p.prose, k) || p.subheads.some((h) => hasKeyword(h.text, k)));
    const share = covered.length / secondary.length;
    const missing = secondary.filter((k) => !covered.includes(k));
    list.add({
      id: "secondary-keyword-coverage",
      label: "Cluster coverage",
      severity: "warn",
      ok: share >= SECONDARY_COVERAGE,
      value: `${covered.length}/${secondary.length}`,
      detail: `${covered.length} of ${secondary.length} cluster keyword(s) appear in the draft`,
      fix: `Cover the rest of the cluster: ${missing.slice(0, 5).map((k) => `"${k}"`).join(", ")} — one is usually a section, the rest a sentence each.`,
    });
  } else {
    list.skip("secondary-keyword-coverage", "Cluster coverage", "no cluster keywords were supplied");
  }

  // ── 4. keyword usage in the body ───────────────────────────────────────────────────────
  if (primary && totalWords > 0) {
    const kwWords = primary.trim().split(/\s+/).length;
    const hits = countKeyword(p.prose, primary);
    const density = (hits * kwWords) / totalWords;
    const pct = (density * 100).toFixed(2);
    const stuffing = density > DENSITY_STUFFING;
    const outOfBand = density < DENSITY_MIN || density > DENSITY_MAX;
    list.add({
      id: "keyword-density",
      label: "Keyword density",
      severity: stuffing ? "block" : "warn",
      ok: !outOfBand,
      value: Number(pct),
      detail: `"${primary}" ${hits} time(s) in ${totalWords} words — ${pct}% density`,
      fix: stuffing
        ? `Cut the repetition hard: "${primary}" appears ${hits} times. Aim for about ${Math.max(1, Math.round((DENSITY_MAX * totalWords) / kwWords))} and replace the rest with pronouns and natural variants.`
        : density > DENSITY_MAX
          ? `Trim a few mentions of "${primary}" — around ${Math.max(1, Math.round((DENSITY_MAX * totalWords) / kwWords))} reads naturally at this length.`
          : `Use "${primary}" a few more times where it fits — about ${Math.max(2, Math.round((DENSITY_MIN * totalWords) / kwWords))} mentions at this length, never forced.`,
    });

    const opening = p.words.slice(0, FIRST_WORDS).join(" ");
    const early = hasKeyword(opening, primary);
    list.add({
      id: "keyword-first-100",
      label: "Keyword in the opening",
      severity: "block",
      ok: early,
      value: FIRST_WORDS,
      detail: early ? `"${primary}" appears in the first ${FIRST_WORDS} words` : `"${primary}" is missing from the first ${FIRST_WORDS} words`,
      fix: `Answer "${primary}" in the opening paragraph, using the phrase itself — a reader who typed it must see it before deciding to leave.`,
    });
  } else if (!primary) {
    list.skip("keyword-density", "Keyword density", "no primary keyword was supplied");
    list.skip("keyword-first-100", "Keyword in the opening", "no primary keyword was supplied");
  }

  // ── 5. links ───────────────────────────────────────────────────────────────────────────
  const pages = (opts.pages ?? []).filter((pg) => pg && typeof pg.url === "string" && pg.url.trim());
  const siteHosts = new Set<string>();
  for (const raw of [opts.siteUrl, ...pages.map((pg) => pg.url)]) {
    if (!raw) continue;
    const { full } = urlKeys(raw);
    if (full) siteHosts.add(full.split("/")[0]);
  }

  const internal = p.links.filter((l) => isInternal(l.href, siteHosts));
  const external = p.links.filter((l) => !isInternal(l.href, siteHosts) && /^https?:\/\//i.test(l.href));

  list.add({
    id: "internal-links",
    label: "Internal links",
    severity: "warn",
    ok: internal.length >= MIN_INTERNAL_LINKS,
    value: internal.length,
    detail: `${internal.length} internal link(s)`,
    fix: `Link to at least ${MIN_INTERNAL_LINKS} of your own pages from the body — the ones a reader of this article would want next.`,
  });

  if (!pages.length) {
    list.skip("internal-links-resolve", "Links resolve", "no crawled pages were supplied, so internal links could not be verified");
  } else if (!internal.length) {
    list.skip("internal-links-resolve", "Links resolve", "there are no internal links to verify");
  } else {
    const known = new Set<string>();
    for (const pg of pages) {
      const { full, path } = urlKeys(pg.url);
      if (full) known.add(full);
      if (path) known.add(`path:${path}`);
    }
    const broken = internal.filter((l) => {
      const { full, path } = urlKeys(l.href, opts.siteUrl ?? pages[0]?.url ?? null);
      if (full && known.has(full)) return false;
      if (path && known.has(`path:${path}`)) return false;
      return true;
    });
    list.add({
      id: "internal-links-resolve",
      label: "Links resolve",
      severity: "block",
      ok: broken.length === 0,
      value: broken.length,
      detail: broken.length ? `${broken.length} internal link(s) point at pages we have never crawled` : `all ${internal.length} internal link(s) point at real pages`,
      fix: `Remove or repoint these links — they are not pages on the site: ${broken.slice(0, 3).map((l) => l.href).join(", ")}. An invented internal link is a 404 on a live customer site.`,
    });
  }

  {
    const cluster = primary ? nearestCluster(primary, opts.profile ?? null) : null;
    if (!cluster) {
      list.skip(
        "internal-links-cluster",
        "Same-topic links",
        opts.profile ? "no topic cluster matches this keyword, so no same-cluster link was expected" : "no site profile, so topic clusters were not checked",
      );
    } else {
      const clusterPaths = new Set(cluster.page_urls.map((u) => urlKeys(u).path).filter(Boolean) as string[]);
      const inCluster = internal.filter((l) => {
        const { path } = urlKeys(l.href, opts.siteUrl ?? null);
        return path ? clusterPaths.has(path) : false;
      });
      list.add({
        id: "internal-links-cluster",
        label: "Same-topic links",
        severity: "warn",
        ok: inCluster.length > 0,
        value: inCluster.length,
        detail: inCluster.length
          ? `${inCluster.length} link(s) into the "${cluster.name}" cluster`
          : `no link into "${cluster.name}", the cluster this article belongs to`,
        fix: `Link to a page in the "${cluster.name}" cluster${cluster.page_urls[0] ? ` (e.g. ${cluster.page_urls[0]})` : ""} — links between pages about the same thing are the ones that carry weight.`,
      });
    }
  }

  list.add({
    id: "external-links",
    label: "Sources",
    severity: "warn",
    ok: external.length >= MIN_EXTERNAL_LINKS,
    value: external.length,
    detail: `${external.length} outbound link(s)`,
    fix: "Cite at least one outside source for the figures or standards the article mentions — an article that references nothing reads as unsourced.",
  });

  // ── 6. images ──────────────────────────────────────────────────────────────────────────
  if (!p.images.length) {
    list.skip("image-alt", "Image alt text", "the draft has no images yet");
  } else {
    const missing = p.images.filter((img) => img.alt.replace(/\s+/g, " ").trim().length < 3);
    list.add({
      id: "image-alt",
      label: "Image alt text",
      severity: "warn",
      ok: missing.length === 0,
      value: `${p.images.length - missing.length}/${p.images.length}`,
      detail: missing.length ? `${missing.length} of ${p.images.length} image(s) have no usable alt text` : `all ${p.images.length} image(s) have alt text`,
      fix: `Describe each image in its alt text${primary ? `, naming what is in it rather than repeating "${primary}"` : ""} — it is what a screen reader and an image search both read.`,
    });
  }

  // ── 7. slug ────────────────────────────────────────────────────────────────────────────
  {
    const slug = (article.slug ?? "").trim();
    if (!slug) {
      list.skip("slug", "URL slug", "no slug yet — it is decided at publish time");
    } else {
      const problems: string[] = [];
      if (slug.length > SLUG_MAX) problems.push(`${slug.length} characters (want ${SLUG_MAX} or fewer)`);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) problems.push("not lowercase-hyphenated");
      // Not \b: underscores are word characters, so "_2024_" would slip past a boundary test.
      if (/(?<![0-9])(19|20)\d{2}(?![0-9])/.test(slug)) problems.push("contains a year, which dates the URL forever");
      if (primary && !hasKeyword(slug.replace(/-/g, " "), primary)) problems.push(`does not contain "${primary}"`);
      list.add({
        id: "slug",
        label: "URL slug",
        severity: "warn",
        ok: problems.length === 0,
        value: slug,
        detail: problems.length ? `slug "${slug}": ${problems.join("; ")}` : `slug "${slug}"`,
        fix: `Use a short lowercase-hyphenated slug built from the keyword${primary ? ` (e.g. "${primary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}")` : ""}, with no year in it — the URL outlives the year.`,
      });
    }
  }

  // ── 8. readability ─────────────────────────────────────────────────────────────────────
  if (p.sentences.length >= 5) {
    const lens = p.sentences.map((s) => words(s).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const long = lens.filter((n) => n > LONG_SENTENCE_WORDS).length;
    const share = long / lens.length;
    const ok = share <= LONG_SENTENCE_SHARE && mean <= MEAN_SENTENCE_WORDS;
    list.add({
      id: "readability-sentences",
      label: "Sentence length",
      severity: "warn",
      ok,
      value: Number(mean.toFixed(1)),
      detail: `${lens.length} sentences, mean ${mean.toFixed(1)} words, ${long} over ${LONG_SENTENCE_WORDS} words (${Math.round(share * 100)}%)`,
      fix: `Split the longest sentences: ${long} of ${lens.length} run past ${LONG_SENTENCE_WORDS} words. Aim for a mean under ${MEAN_SENTENCE_WORDS}, mixing short lines in with long ones.`,
    });
  } else {
    list.skip("readability-sentences", "Sentence length", "too few sentences to measure a distribution");
  }

  if (p.paragraphs.length) {
    const lens = p.paragraphs.map((x) => words(x).length);
    const longest = Math.max(...lens);
    const heavy = lens.filter((n) => n > HEAVY_PARAGRAPH_WORDS).length;
    const ok = longest <= LONG_PARAGRAPH_WORDS && heavy / lens.length <= HEAVY_PARAGRAPH_SHARE;
    list.add({
      id: "readability-paragraphs",
      label: "Paragraph length",
      severity: "warn",
      ok,
      value: longest,
      detail: `${lens.length} paragraphs, longest ${longest} words, ${heavy} over ${HEAVY_PARAGRAPH_WORDS}`,
      fix: `Break up the long paragraphs (longest is ${longest} words) — on a phone anything past ${LONG_PARAGRAPH_WORDS} words is a screen of unbroken text.`,
    });
  } else {
    list.skip("readability-paragraphs", "Paragraph length", "the draft has no body paragraphs");
  }

  // ── 9. schema suggestion (never scored) ────────────────────────────────────────────────
  {
    // A heading counts as a question when it ENDS in a question mark. Starting with "When" is
    // not enough — "When you need an emergency plumber" is a section, not an FAQ entry, and
    // marking it up as one would put an answer in Google's FAQ box to a question nobody asked.
    const questionHeads = p.subheads.filter((h) => /\?$/.test(h.text.trim()));
    const stepHeads = p.subheads.filter((h) => /^(step\s*\d|^\d+[.)]\s)/i.test(h.text.trim()));
    const type = questionHeads.length >= 3 ? "FAQPage" : stepHeads.length >= 3 ? "HowTo" : "Article";
    list.checks.push({
      id: "schema-suggestion",
      label: "Schema.org type",
      severity: "info",
      ok: false, // "there is something to do" — an info issue costs nothing, see the scoring note
      value: type,
      detail:
        type === "FAQPage"
          ? `${questionHeads.length} question headings — this page is an FAQPage`
          : type === "HowTo"
            ? `${stepHeads.length} step headings — this page is a HowTo`
            : "no FAQ or step structure — this page is a plain Article",
      fix: `Publish this page with schema.org ${type} JSON-LD${type === "FAQPage" ? " (question/answer pairs from the H2s)" : type === "HowTo" ? " (one step per numbered heading)" : " (headline, datePublished, author)"}.`,
    });
  }

  // ── 10. E-E-A-T signals (Experience, Expertise, Authoritativeness, Trust) ──────────────
  // Deterministic proxies only, same discipline as every other check here — no LLM judging
  // "does this read as authoritative", only things we can point at. Google's own Search
  // Quality Rater Guidelines weigh Trustworthiness highest of the four — a stated author and
  // a real date are the cheapest signals of exactly that, which is why they lead here.
  {
    let ld: any = null;
    if (article.jsonLd) {
      try {
        ld = JSON.parse(article.jsonLd);
      } catch {
        ld = null;
      }
    }

    if (!article.jsonLd) {
      list.skip("eeat-author", "Author", "no Article JSON-LD on this draft yet");
      list.skip("eeat-dates", "Published date", "no Article JSON-LD on this draft yet");
    } else {
      const authorName =
        typeof ld?.author === "string"
          ? ld.author.trim()
          : typeof ld?.author?.name === "string"
            ? ld.author.name.trim()
            : "";
      list.add({
        id: "eeat-author",
        label: "Author",
        severity: "warn",
        ok: !!authorName,
        value: authorName || null,
        detail: authorName ? `author: "${authorName}"` : "the JSON-LD names no author",
        fix: "Add an `author` to the Article JSON-LD — even an Organization name is a real signal. A page with no stated author reads as anonymous, and Trustworthiness is the most heavily weighted of Google's four E-E-A-T signals.",
      });

      const hasDate = typeof ld?.datePublished === "string" && !!ld.datePublished.trim();
      list.add({
        id: "eeat-dates",
        label: "Published date",
        severity: "warn",
        ok: hasDate,
        value: hasDate ? ld.datePublished : null,
        detail: hasDate ? `datePublished: ${ld.datePublished}` : "the JSON-LD has no datePublished",
        fix: "Add `datePublished` (and `dateModified` on later updates) to the Article JSON-LD — an undated page reads as unmaintained.",
      });
    }

    // "Experience": not writing style, a real link to real proof this business has on file —
    // opts.profile.proof is Site Brain data (§25's own rule: stated, never invented), so this
    // never asks whether the ARTICLE'S PROSE sounds experienced, only whether it points at
    // something that proves it.
    const proofUrls = (opts.profile?.proof ?? []).map((pr) => pr.url).filter((u): u is string => !!u);
    if (!proofUrls.length) {
      list.skip("eeat-proof-cited", "Proof cited", "no proof on file carries a URL (Site Brain proof list is empty, or none link anywhere) to check against");
    } else {
      const base = opts.siteUrl ?? pages[0]?.url ?? null;
      const linkedPaths = new Set(p.links.map((l) => urlKeys(l.href, base).path).filter(Boolean));
      const citedUrl = proofUrls.find((u) => {
        const path = urlKeys(u, base).path;
        return path ? linkedPaths.has(path) : false;
      });
      list.add({
        id: "eeat-proof-cited",
        label: "Proof cited",
        severity: "warn",
        ok: !!citedUrl,
        value: citedUrl ?? null,
        detail: citedUrl ? `links to real proof: ${citedUrl}` : `${proofUrls.length} proof URL(s) on file, none linked from this article`,
        fix: `Link to real proof this business has (e.g. ${proofUrls[0]}) — a case study or certification page is what turns a claim into evidence.`,
      });
    }

    // "Trust": Google names contact info and transparency explicitly. A crawled About/Contact
    // page is real evidence one exists; whether THIS article bothers to point at it is what
    // is actually checkable, so that is what gets scored, not "does the site have one".
    const trustPage = pages.find((pg) => TRUST_PAGE_PATTERN.test(pg.url ?? ""));
    if (!trustPage) {
      list.skip("eeat-trust-page", "About/Contact linked", "no About/Contact-style page was found among the crawled pages");
    } else {
      const base = opts.siteUrl ?? pages[0]?.url ?? null;
      const trustPath = urlKeys(trustPage.url, base).path;
      const linked = internal.some((l) => urlKeys(l.href, base).path === trustPath);
      list.add({
        id: "eeat-trust-page",
        label: "About/Contact linked",
        severity: "warn",
        ok: linked,
        value: linked ? trustPage.url : null,
        detail: linked ? `links to ${trustPage.url}` : `the site has ${trustPage.url} but this article does not link to it`,
        fix: `Link to ${trustPage.url} somewhere in the article — an easy path to who is behind the content is a real Trustworthiness signal.`,
      });
    }
  }

  // ── 11. depth, and the optional SERP comparison ────────────────────────────────────────
  const serp = await resolveSerp(primary, opts);

  if (serp.compared && serp.snapshot) {
    const counts = serp.snapshot.results.map((r) => r.wordCount).filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b);
    const median = counts.length % 2 ? counts[(counts.length - 1) / 2] : Math.round((counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2);
    const ratio = median ? totalWords / median : 1;
    list.add({
      id: "serp-word-count",
      label: "Depth vs the top 10",
      severity: "warn",
      ok: ratio >= SERP_WORD_RATIO,
      value: totalWords,
      detail: `${totalWords} words against a top-10 median of ${median} (${counts.length} pages read)`,
      fix: `Add roughly ${Math.max(50, Math.round(median * SERP_WORD_RATIO - totalWords))} more words of substance — the pages ranking for this query average ${median}.`,
    });
    list.skip("content-depth", "Content depth", `measured against the live top 10 instead of the ${THIN_WORDS}-word rule of thumb`);

    // Topics the market covers and we do not.
    const readable = serp.snapshot.results.filter((r) => r.h2s.length);
    const df = new Map<string, { docs: number; example: string }>();
    for (const r of readable) {
      const seen = new Set<string>();
      for (const h of r.h2s) {
        for (const tok of topicTokens(h)) {
          if (seen.has(tok)) continue;
          seen.add(tok);
          const cur = df.get(tok);
          if (cur) cur.docs += 1;
          else df.set(tok, { docs: 1, example: h.trim() });
        }
      }
    }
    const ourText = `${p.subheads.map((h) => h.text).join(" ")} ${p.prose}`.toLowerCase();
    const gaps = [...df.entries()]
      .filter(([tok, v]) => readable.length > 0 && v.docs / readable.length >= SERP_TOPIC_SHARE && !ourText.includes(tok))
      .sort((a, b) => b[1].docs - a[1].docs)
      .slice(0, 5);

    if (!readable.length) {
      list.skip("serp-topic-coverage", "Topics competitors cover", "no competitor headings could be read");
    } else {
      list.add({
        id: "serp-topic-coverage",
        label: "Topics competitors cover",
        severity: "warn",
        ok: gaps.length === 0,
        value: gaps.length,
        detail: gaps.length
          ? `${gaps.length} topic(s) most of the top 10 cover and this draft does not: ${gaps.map(([t]) => `"${t}"`).join(", ")}`
          : `nothing the top ${readable.length} cover is missing here`,
        fix: gaps
          .map(([tok, v]) => `Add a section on "${tok}" — ${v.docs} of ${readable.length} top results cover it (e.g. "${v.example}"), this draft does not.`)
          .join(" "),
      });
    }
  } else {
    list.add({
      id: "content-depth",
      label: "Content depth",
      severity: "warn",
      ok: totalWords >= THIN_WORDS,
      value: totalWords,
      detail: `${totalWords} words`,
      fix: `Take the article past ${THIN_WORDS} words with sections that answer real follow-up questions — not padding. (No SERP data here, so this is the floor, not a measured competitor median.)`,
    });
    list.skip("serp-word-count", "Depth vs the top 10", serp.note);
    list.skip("serp-topic-coverage", "Topics competitors cover", serp.note);
  }

  return rollUp(list.checks, {
    serpCompared: serp.compared,
    serpNote: serp.note,
    primaryKeyword: primary,
    wordCount: totalWords,
  });
}

/** Scoring, exactly the quality gate's: 100 − 25·block − 5·warn, clamped. `info` never costs a
 *  point — it is a note or a check we could not run, and neither is the draft's fault.
 *
 *  `passed` has two conditions, and both come from the plan:
 *    · any block failure (§7.3: the draft is not fit to publish); and
 *    · score under SEO_PASS_SCORE (§17.2 step 6: under 75 it goes back to the writer).
 *  Publish needs `seo_passed`, so a draft that is merely mediocre must not be able to reach a
 *  customer's live site on warnings alone. */
function rollUp(
  checks: SeoCheck[],
  extra: { serpCompared: boolean; serpNote: string; primaryKeyword: string | null; wordCount: number },
): SeoResult {
  const failed = checks.filter((c) => !c.ok);
  const blockers = failed.filter((c) => c.severity === "block").map((c) => c.detail);
  const warnings = failed.filter((c) => c.severity === "warn").map((c) => c.detail);
  const score = Math.max(0, Math.min(100, 100 - blockers.length * BLOCK_PENALTY - warnings.length * WARN_PENALTY));

  const order: Record<SeoSeverity, number> = { block: 0, warn: 1, info: 2 };
  const issues: SeoIssue[] = failed
    .slice()
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((c) => ({ id: c.id, severity: c.severity, what: c.detail, fix: c.fix ?? "" }));

  return {
    score,
    passed: blockers.length === 0 && score >= SEO_PASS_SCORE,
    checks,
    issues,
    blockers,
    warnings,
    ...extra,
  };
}

/** One line for logs: "SEO 82/100 · 1 blocker: … · 3 warnings: …" */
export function summarizeSeo(r: SeoResult): string {
  const parts = [`SEO ${r.score}/100`];
  if (r.blockers.length) parts.push(`BLOCKED (${r.blockers.length}): ${r.blockers.join("; ")}`);
  if (r.warnings.length) parts.push(`${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}: ${r.warnings.join("; ")}`);
  if (!r.blockers.length && !r.warnings.length) parts.push("clean");
  parts.push(r.serpCompared ? "SERP compared" : "no SERP comparison");
  return parts.join(" · ");
}

/* ---------------------------------------------------------------- SERP ------------------ */

export type SerpResult = {
  url: string;
  title: string;
  /** null when the page could not be read (WAF, JS-only, timeout). Never guessed. */
  wordCount: number | null;
  h2s: string[];
};

export type SerpSnapshot = {
  keyword: string;
  fetchedAt: number;
  results: SerpResult[];
};

/** DataForSEO charges per SERP call and the top 10 for a keyword does not move hour to hour —
 *  the plan says cache 7 days per keyword. In memory, like lib/autocomplete.ts's 24h cache and
 *  for the same reason: one instance, and a restart simply refetches. */
const SERP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const serpCache = new Map<string, SerpSnapshot>();

async function resolveSerp(
  primary: string | null,
  opts: SeoOptions,
): Promise<{ snapshot: SerpSnapshot | null; compared: boolean; note: string }> {
  if (opts.serp) return verdict(opts.serp);
  if (!primary) return { snapshot: null, compared: false, note: "no primary keyword, so there was nothing to compare against the SERP" };

  const fetcher = opts.fetchSerp ?? (dataForSeoConfigured() ? fetchSerpSnapshot : null);
  if (!fetcher) {
    return {
      snapshot: null,
      compared: false,
      note: "DataForSEO is not configured, so the draft was not compared against the live top 10 — the on-page checks above are the whole score.",
    };
  }

  try {
    return verdict(await fetcher(primary));
  } catch (e: any) {
    // Never fatal. A paid API being down is not a reason to fail a draft.
    console.warn(`[seo] SERP comparison failed for "${primary}":`, e?.message);
    return { snapshot: null, compared: false, note: `the SERP comparison could not run (${e?.message ?? "unknown error"}), so only the on-page checks are scored.` };
  }
}

/** One rule for "is this snapshot worth comparing against", wherever the snapshot came from —
 *  a fetch, the cache, or a caller that already had one. */
function verdict(snapshot: SerpSnapshot | null): { snapshot: SerpSnapshot | null; compared: boolean; note: string } {
  const readable = snapshot?.results.filter((r) => r.wordCount != null).length ?? 0;
  if (!snapshot) return { snapshot: null, compared: false, note: "no SERP snapshot came back, so the draft was not compared against the top 10." };
  if (readable < SERP_MIN_READABLE) {
    return {
      snapshot,
      compared: false,
      note: `only ${readable} of the top results could be read, which is too few to take a median from — comparison skipped.`,
    };
  }
  return { snapshot, compared: true, note: `compared against ${readable} readable top results for "${snapshot.keyword}"` };
}

/** Top 10 organic results for a keyword, each with the word count and H2 list we could read
 *  off the page ourselves.
 *
 *  DataForSEO answers with URLs and titles; it does not hand over the competitor's body text
 *  at this price point, so the reading is ours: one plain fetch per URL, parsed with cheerio,
 *  three at a time, failures skipped. A page we could not read keeps `wordCount: null` and is
 *  left out of the median — that is the difference between a thin comparison and a fabricated
 *  one.
 *
 *  (The Basic-auth header is rebuilt here rather than imported because `dfsPost` in
 *  lib/dataforseo.ts is private to that file, which is outside this change's boundary. Export
 *  it and delete this the next time that file is touched.) */
export async function fetchSerpSnapshot(keyword: string, depth = 10): Promise<SerpSnapshot | null> {
  const key = keyword.trim().toLowerCase();
  const hit = serpCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < SERP_TTL_MS) return hit;

  if (!dataForSeoConfigured()) return null;

  const auth = Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ keyword: keyword.trim(), location_code: 2840, language_code: "en", depth }]),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json();
  if (!res.ok || json?.status_code >= 40000) throw new Error(`DataForSEO SERP failed (${json?.status_code}): ${json?.status_message}`);
  const items: any[] = json?.tasks?.[0]?.result?.[0]?.items ?? [];

  const organic = items
    .filter((it) => it?.type === "organic" && typeof it?.url === "string")
    .slice(0, depth)
    .map((it) => ({ url: it.url as string, title: String(it.title ?? "") }));

  const results: SerpResult[] = [];
  for (let i = 0; i < organic.length; i += 3) {
    const batch = await Promise.all(organic.slice(i, i + 3).map((o) => readCompetitorPage(o.url).then((page) => ({ ...o, ...page }))));
    results.push(...batch);
  }

  const snapshot: SerpSnapshot = { keyword: keyword.trim(), fetchedAt: Date.now(), results };
  serpCache.set(key, snapshot);
  return snapshot;
}

/** Word count and H2 list off a competitor page. Null word count on anything we could not
 *  read — no estimate, no fallback. */
async function readCompetitorPage(url: string): Promise<{ wordCount: number | null; h2s: string[] }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MrLxwaBot/1.0 (+https://mrlxwa.com; comparing a draft against public search results)" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return { wordCount: null, h2s: [] };
    const $ = cheerio.load(await res.text());
    $("script, style, noscript, nav, header, footer, aside, svg, form").remove();
    const h2s = $("h2, h3")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t.length >= 3 && t.length <= 120)
      .slice(0, 40);
    const text = $("main").text() || $("article").text() || $("body").text();
    const count = words(text.replace(/\s+/g, " ")).length;
    return { wordCount: count > 0 ? count : null, h2s };
  } catch {
    return { wordCount: null, h2s: [] };
  }
}

/** Content words of a heading — what the section is ABOUT, so "How much does installation
 *  cost?" and "Installation costs explained" land on the same token. Two-plus characters,
 *  stopwords out, singularised crudely so "costs" and "cost" are one topic. */
const TOPIC_STOP = new Set([
  "the", "and", "for", "with", "you", "your", "our", "how", "what", "why", "when", "where", "which", "who",
  "are", "is", "in", "of", "to", "a", "an", "do", "does", "can", "should", "best", "top", "guide", "about",
  "that", "this", "it", "its", "from", "vs", "or", "on", "at", "by", "as", "be", "have", "has", "more",
  "much", "many", "into", "than", "then", "there", "here", "we", "us", "will", "get", "make", "need",
]);

function topicTokens(heading: string): string[] {
  return String(heading ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 3 && !TOPIC_STOP.has(w));
}
