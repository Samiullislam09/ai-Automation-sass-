/** Real, computed quality checks for a generated article — Build Guide Step 12, v2.
 *
 *  Deliberately only claims what's actually measurable from the text itself. The old demo UI
 *  showed a fake "originality 98%" — dropped rather than faked; a real plagiarism/originality
 *  check is a separate paid API, out of scope here (add one later if needed, don't invent a
 *  number in the meantime).
 *
 *  v2 is a deterministic checklist. Every check has a severity:
 *    - "block": the draft is not fit to publish (too short, placeholder text left in, duplicate
 *      paragraphs, keyword never mentioned, ...). Any block failure => passed=false.
 *    - "warn":  worth a human glance but not a reason to throw the draft away (clichés, no
 *      internal links, unverified figures, missing CTA, ...). Warnings lower the score only.
 *
 *  The v1 fields (wordCount, sections, links, passed, reasons) are kept as-is so the
 *  dashboard (lib/dashboard-data.ts describeJob) and ArticleReview keep working unchanged;
 *  `reasons` is exactly the list of block failures, as before. */

export type QualityCheck = {
  id: string;
  ok: boolean;
  detail: string;
  severity: "block" | "warn";
};

export type QualityGate = {
  wordCount: number;
  sections: number;
  links: number;
  passed: boolean;
  /** Block-level failures (v1 field, still what the dashboard prints as "Gate flagged"). */
  reasons: string[];
  /** v2: every check that ran, pass or fail. */
  checks: QualityCheck[];
  /** v2: 100 - 25 per block failure - 5 per warning, clamped to 0..100. */
  score: number;
  /** v2: warn-level failures only. */
  warnings: string[];
};

export type GateOptions = {
  primaryKeyword?: string;
  metaTitle?: string;
  metaDescription?: string;
  minWords?: number;
  maxWords?: number;
};

/* ---------------------------------------------------------------- thresholds ------------ */

/** WRITING_RULES asks for 1200-1800 words; the gate is deliberately looser than the prompt so
 *  a slightly short but complete draft still reaches Approvals rather than being binned. */
const DEFAULT_MIN_WORDS = 600;
const DEFAULT_MAX_WORDS = 2500;

/** WRITING_RULES: "One ## section per related query in the blueprint" — a blueprint carries
 *  several related queries and the draft is 1200+ words, so anything with fewer than three
 *  H2s has collapsed the outline. v1 asked for 2 headings of any level (H2 or H3); v2 counts
 *  H2 only and asks for 3. `sections` still reports the H2+H3 count for backward compatibility. */
const MIN_H2 = 3;

const CLICHE_WARN_AT = 3;
const CLICHE_BLOCK_AT = 6;

const META_TITLE_RANGE: [number, number] = [30, 65];
const META_DESC_RANGE: [number, number] = [80, 165];

const BLOCK_PENALTY = 25;
const WARN_PENALTY = 5;

/* ---------------------------------------------------------------- word lists ------------ */

/** Phrases that mark a draft as machine-written to any reader who has seen a few. Matched
 *  case-insensitively as whole phrases. Exported so the UI / docs can show the same list. */
export const AI_CLICHES: readonly string[] = [
  "in today's fast-paced world",
  "in today's world",
  "in the ever-evolving",
  "delve into",
  "delves into",
  "tapestry",
  "it's important to note",
  "it is important to note",
  "game-changer",
  "game changer",
  "unlock the power",
  "unleash",
  "navigate the complexities",
  "in conclusion,",
  "at the end of the day",
  "look no further",
  "seamlessly",
  "cutting-edge",
  "revolutionize",
  "elevate your",
  "a testament to",
  "embark on",
  "in the realm of",
  "landscape of",
  "harness the power",
  "whether you're a",
  "dive into",
  "let's dive",
  "robust",
  "leverage",
  "synergy",
  "holistic",
  "paradigm",
  "buckle up",
  "without further ado",
  "hope this helps",
];

/** Text that should never survive into a blog post: unfilled template slots, the model
 *  talking about itself, leaked reasoning, code fences. */
