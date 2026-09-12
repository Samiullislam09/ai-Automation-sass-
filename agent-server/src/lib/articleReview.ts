import { gateArticle, BANNED_PHRASES, words, prose, paragraphs, sentences, FIGURE } from "./qualityGate.js";
export { BANNED_PHRASES };
import { reviseArticle, auditHumanization, type Completer, type HumanizeAudit } from "./writerPipeline.js";

/** THE HARD REVIEW. documnet/Article_Writing_Rules.md, every section forced, not advised.
 *
 *  Owner, 2026-09-13: "baaki rules bhi implement karo, sab ko all section ko hard yani
 *  forcefully add karo. Agar nahi hoga to article dobara check hoga, and check ke waqt koi rule
 *  follow na ho to dobara wo section rewrite hoga, and dobara check karne pe live visual pe
 *  uska UI/UX aaye review ka."
 *
 *  So this is a loop, and every rule in it can stop a publish:
 *
 *   1. CHECK every machine-checkable rule, each one scoped to the exact part of the article it
 *      failed in (a section, the introduction, or the article as a whole), plus a live HTTP
 *      fetch of every link.
 *   2. On any failure, REWRITE ONLY THE FAILING SECTIONS (one model call each, in parallel),
 *      with that section's exact violations. Rules that belong to the whole article (a missing
 *      verdict section, too few links) go to one targeted whole-article revise instead.
 *      Nothing that already passed is regenerated, which is Part 3 section 21's reason: a full
 *      rewrite re-rolls every rule that was already passing.
 *   3. CHECK AGAIN. Once every mechanical rule passes, an independent model call audits the
 *      judgment-needed rules (human voice, experience, verdict, unnamed claims). Its flagged
 *      lines are mapped back to their section and rewritten the same way, and the mechanical
 *      check always runs again after, because a rewrite for voice can break a word count.
 *   4. Bounded. REVIEW_MAX_ROUNDS rounds and REVIEW_MAX_AUDIT_FIXES voice fixes, then it stops
 *      and says it did not pass. The doc's own rule: stop and flag for a human, never publish a
 *      failing draft "close enough".
 *
 *  Every step reports through `onEvent`, so the live canvas can show each round, each failing
 *  rule, and each section being rewritten, as it actually happens.
 *
 *  Nothing here invents content. The byline is stamped by code from the real date and the
 *  business's real name. Link requirements are capped by how many real, verified links actually
 *  exist for this article: a rule that could only be met by inventing a URL is reported as
 *  skipped, not silently waived and not satisfied with a fake. */

export const REVIEW_MAX_ROUNDS = 5;
export const REVIEW_MAX_AUDIT_FIXES = 2;

// Every number below is the doc's own, in one place, so calibrating against the real model is a
// one-line change rather than a hunt.
const SNIPPET_MIN_WORDS = 40; // sections 1 and 13
const SNIPPET_MAX_WORDS = 58;
const MAX_PARAGRAPH_SENTENCES = 4; // section 3
const SHORT_SENTENCE_MAX_WORDS = 6; // section 15, lever 2
const WORDS_PER_SHORT_SENTENCE = 150;
const UNIFORM_SPREAD_WORDS = 5; // "never three consecutive sentences within 5 words of each other"
const LIST_MIN_ITEMS = 5; // section 13, list snippets
const LIST_MAX_ITEMS = 8;
const LIST_ITEM_MIN_WORDS = 3;
const LIST_ITEM_MAX_WORDS = 8;
const INTERNAL_LINKS_MIN = 3; // sections 7 and 12
const INTERNAL_LINKS_MAX = 5;
const EXTERNAL_LINKS_MIN = 2; // section 12
const ARTICLE_MIN_WORDS = 700; // section 10
const MAX_SEMICOLONS = 1; // section 15, lever 8: "cut almost entirely"
const SAME_OPENING_RUN = 3; // section 11: no more than two answers in a row open the same way

export type LinkRef = { url: string; title: string };

export type ReviewGroup = "Structure" | "Snippet answers" | "Writing style" | "Links and sources" | "Trust" | "Human voice";

export type ReviewCheck = {
  id: string;
  label: string;
  group: ReviewGroup;
  ok: boolean;
  detail: string;
  /** The heading this rule failed or passed under; "Introduction" for the opening; null when
   *  the rule belongs to the whole article. */
  section: string | null;
  /** Index into splitArticle().parts for the body this check ran on. */
  part: number | null;
  /** How a failure gets fixed: rewrite that one section, or revise the whole article. */
  fix: "section" | "article";
  /** Met by default because nothing real existed to meet it with (e.g. no verified external
   *  sources for this topic). Shown as skipped, never as a pass that was earned. */
  skipped?: boolean;
};

export type ArticlePart = { h2: string | null; markdown: string };
export type SplitArticle = { head: string; parts: ArticlePart[] };

export type ReviewInput = {
  title: string;
  topic: string;
  primaryKeyword: string;
  siteUrl: string | null;
  /** The real author name for the byline, or null to stamp the date alone. */
  author: string | null;
  /** Every URL this article may link to: the site's own crawled pages, its proof, and the real
   *  research sources. Only these are offered to a rewrite. */
  allowedLinks: LinkRef[];
  metaTitle?: string;
  metaDescription?: string;
};

export type ReviewEvent = (kind: string, payload: Record<string, unknown>) => void;

export type ReviewDeps = {
  complete: Completer;
  checkLink: (url: string) => Promise<boolean>;
  onEvent?: ReviewEvent;
  onProgress?: (label: string) => void;
  now?: () => Date;
};

export type ReviewOutcome = {
  body: string;
  passed: boolean;
  rounds: number;
  checks: ReviewCheck[];
  audit: HumanizeAudit | null;
  auditError: string | null;
  failures: string[];
  sectionRewrites: number;
  articleRevisions: number;
};

/* ---------------------------------------------------------------- text helpers ----------- */

const STAMP_RE = /^\*Last updated: [^*]+\*$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LIST_LINE = /^\s*([-*]|\d+\.)\s+\S/;
const TABLE_LINE = /^\s*\|/;
const HEADING_LINE = /^\s*#{1,6}\s/;

const QUESTION_START = /^(what|how|why|when|where|which|who|whose|is|are|can|could|does|do|did|should|will|would|may|must|has|have)\b/i;
const LIST_HEADING = /^(how (to|do (i|you|we)|can (i|you|we))\b|what are the (steps|types|ways|options|stages)\b|which (steps|options|types)\b|(steps|ways|tips|types|stages)\b)/i;
const BAD_OPENER = /^(it depends|when it comes to|there are (many|several|a number of)|in order to understand|let's|this section)/i;
const UNSOURCED = /\b(studies|research|experts?|surveys?|reports?)\s+(show|shows|suggest|suggests|say|says|found|find|indicate|indicates|prove|proves)\b/i;
const ABSOLUTE = /(\bthe best\b|\bguarantee[ds]?\b|#1\b|\bnumber one\b)/i;
const VERDICT_HEADING = /\b(verdict|bottom line|our take|our recommendation|should you|worth it|which (one|option) (is|should))\b/i;
const LIMITS_TEXT = /\b(limits? of|caveats?|what (these|this) (numbers?|figures?|data) (do not|don't)|how to read these (numbers|figures))\b/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseRe(phrase: string): RegExp {
  const body = escapeRe(phrase).replace(/'/g, "['’]");
  return new RegExp(`(?<![\\w])${body}(?![\\w])`, "i");
}

const BANNED_RES = BANNED_PHRASES.map((phrase) => ({ phrase, re: phraseRe(phrase) }));

function isQuickAnswers(h2: string): boolean {
  return /^quick answers\b/i.test(h2.trim());
}

function isQuestionHeading(h: string): boolean {
  const t = h.trim();
  return /\?\s*$/.test(t) || QUESTION_START.test(t);
}

/** Prose only: no headings, tables, list items or the byline stamp. What sentence-level rules
 *  (rhythm, paragraph length) are measured on, so a table row is never read as a sentence. */
function proseText(markdown: string): string {
  return prose(
    markdown
      .split("\n")
      .filter((l) => !TABLE_LINE.test(l) && !LIST_LINE.test(l) && !STAMP_RE.test(l.trim()))
      .join("\n"),
  );
}

/** The units a claim rule reads: each prose sentence, and each list item on its own, with link
 *  syntax still in place so "is this claim linked to its source" can be answered. */
function claimUnits(markdown: string): string[] {
  const out: string[] = [];
  for (const block of paragraphs(markdown)) {
    const lines = block.split("\n").filter((l) => !HEADING_LINE.test(l) && !TABLE_LINE.test(l) && !STAMP_RE.test(l.trim()));
    if (!lines.length) continue;
    if (lines.every((l) => LIST_LINE.test(l))) {
      out.push(...lines);
      continue;
    }
    out.push(...sentences(lines.join(" ")));
  }
  return out;
}

function linksIn(markdown: string): string[] {
  return [...markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

function absoluteUrl(url: string, base: string | null): string | null {
  try {
    return new URL(url, base ?? undefined).toString();
  } catch {
    return null;
  }
}

function hostOf(url: string, base: string | null): string | null {
  const abs = absoluteUrl(url, base);
  if (!abs) return null;
  try {
    return new URL(abs).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function formatDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The first prose paragraph straight after a section's heading, or null when the heading is
 *  followed by a list, a table, another heading, or nothing. */
function answerParagraph(markdown: string): string | null {
  const lines = markdown.split("\n").slice(1);
  let j = 0;
  while (j < lines.length && !lines[j].trim()) j++;
  if (j >= lines.length || HEADING_LINE.test(lines[j]) || LIST_LINE.test(lines[j]) || TABLE_LINE.test(lines[j])) return null;
  const out: string[] = [];
  while (j < lines.length && lines[j].trim() && !HEADING_LINE.test(lines[j]) && !TABLE_LINE.test(lines[j]) && !LIST_LINE.test(lines[j])) {
    out.push(lines[j]);
    j++;
  }
  return out.join(" ");
}

function listGroups(markdown: string): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  for (const line of markdown.split("\n")) {
    if (LIST_LINE.test(line)) {
      cur.push(line);
    } else if (line.trim()) {
      if (cur.length) groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function headingOf(markdown: string): string | null {
  const m = markdown.match(/^##\s+(\S.*)$/m);
  return m ? m[1].trim() : null;
}

function normalize(s: string): string {
  return prose(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/* ---------------------------------------------------------------- structure --------------- */

/** "# Title", then the article in parts: the introduction (heading null) and one part per "##"
 *  section. The byline stamp is dropped here and re-stamped by stampByline, so a rewrite can
 *  never leave two stamps or lose the one there was. */
export function splitArticle(body: string): SplitArticle {
  const head: string[] = [];
  const parts: ArticlePart[] = [];
  let cur: { h2: string | null; lines: string[] } = { h2: null, lines: [] };
  let seenTitle = false;

  const flush = () => {
    const md = cur.lines.join("\n").trim();
    if (cur.h2 !== null || md) parts.push({ h2: cur.h2, markdown: md });
  };

  for (const line of body.replace(/\r/g, "").split("\n")) {
    const h2 = line.match(/^##\s+(\S.*)$/);
    if (h2) {
      flush();
      cur = { h2: h2[1].trim(), lines: [line] };
      continue;
    }
    if (!seenTitle && cur.h2 === null && /^#\s+\S/.test(line)) {
      head.push(line);
      seenTitle = true;
      continue;
    }
    if (cur.h2 === null && STAMP_RE.test(line.trim())) continue;
    cur.lines.push(line);
  }
  flush();

  return { head: head.join("\n"), parts };
}

export function assembleArticle(split: SplitArticle): string {
  return [split.head, ...split.parts.map((p) => p.markdown)].filter((s) => s.trim()).join("\n\n");
}

/** Section 12's "last updated" date and author attribution, written by code, never by the model:
 *  a date or a name a model makes up looks exactly as confident as a real one. Idempotent. */
export function stampByline(body: string, date: Date, author: string | null): string {
  const cleanAuthor = author ? author.replace(/\*/g, "").trim() : "";
  const line = `*Last updated: ${formatDate(date)}${cleanAuthor ? ` · By ${cleanAuthor}` : ""}*`;
  const lines = body.replace(/\r/g, "").split("\n").filter((l) => !STAMP_RE.test(l.trim()));
  const t = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (t < 0) return [line, "", ...lines].join("\n");
  const rest = lines.slice(t + 1);
  while (rest.length && !rest[0].trim()) rest.shift();
  return [...lines.slice(0, t + 1), "", line, "", ...rest].join("\n");
}

/* ---------------------------------------------------------------- the checks -------------- */

const GATE_LABELS: Record<string, { label: string; group: ReviewGroup }> = {
  "word-count": { label: "Article length", group: "Structure" },
  "h2-count": { label: "Enough sections", group: "Structure" },
  "title-line": { label: "One title line", group: "Structure" },
  "keyword-early": { label: "Keyword in the opening", group: "Structure" },
  placeholders: { label: "No placeholder text", group: "Structure" },
  "duplicate-paragraphs": { label: "No repeated paragraphs", group: "Structure" },
  "has-table": { label: "A real table", group: "Structure" },
  "has-list": { label: "A real list", group: "Structure" },
  "has-qa-block": { label: "Quick answers block", group: "Snippet answers" },
  "no-literal-faq-text": { label: "No literal FAQ heading", group: "Snippet answers" },
};
/** Gate checks this review replaces with a stricter, section-scoped version of its own. */
const GATE_REPLACED = new Set(["em-dash", "ai-cliches"]);

function sectionChecks(split: SplitArticle): ReviewCheck[] {
  const out: ReviewCheck[] = [];

  split.parts.forEach((part, idx) => {
    const name = part.h2 ?? "Introduction";
    const add = (id: string, label: string, group: ReviewGroup, ok: boolean, detail: string) =>
      out.push({ id, label, group, ok, detail, section: name, part: idx, fix: "section" });
    const qa = part.h2 !== null && isQuickAnswers(part.h2);

    if (part.h2 !== null && !qa) {
      // Sections 1 and 13: every H2 and H3 is the question a searcher types.
      const subHeads = part.markdown
        .split("\n")
        .filter((l) => /^###\s+\S/.test(l))
        .map((l) => l.replace(/^###\s+/, "").trim());
      const notQuestions = [part.h2, ...subHeads].filter((h) => !isQuestionHeading(h));
      add(
        "question-heading",
        "Heading is a real question",
        "Structure",
        notQuestions.length === 0,
        notQuestions.length ? `not phrased as a question a searcher would type: ${notQuestions.map((q) => `"${q}"`).join(", ")}` : "phrased as a real question",
      );

      // Sections 1 and 13: the paragraph right after the heading answers it in 40-58 words,
      // leading with the answer.
      const answer = answerParagraph(part.markdown);
      const answerWords = answer ? words(prose(answer)).length : 0;
      const badOpen = answer ? BAD_OPENER.exec(prose(answer).trim()) : null;
      add(
        "snippet-answer",
        `Direct ${SNIPPET_MIN_WORDS}-${SNIPPET_MAX_WORDS} word answer`,
        "Snippet answers",
        !!answer && !badOpen && answerWords >= SNIPPET_MIN_WORDS && answerWords <= SNIPPET_MAX_WORDS,
        !answer
          ? "no paragraph answers the heading directly after it"
          : badOpen
            ? `the answer opens with "${badOpen[0]}" instead of the number, the yes/no, or the name`
            : answerWords < SNIPPET_MIN_WORDS || answerWords > SNIPPET_MAX_WORDS
              ? `the answer paragraph is ${answerWords} words (needs ${SNIPPET_MIN_WORDS}-${SNIPPET_MAX_WORDS})`
              : `${answerWords}-word direct answer`,
      );

      // Section 13: a "how to / steps / types" question gets an actual list of the right shape.
      if (LIST_HEADING.test(part.h2)) {
        const groups = listGroups(part.markdown);
        const good = groups.find(
          (g) =>
            g.length >= LIST_MIN_ITEMS &&
            g.length <= LIST_MAX_ITEMS &&
            g.every((item) => {
              const n = words(prose(item.replace(/^\s*([-*]|\d+\.)\s+/, ""))).length;
              return n >= LIST_ITEM_MIN_WORDS && n <= LIST_ITEM_MAX_WORDS;
            }),
        );
        const shape = groups.map((g) => `${g.length} items`).join(", ");
        add(
          "list-shape",
          `List of ${LIST_MIN_ITEMS}-${LIST_MAX_ITEMS} short items`,
          "Snippet answers",
          !!good,
          good
            ? `${good.length}-item list`
            : groups.length
              ? `this heading asks for steps or options, but its list (${shape}) is not ${LIST_MIN_ITEMS}-${LIST_MAX_ITEMS} items of ${LIST_ITEM_MIN_WORDS}-${LIST_ITEM_MAX_WORDS} words each`
              : `this heading asks for steps or options, so it needs a real list of ${LIST_MIN_ITEMS}-${LIST_MAX_ITEMS} items of ${LIST_ITEM_MIN_WORDS}-${LIST_ITEM_MAX_WORDS} words each`,
        );
      }
    }

    // Section 11: never an em dash.
    const emDashes = (part.markdown.match(/—/g) || []).length;
    add("em-dash", "No em dashes", "Writing style", emDashes === 0, emDashes ? `${emDashes} em dash character(s)` : "no em dashes");

    // Sections 11 and 15: zero banned filler.
    const plain = prose(part.markdown);
    const banned = BANNED_RES.filter((b) => b.re.test(plain)).map((b) => b.phrase);
    add(
      "banned-phrases",
      "No banned filler words",
      "Writing style",
      banned.length === 0,
      banned.length ? `uses ${banned.slice(0, 6).map((b) => `"${b}"`).join(", ")}` : "no banned filler words",
    );

    // Section 3: 2-4 sentences per paragraph, no exceptions.
    if (!qa) {
      const longParas = paragraphs(part.markdown)
        .filter((p) => !HEADING_LINE.test(p) && !TABLE_LINE.test(p) && !LIST_LINE.test(p) && !STAMP_RE.test(p.trim()))
        .map((p) => ({ p, n: sentences(prose(p)).length }))
        .filter((x) => x.n > MAX_PARAGRAPH_SENTENCES);
      add(
        "short-paragraphs",
        `Paragraphs of ${MAX_PARAGRAPH_SENTENCES} sentences or fewer`,
        "Writing style",
        longParas.length === 0,
        longParas.length
          ? longParas.map((x) => `a ${x.n}-sentence paragraph starting "${prose(x.p).slice(0, 50).trim()}…"`).join("; ")
          : `every paragraph is ${MAX_PARAGRAPH_SENTENCES} sentences or fewer`,
      );
    }

    // Sections 8 and 12: no "studies show" without the study; no unbacked absolute claim.
    const units = claimUnits(part.markdown);
    const unsourced = units.filter((u) => UNSOURCED.test(prose(u)) && !/\]\(/.test(u));
    add(
      "unsourced-claims",
      "No unnamed studies or experts",
      "Trust",
      unsourced.length === 0,
      unsourced.length ? unsourced.map((u) => `"${prose(u).slice(0, 80).trim()}" names no source`).join("; ") : "every claim of evidence names its source",
    );
    const absolute = units.filter((u) => ABSOLUTE.test(prose(u)) && !/\]\(/.test(u));
    add(
      "absolute-claims",
      'No unbacked "the best" or "guaranteed"',
      "Trust",
      absolute.length === 0,
      absolute.length ? absolute.map((u) => `"${prose(u).slice(0, 80).trim()}" makes an absolute claim with no cited source`).join("; ") : "no unbacked absolute claims",
    );

    // Section 15, lever 2: one short sentence per 150 words, and never three in a row of about
    // the same length.
    if (!qa) {
      const lens = sentences(proseText(part.markdown)).map((s) => words(s).length);
      const total = lens.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const needShort = Math.floor(total / WORDS_PER_SHORT_SENTENCE);
        const haveShort = lens.filter((n) => n <= SHORT_SENTENCE_MAX_WORDS).length;
        let uniformAt = -1;
        for (let i = 2; i < lens.length; i++) {
          const trio = [lens[i - 2], lens[i - 1], lens[i]];
          if (Math.max(...trio) - Math.min(...trio) <= UNIFORM_SPREAD_WORDS) {
            uniformAt = i;
            break;
          }
        }
        const problems: string[] = [];
        if (haveShort < needShort) problems.push(`${haveShort} sentence(s) of ${SHORT_SENTENCE_MAX_WORDS} words or fewer in ${total} words (needs ${needShort})`);
        if (uniformAt >= 0) problems.push(`sentences ${uniformAt - 1}-${uniformAt + 1} are ${lens[uniformAt - 2]}, ${lens[uniformAt - 1]} and ${lens[uniformAt]} words long, all within ${UNIFORM_SPREAD_WORDS} words of each other`);
        add("sentence-rhythm", "Varied sentence rhythm", "Human voice", problems.length === 0, problems.length ? problems.join("; ") : "sentence lengths vary");
      }
    }
  });

  return out;
}

function articleChecks(body: string, split: SplitArticle, input: ReviewInput): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const add = (id: string, label: string, group: ReviewGroup, ok: boolean, detail: string, skipped = false) =>
    out.push({ id, label, group, ok, detail, section: null, part: null, fix: "article", ...(skipped ? { skipped } : {}) });
  const addSection = (id: string, label: string, group: ReviewGroup, idx: number, detail: string) =>
    out.push({ id, label, group, ok: false, detail, section: split.parts[idx]?.h2 ?? "Introduction", part: idx, fix: "section" });

  // The long-standing gate, every block-level rule of it, so there is one list and one verdict.
  const gate = gateArticle(body, { primaryKeyword: input.primaryKeyword, metaTitle: input.metaTitle, metaDescription: input.metaDescription });
  for (const c of gate.checks) {
    if (c.severity !== "block" || GATE_REPLACED.has(c.id)) continue;
    const meta = GATE_LABELS[c.id] ?? { label: c.id, group: "Structure" as ReviewGroup };
    add(`gate-${c.id}`, meta.label, meta.group, c.ok, c.detail);
  }

  // Section 10: a floor, counted on prose only.
  const proseWords = words(proseText(body)).length;
  add("word-floor", `At least ${ARTICLE_MIN_WORDS} words of prose`, "Structure", proseWords >= ARTICLE_MIN_WORDS, `${proseWords} words of prose${proseWords < ARTICLE_MIN_WORDS ? ` (needs ${ARTICLE_MIN_WORDS})` : ""}`);

  // Section 2: the primary keyword drives the title AND the first H2.
  const firstIdx = split.parts.findIndex((p) => p.h2 !== null && !isQuickAnswers(p.h2));
  const kwTokens = input.primaryKeyword.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const firstH2 = firstIdx >= 0 ? split.parts[firstIdx].h2 ?? "" : "";
  const kwInFirst = !!firstH2 && kwTokens.every((t) => firstH2.toLowerCase().includes(t));
  if (firstIdx >= 0 && !kwInFirst) {
    addSection("first-h2-keyword", "Keyword in the first heading", "Structure", firstIdx, `the first heading "${firstH2}" does not contain "${input.primaryKeyword}"`);
  } else {
    add("first-h2-keyword", "Keyword in the first heading", "Structure", firstIdx >= 0, firstIdx >= 0 ? `"${firstH2}" carries the keyword` : "the article has no sections");
  }

  // Section 9: a real verdict, not both sides and stop.
  const hasVerdict = split.parts.some((p) => p.h2 !== null && VERDICT_HEADING.test(p.h2));
  add("verdict-section", "A clear verdict section", "Human voice", hasVerdict, hasVerdict ? "states a verdict" : 'no section states a verdict (a heading like "What is our verdict on ...?" that makes a real recommendation)');

  // Section 8: data claims come with their limits.
  if (FIGURE.test(prose(body))) {
    const hasLimits = split.parts.some((p) => (p.h2 !== null && LIMITS_TEXT.test(p.h2)) || LIMITS_TEXT.test(prose(p.markdown)));
    add("limits-note", "A note on the limits of the numbers", "Trust", hasLimits, hasLimits ? "says what the numbers do not cover" : "the article states figures but never says what they do not cover");
  }

  // Section 11: no more than two answers in a row open the same way.
  const openers = split.parts
    .map((p, idx) => ({ idx, p }))
    .filter(({ p }) => p.h2 !== null && !isQuickAnswers(p.h2))
    .map(({ idx, p }) => {
      const a = answerParagraph(p.markdown);
      return { idx, first: a ? (words(prose(a))[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") : "" };
    });
  let repeated = false;
  for (let i = SAME_OPENING_RUN - 1; i < openers.length; i++) {
    const run = openers.slice(i - SAME_OPENING_RUN + 1, i + 1);
    if (run[0].first && run.every((o) => o.first === run[0].first)) {
      repeated = true;
      addSection("opening-pattern", "Answers do not all open the same way", "Human voice", openers[i].idx, `this is the ${SAME_OPENING_RUN}rd answer in a row that opens with "${run[0].first}"`);
    }
  }
  if (!repeated) add("opening-pattern", "Answers do not all open the same way", "Human voice", true, "answers open in different ways");

  // Section 15, lever 8: semicolons cut almost entirely.
  const semis = split.parts.map((p) => (proseText(p.markdown).match(/;/g) || []).length);
  const totalSemis = semis.reduce((a, b) => a + b, 0);
  if (totalSemis > MAX_SEMICOLONS) {
    semis.forEach((n, idx) => {
      if (n > 0) addSection("semicolons", `At most ${MAX_SEMICOLONS} semicolon`, "Writing style", idx, `${n} semicolon(s) here, ${totalSemis} in the article`);
    });
  } else {
    add("semicolons", `At most ${MAX_SEMICOLONS} semicolon`, "Writing style", true, `${totalSemis} semicolon(s)`);
  }

  // Sections 7 and 12: 3-5 internal links and 2+ external ones, capped by what really exists.
  const siteHost = input.siteUrl ? hostOf(input.siteUrl, null) : null;
  const allLinks = linksIn(body);
  const isInternal = (u: string) => (siteHost ? hostOf(u, input.siteUrl) === siteHost : !/^https?:/i.test(u));
  const internal = allLinks.filter(isInternal);
  const external = allLinks.filter((u) => /^https?:/i.test(u) && !isInternal(u));
  const allowedInternal = new Set(input.allowedLinks.filter((l) => isInternal(l.url)).map((l) => l.url)).size;
  const allowedExternal = new Set(input.allowedLinks.filter((l) => /^https?:/i.test(l.url) && !isInternal(l.url)).map((l) => l.url)).size;

  const needInternal = Math.min(INTERNAL_LINKS_MIN, allowedInternal);
  if (allowedInternal === 0 && internal.length === 0) {
    add("internal-links", `${INTERNAL_LINKS_MIN}-${INTERNAL_LINKS_MAX} internal links`, "Links and sources", true, "skipped: no crawled pages of this site are on file to link to", true);
  } else {
    const ok = internal.length >= needInternal && internal.length <= INTERNAL_LINKS_MAX;
    add(
      "internal-links",
      `${INTERNAL_LINKS_MIN}-${INTERNAL_LINKS_MAX} internal links`,
      "Links and sources",
      ok,
      internal.length > INTERNAL_LINKS_MAX
        ? `${internal.length} internal links (at most ${INTERNAL_LINKS_MAX})`
        : `${internal.length} internal link(s)${internal.length < needInternal ? ` (needs ${needInternal}${needInternal < INTERNAL_LINKS_MIN ? `, all the site has on file` : ""})` : ""}`,
    );
  }
  const needExternal = Math.min(EXTERNAL_LINKS_MIN, allowedExternal);
  if (allowedExternal === 0 && external.length === 0) {
    add("external-links", `${EXTERNAL_LINKS_MIN}+ authoritative sources linked`, "Links and sources", true, "skipped: no verified outside sources were found for this topic, and none may be invented", true);
  } else {
    add(
      "external-links",
      `${EXTERNAL_LINKS_MIN}+ authoritative sources linked`,
      "Links and sources",
      external.length >= needExternal,
      `${external.length} outside source link(s)${external.length < needExternal ? ` (needs ${needExternal})` : ""}`,
    );
  }

  // Section 12: a visible last-updated date and author.
  const stamp = body.split("\n").find((l) => STAMP_RE.test(l.trim())) ?? "";
  const bylineOk = !!stamp && (!input.author || stamp.includes(`By ${input.author.replace(/\*/g, "").trim()}`));
  add("byline", "Last-updated date and author", "Trust", bylineOk, bylineOk ? stamp.replace(/\*/g, "") : "no last-updated date and author line under the title");

  return out;
}

/** Section 7: every link is fetched for real. A link that does not load is failed against the
 *  section it sits in, so only that section is rewritten to replace it. */
async function liveLinkChecks(split: SplitArticle, input: ReviewInput, check: (url: string) => Promise<boolean>): Promise<ReviewCheck[]> {
  const byUrl = new Map<string, number>();
  const unresolvable: { url: string; idx: number }[] = [];
  split.parts.forEach((p, idx) => {
    for (const u of linksIn(p.markdown)) {
      const abs = absoluteUrl(u, input.siteUrl);
      if (!abs || !/^https?:/i.test(abs)) {
        unresolvable.push({ url: u, idx });
        continue;
      }
      if (!byUrl.has(abs)) byUrl.set(abs, idx);
    }
  });

  const results = await Promise.all([...byUrl].map(async ([url, idx]) => ({ url, idx, ok: await check(url) })));
  const dead = [...results.filter((r) => !r.ok), ...unresolvable.map((u) => ({ url: u.url, idx: u.idx, ok: false }))];

  if (!dead.length) {
    return [
      {
        id: "live-links",
        label: "Every link loads",
        group: "Links and sources",
        ok: true,
        detail: byUrl.size ? `all ${byUrl.size} link(s) loaded when fetched` : "no links to check",
        section: null,
        part: null,
        fix: "article",
      },
    ];
  }
  return dead.map((d) => ({
    id: "live-links",
    label: "Every link loads",
    group: "Links and sources" as ReviewGroup,
    ok: false,
    detail: `${d.url} did not load when fetched: replace it with a working link from the allowed list, or remove it`,
    section: split.parts[d.idx]?.h2 ?? "Introduction",
    part: d.idx,
    fix: "section" as const,
  }));
}

export async function checkArticle(
  body: string,
  input: ReviewInput,
  checkLink: (url: string) => Promise<boolean>,
): Promise<{ passed: boolean; checks: ReviewCheck[]; split: SplitArticle }> {
  const split = splitArticle(body);
  const checks = [...sectionChecks(split), ...articleChecks(body, split, input), ...(await liveLinkChecks(split, input, checkLink))];
  return { passed: checks.every((c) => c.ok), checks, split };
}

/** A real, live fetch. HEAD first, GET when a server refuses HEAD, one retry on a network
 *  error. Anything that never comes back under 400 did not load, and is reported that way. */
export async function checkLinkLive(url: string): Promise<boolean> {
  const headers = { "User-Agent": "MrLxwaBot/1.0 (+https://mrlxwa.com; checking that an article's links load)" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow", headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 405 || res.status === 403 || res.status === 501) {
        res = await fetch(url, { method: "GET", redirect: "follow", headers, signal: AbortSignal.timeout(10000) });
        void res.body?.cancel().catch(() => {});
      }
      if (res.status < 400) return true;
      if (res.status !== 429 && res.status < 500) return false;
    } catch {
      // network error or timeout: one more try, then it did not load
    }
  }
  return false;
}

/* ---------------------------------------------------------------- the rewrite ------------- */

function linkNotes(input: ReviewInput): string {
  const list = input.allowedLinks.slice(0, 20);
  return list.length
    ? `REAL, VERIFIED LINKS YOU MAY USE (use only these exact URLs, never invent one):\n${list.map((l) => `- ${l.title}: ${l.url}`).join("\n")}`
    : "No verified links are on file for this article: do not add any link.";
}

function houseRules(input: ReviewInput, isFirstSection: boolean): string {
  return [
    `HOUSE RULES THIS PART MUST MEET (every one is checked by code after you answer):`,
    `- The "##" heading is the real question a searcher would type, ending with "?".${isFirstSection ? ` This is the first section, so the heading must contain "${input.primaryKeyword}".` : ""}`,
    `- The paragraph right after the heading answers it in ${SNIPPET_MIN_WORDS}-${SNIPPET_MAX_WORDS} words, with the number, the yes/no, or the name first. Never open with "It depends".`,
    `- Every paragraph is 2-${MAX_PARAGRAPH_SENTENCES} sentences.`,
    `- At least one sentence of ${SHORT_SENTENCE_MAX_WORDS} words or fewer for every ${WORDS_PER_SHORT_SENTENCE} words, and never three sentences in a row within ${UNIFORM_SPREAD_WORDS} words of each other in length.`,
    `- No em dash (—) and no semicolons.`,
    `- Never use: ${BANNED_PHRASES.slice(0, 60).join(", ")}.`,
    `- Never write "the best", "guaranteed", "#1" or "number one", and never "studies show" or "experts say", unless that exact sentence links its real source.`,
    `- If the heading asks how to do something, or for steps, types, ways or tips, include a list of ${LIST_MIN_ITEMS}-${LIST_MAX_ITEMS} items of ${LIST_ITEM_MIN_WORDS}-${LIST_ITEM_MAX_WORDS} words each.`,
    `- Never invent a fact, number, date, name, quote, study or URL. Keep every fact, link, table and list already in this part that is not itself flagged.`,
  ].join("\n");
}

/** One part of the article, rewritten against exactly the rules it broke. */
export async function rewriteSection(
  input: ReviewInput,
  part: ArticlePart,
  failures: string[],
  isFirstSection: boolean,
  complete: Completer,
): Promise<string> {
  const isIntro = part.h2 === null;
  const prompt = [
    `You are fixing ONE part of an article titled "${input.title}" on "${input.topic}". Rewrite ONLY this part so that every problem below is fixed. Do not write any other part of the article.`,
    `PROBLEMS TO FIX:\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
    isIntro ? `This is the article's opening, before the first heading. It has no heading of its own.` : houseRules(input, isFirstSection),
    linkNotes(input),
    `PART TO REWRITE:\n<<<\n${part.markdown}\n>>>`,
    isIntro
      ? `Output only the rewritten opening as markdown, with no heading, no preamble and no note about what you changed.`
      : `Output only the rewritten part as markdown, starting with "## " and its heading, with no preamble and no note about what you changed.`,
  ].join("\n\n");

  let text = (await complete(prompt, { maxTokens: 1400, label: "writer.section-rewrite" })).trim();
  text = text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();

  if (isIntro) {
    return text
      .split("\n")
      .filter((l) => !/^#{1,6}\s/.test(l))
      .join("\n")
      .trim();
  }
  // A reply that lost its heading keeps the original one rather than orphaning the section; the
  // next round's check still judges the heading on its own merits.
  if (!/^##\s+\S/.test(text)) text = `## ${part.h2}\n\n${text.replace(/^#{1,6}\s+.*\n?/, "").trim()}`;
  return text;
}

/* ---------------------------------------------------------------- the loop ---------------- */

function failureLine(c: ReviewCheck): string {
  return `${c.label}: ${c.detail}`;
}

function auditChecks(audit: HumanizeAudit | null, error: string | null, split: SplitArticle): ReviewCheck[] {
  if (error) {
    return [{ id: "human-audit", label: "Independent human-voice review", group: "Human voice", ok: false, detail: `the review could not run: ${error}`, section: null, part: null, fix: "article" }];
  }
  if (!audit || audit.passed) {
    return [{ id: "human-audit", label: "Independent human-voice review", group: "Human voice", ok: true, detail: "an independent reviewer found no human-voice, experience, verdict or sourcing problems", section: null, part: null, fix: "article" }];
  }
  return audit.issues.map((issue) => {
    const needle = normalize(issue.quote).slice(0, 50);
    const idx = needle ? split.parts.findIndex((p) => normalize(p.markdown).includes(needle)) : -1;
    return {
      id: "human-audit",
      label: issue.rule || "Independent human-voice review",
      group: "Human voice" as ReviewGroup,
      ok: false,
      detail: `"${issue.quote}": ${issue.fix}`,
      section: idx >= 0 ? split.parts[idx].h2 ?? "Introduction" : null,
      part: idx >= 0 ? idx : null,
      fix: idx >= 0 ? ("section" as const) : ("article" as const),
    };
  });
}

export async function runArticleReview(initialBody: string, input: ReviewInput, deps: ReviewDeps): Promise<ReviewOutcome> {
  const emit: ReviewEvent = deps.onEvent ?? (() => {});
  const progress = deps.onProgress ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const linkCache = new Map<string, Promise<boolean>>();
  const cachedCheck = (url: string) => {
    if (!linkCache.has(url)) linkCache.set(url, deps.checkLink(url).catch(() => false));
    return linkCache.get(url)!;
  };

  let body = initialBody;
  let audit: HumanizeAudit | null = null;
  let auditError: string | null = null;
  let auditFixes = 0;
  let auditErrors = 0;
  let lastChecks: ReviewCheck[] = [];
  let passed = false;
  let rounds = 0;
  let sectionRewrites = 0;
  let articleRevisions = 0;

  const applyFixes = async (failing: ReviewCheck[], round: number) => {
    const split = splitArticle(body);
    const firstIdx = split.parts.findIndex((p) => p.h2 !== null && !isQuickAnswers(p.h2));
    const byPart = new Map<number, string[]>();
    const articleLevel: string[] = [];
    for (const c of failing) {
      if (c.fix === "section" && c.part !== null && split.parts[c.part]) {
        byPart.set(c.part, [...(byPart.get(c.part) ?? []), failureLine(c)]);
      } else {
        articleLevel.push(failureLine(c));
      }
    }

    progress(`Rewriting ${byPart.size} section(s) that broke the writing rules (round ${round})`);
    await Promise.all(
      [...byPart].map(async ([idx, failures]) => {
        const part = split.parts[idx];
        const name = part.h2 ?? "Introduction";
        emit("section_rewrite", { round, section: name, reasons: failures, status: "rewriting" });
        try {
          const md = await rewriteSection(input, part, failures, idx === firstIdx, deps.complete);
          const newH2 = part.h2 === null ? null : headingOf(md) ?? part.h2;
          split.parts[idx] = { h2: newH2, markdown: md };
          sectionRewrites++;
          const wordsNow = words(proseText(md)).length;
          emit("section_rewrite", { round, section: name, status: "done", newSection: newH2 ?? "Introduction", words: wordsNow });
          if (part.h2 !== null && newH2) emit("section_revised", { replaces: part.h2, h2: newH2, text: md, words: wordsNow });
        } catch (e: any) {
          emit("section_rewrite", { round, section: name, status: "failed", error: String(e?.message ?? e) });
        }
      }),
    );
    body = assembleArticle(split);

    if (articleLevel.length) {
      progress(`Fixing ${articleLevel.length} article-wide rule(s) (round ${round})`);
      emit("article_revise", { round, reasons: articleLevel, status: "revising" });
      try {
        const revised = await reviseArticle(input.title, input.topic, body, articleLevel, deps.complete, `${houseRules(input, false)}\n\n${linkNotes(input)}`);
        if (/^#\s+\S/m.test(revised)) {
          body = revised;
          articleRevisions++;
          emit("article_revise", { round, status: "done", words: words(proseText(revised)).length });
        } else {
          emit("article_revise", { round, status: "failed", error: "the revision came back without the article's title line, so the previous draft was kept" });
        }
      } catch (e: any) {
        emit("article_revise", { round, status: "failed", error: String(e?.message ?? e) });
      }
    }
  };

  for (let round = 1; round <= REVIEW_MAX_ROUNDS; round++) {
    rounds = round;
    body = stampByline(body, now(), input.author);

    progress(`Checking every writing rule (round ${round} of ${REVIEW_MAX_ROUNDS})`);
    emit("review_round", { round, max: REVIEW_MAX_ROUNDS, stage: "rules" });
    const mech = await checkArticle(body, input, cachedCheck);
    lastChecks = mech.checks;
    emit("review_result", {
      round,
      max: REVIEW_MAX_ROUNDS,
      stage: "rules",
      passed: mech.passed,
      failed: mech.checks.filter((c) => !c.ok).length,
      total: mech.checks.length,
      checks: mech.checks,
    });

    if (!mech.passed) {
      audit = null;
      if (round === REVIEW_MAX_ROUNDS) break;
      await applyFixes(mech.checks.filter((c) => !c.ok), round);
      continue;
    }

    progress(`Independent human-voice review (round ${round})`);
    emit("review_round", { round, max: REVIEW_MAX_ROUNDS, stage: "humanize" });
    try {
      audit = await auditHumanization(body, input.topic, deps.complete);
      auditError = null;
    } catch (e: any) {
      audit = null;
      auditError = String(e?.message ?? e);
      auditErrors++;
    }
    const voice = auditChecks(audit, auditError, mech.split);
    lastChecks = [...mech.checks, ...voice];
    emit("review_result", {
      round,
      max: REVIEW_MAX_ROUNDS,
      stage: "humanize",
      passed: !auditError && !!audit?.passed,
      failed: voice.filter((c) => !c.ok).length,
      total: voice.length,
      checks: voice,
    });

    if (!auditError && audit?.passed) {
      passed = true;
      break;
    }
    if (round === REVIEW_MAX_ROUNDS) break;
    if (auditError) {
      if (auditErrors >= 2) break;
      continue;
    }
    if (auditFixes >= REVIEW_MAX_AUDIT_FIXES) break;
    auditFixes++;
    await applyFixes(voice.filter((c) => !c.ok), round);
  }

  const failures = passed
    ? []
    : lastChecks.filter((c) => !c.ok).map((c) => `${c.section ? `"${c.section}": ` : ""}${failureLine(c)}`);
  emit("review_final", { passed, rounds, max: REVIEW_MAX_ROUNDS, failures, sectionRewrites, articleRevisions });

  return { body, passed, rounds, checks: lastChecks, audit, auditError, failures, sectionRewrites, articleRevisions };
}