const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\[(INSERT|TODO|PLACEHOLDER)[^\]]*\]/i, label: "placeholder slot like [INSERT ...]" },
  { re: /\bAs an AI\b/i, label: '"As an AI"' },
  { re: /\bI cannot\b|\bI can't (help|assist)/i, label: "refusal text" },
  { re: /\blorem ipsum\b/i, label: "lorem ipsum" },
  { re: /```/, label: "code fence" },
  { re: /Here's a thinking process/i, label: "leaked reasoning" },
  { re: /<think>/i, label: "<think> tag" },
];

const CTA_VERB = /\b(contact|call|book|get|start|try|visit|reach|schedule|download|sign up|learn more)\b/i;

/** "45%", "$1,200", "₹5000", "€3.5k", "£20" — figures the model may have invented. */
const FIGURE = /\d+(?:[.,]\d+)?\s?%|[$€£₹¥]\s?\d[\d,]*(?:\.\d+)?/;

/* ---------------------------------------------------------------- helpers --------------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-phrase, case-insensitive, tolerant of straight/curly apostrophes. */
function phraseRe(phrase: string): RegExp {
  const body = escapeRe(phrase).replace(/'/g, "['’]");
  return new RegExp(`(?<![\\w])${body}(?![\\w])`, "gi");
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Markdown stripped down to prose: no headings, links reduced to their text, no emphasis
 *  markers. Used for keyword / sentence / figure checks so syntax doesn't skew them. */
function prose(body: string): string {
  return body
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\r/g, "");
}

function paragraphs(body: string): string[] {
  return body
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 2);
}

function stddev(nums: number[]): number {
  if (!nums.length) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/* ---------------------------------------------------------------- the gate -------------- */

export function gateArticle(body: string, opts: GateOptions = {}): QualityGate {
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const maxWords = opts.maxWords ?? DEFAULT_MAX_WORDS;
  const text = body.replace(/\r/g, "");

  const wordCount = words(text).length;
  const sections = (text.match(/^#{2,3}\s+\S/gm) || []).length; // v1 semantics: H2 + H3
  const h2s = (text.match(/^##\s+\S.*$/gm) || []).map((h) => h.replace(/^##\s+/, "").trim());
  const links = (text.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
  const bodyProse = prose(text);

  const checks: QualityCheck[] = [];
  const add = (id: string, severity: "block" | "warn", ok: boolean, detail: string) =>
    checks.push({ id, ok, detail, severity });

  // 1. Word count in range.
  add(
    "word-count",
    "block",
    wordCount >= minWords && wordCount <= maxWords,
    wordCount < minWords
      ? `only ${wordCount} words (need ${minWords}+)`
      : wordCount > maxWords
        ? `${wordCount} words is over the ${maxWords} limit`
        : `${wordCount} words`
  );

  // 2. Enough H2 sections.
  add(
    "h2-count",
    "block",
    h2s.length >= MIN_H2,
    h2s.length >= MIN_H2 ? `${h2s.length} H2 sections` : `only ${h2s.length} H2 section(s) (need ${MIN_H2}+)`
  );

  // 3. Starts with exactly one "# Title" line.
  const h1s = text.match(/^#\s+\S.*$/gm) || [];
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const startsWithTitle = /^#\s+\S/.test(firstLine.trim());
  add(
    "title-line",
    "block",
    startsWithTitle && h1s.length === 1,
    !startsWithTitle
      ? "does not start with a '# Title' line"
      : h1s.length > 1
        ? `${h1s.length} H1 lines (need exactly one)`
        : "starts with a single '# Title' line"
  );

  // 4. Primary keyword placement.
  const kw = opts.primaryKeyword?.trim();
  if (kw) {
    const kwRe = phraseRe(kw);
    const titleText = h1s[0]?.replace(/^#\s+/, "") ?? "";
    const first100 = words(bodyProse).slice(0, 100).join(" ");
    const inTitle = kwRe.test(titleText);
    kwRe.lastIndex = 0;
    const inOpening = kwRe.test(first100);
    kwRe.lastIndex = 0;
    add(
      "keyword-early",
      "block",
      inTitle || inOpening,
      inTitle || inOpening
        ? `"${kw}" appears in the ${inTitle ? "title" : "first 100 words"}`
        : `"${kw}" is not in the title or the first 100 words`
    );
    const inH2 = h2s.some((h) => {
      kwRe.lastIndex = 0;
      return kwRe.test(h);
    });
    add("keyword-in-h2", "warn", inH2, inH2 ? `"${kw}" appears in an H2` : `"${kw}" is not in any H2 heading`);
  }

  // 5. Placeholder / LLM-leak text.
  const leaks = PLACEHOLDER_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  add("placeholders", "block", leaks.length === 0, leaks.length ? `contains ${leaks.join(", ")}` : "no placeholder or leaked-model text");

  // 6. AI clichés.
  const clicheHits: string[] = [];
  for (const phrase of AI_CLICHES) {
    const m = bodyProse.match(phraseRe(phrase));
    if (m) for (let i = 0; i < m.length; i++) clicheHits.push(phrase);
  }
  const clicheCount = clicheHits.length;
  const clicheSummary = [...new Set(clicheHits)].slice(0, 5).map((p) => `"${p}"`).join(", ");
  if (clicheCount >= CLICHE_BLOCK_AT) {
    add("ai-cliches", "block", false, `${clicheCount} AI-cliché phrases (${clicheSummary})`);
  } else {
    add(
      "ai-cliches",
      "warn",
      clicheCount < CLICHE_WARN_AT,
      clicheCount ? `${clicheCount} AI-cliché phrase(s)${clicheSummary ? ` (${clicheSummary})` : ""}` : "no AI-cliché phrases"
    );
  }

  // 7. Sentence-length variance.
  const sentenceLens = sentences(bodyProse).map((s) => words(s).length);
  const sd = stddev(sentenceLens);
  const robotic = sentenceLens.length >= 20 && sd < 4;
  add(
    "sentence-variety",
    "warn",
    !robotic,
    robotic
      ? `sentences are uniform length (robotic) — stddev ${sd.toFixed(1)} words over ${sentenceLens.length} sentences`
      : `sentence length varies (stddev ${sd.toFixed(1)} words)`
  );

  // 8. Duplicate paragraphs.
  const seen = new Map<string, number>();
  let dupes = 0;
  for (const p of paragraphs(text)) {
    if (p.length < 60 || /^#/.test(p)) continue;
    const norm = p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const n = (seen.get(norm) ?? 0) + 1;
    seen.set(norm, n);
    if (n === 2) dupes++;
  }
  add("duplicate-paragraphs", "block", dupes === 0, dupes ? `${dupes} paragraph(s) repeated verbatim` : "no repeated paragraphs");

  // 9. Meta title / description length (only when provided).
  if (opts.metaTitle !== undefined) {
    const len = opts.metaTitle.trim().length;
    const ok = len >= META_TITLE_RANGE[0] && len <= META_TITLE_RANGE[1];
    add("meta-title", "warn", ok, ok ? `meta title ${len} chars` : `meta title is ${len} chars (want ${META_TITLE_RANGE[0]}-${META_TITLE_RANGE[1]})`);
  }
  if (opts.metaDescription !== undefined) {
    const len = opts.metaDescription.trim().length;
    const ok = len >= META_DESC_RANGE[0] && len <= META_DESC_RANGE[1];
    add("meta-description", "warn", ok, ok ? `meta description ${len} chars` : `meta description is ${len} chars (want ${META_DESC_RANGE[0]}-${META_DESC_RANGE[1]})`);
  }

  // 10. Internal links.
  add("links", "warn", links > 0, links ? `${links} link(s)` : "no internal links");

  // 11. Figures we cannot verify from here.
  const hasFigures = FIGURE.test(bodyProse);
  add(
    "figures",
    "warn",
    !hasFigures,
    hasFigures ? "contains figures — verify they came from the business context" : "no percentages or currency figures"
  );

  // 12. Ends with a call to action.
  const paras = paragraphs(text).filter((p) => !/^#/.test(p));
  const last = paras[paras.length - 1] ?? "";
  const hasCta = CTA_VERB.test(last);
  add("call-to-action", "warn", hasCta, hasCta ? "ends with a next step" : "last paragraph has no call to action");

  /* ---- roll up ---- */
  const reasons = checks.filter((c) => !c.ok && c.severity === "block").map((c) => c.detail);
  const warnings = checks.filter((c) => !c.ok && c.severity === "warn").map((c) => c.detail);
  const score = Math.max(0, Math.min(100, 100 - reasons.length * BLOCK_PENALTY - warnings.length * WARN_PENALTY));

  return { wordCount, sections, links, passed: reasons.length === 0, reasons, checks, score, warnings };
}

/** One line for logs: "QA 78/100 · 2 warnings: no internal links; …" */
export function summarizeGate(g: QualityGate): string {
  const parts = [`QA ${g.score}/100`];
  if (g.reasons.length) parts.push(`BLOCKED (${g.reasons.length}): ${g.reasons.join("; ")}`);
  if (g.warnings.length) parts.push(`${g.warnings.length} warning${g.warnings.length === 1 ? "" : "s"}: ${g.warnings.join("; ")}`);
  if (!g.reasons.length && !g.warnings.length) parts.push("clean");
  return parts.join(" · ");
}

/** Article body starts with "# Title" per the writer's prompt (lib/writer.ts) — pull that
 *  out as the real title instead of reusing the raw topic string, falling back to the
 *  topic if the model didn't format it as expected. */
export function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}
