import { nvidiaFetch } from "./nvidia.js";
import type { WriterContext } from "./writer.js";
import { hasMarkdownTable, markdownListItemCount, questionAnswerPairCount, MIN_LIST_ITEMS, MIN_QA_PAIRS } from "./qualityGate.js";

/** Section-by-section writing — MASTER_PLAN §16.3 Upgrade E, and the self-audit's own words
 *  for why the old one-shot writer had to go: "ek shot me 1800 words hamesha flat hote hain".
 *
 *  THE FOUR CALLS, IN THE PLAN'S OWN ORDER:
 *
 *   1. OUTLINE — one call: the H2 structure, each section's goal, its target keyword
 *      placement, and the reader's question it answers. This is what makes every later step
 *      differentiated instead of guessing at structure mid-sentence.
 *   2. SECTIONS — one call per H2, in PARALLEL. Each gets only its own outline slot plus the
 *      shared business context — nothing about its siblings. That is a real trade against the
 *      plan's literal words ("previous section ki last 2 lines") — true parallelism and a real
 *      dependency on a sibling's finished text cannot both be true at once, and cost/latency
 *      is why parallel wins here. The gap this leaves (weak transitions between sections
 *      written blind to each other) is exactly what step 3 exists to close.
 *   3. POLISH — one call, the assembled draft, full context restored. Transitions, repetition,
 *      the cliché sweep, the intro rewritten now that the whole article is known — the plan's
 *      own parenthetical ("ab jab poora article pata hai") is doing real work: this is where
 *      continuity actually gets enforced, not step 2.
 *   4. META — one call: title, meta description, slug, Article JSON-LD. Never generated
 *      before this file existed — lib/qualityGate.ts and lib/seoChecks.ts have carried
 *      `metaTitle`/`metaDescription` scoring since Phase 2 planning began, and nothing ever
 *      populated them, so those checks silently no-op'd on every single article. They stop
 *      no-opping the day this pipeline lands.
 *
 *  RESEARCH (2026-08-28, real gpt-researcher, not a stand-in): lib/research/gptResearcher.ts
 *  spawns gpt-researcher's OWN Python `conduct_research()` — real web search, real source
 *  fetching — as a subprocess inside THIS SAME Railway service ("one service" decision,
 *  2026-08-28), never a separate deploy unit. It stops there: `write_report()` is never called,
 *  matching the plan's own scope ("sirf conduct_research(), write_report() nahi"). Its output
 *  (background context + source list) reaches only `buildOutline`'s prompt, as material for
 *  deciding WHAT SUBTOPICS AND QUESTIONS a real article on this topic should cover — never as a
 *  source of business-specific facts. Every fact the article states still has to come from the
 *  tenant's own Site Brain, its crawled pages, or the keyword blueprint (`WRITING_RULES` rule 4:
 *  never invent a stat, price, award or name) — the outline prompt says this explicitly, and
 *  `writeSection`'s prompt (which never receives the research context at all) enforces it
 *  structurally, not just by instruction. Research is an optional improvement, not a
 *  prerequisite: missing Python, a missing package, or a timed-out crawl all resolve to `null`
 *  (see gptResearcher.ts's own header) and the pipeline writes exactly as it did before this
 *  step existed.
 *
 *  Every step below takes an injectable `complete` (or is `complete` itself), same convention
 *  as agents/social.ts's `draftPosts` — so the pipeline's SHAPE (parallel sections, one polish
 *  pass, one meta pass) is provable from a fake model, not from a live 30-second NVIDIA call.
 */

export type OutlineSection = { h2: string; goal: string; keyword: string; readerQuestion: string };
export type Outline = { title: string; sections: OutlineSection[] };
export type WriterMeta = { metaTitle: string; metaDescription: string; slug: string; jsonLd: string };
export type PipelineSection = { h2: string; text: string; words: number };
export type PipelineResult = {
  title: string;
  body: string;
  sections: PipelineSection[];
  meta: WriterMeta;
};

/** What gpt-researcher's `conduct_research()` hands back — background/structure only, never a
 *  business fact source. See gptResearcher.ts and this file's header for the scope. */
export type ResearchResult = { context: string; sources: { url: string; title: string }[] };
/** Injectable the same way `Completer` is — the real one shells out to Python, tests fake it. */
export type Researcher = (topic: string) => Promise<ResearchResult | null>;

/** The one thing every step needs and disagrees about how much of: raw text out, for a raw
 *  text prompt in. JSON-shaped steps (outline, meta) parse their own answer; prose steps
 *  (section, polish) use it as markdown directly — matching lib/writer.ts's own convention of
 *  never JSON-wrapping long prose, where escaping a 400-word section as a JSON string is
 *  fragile for no benefit over just reading `choices[0].message.content`. */
export type Completer = (prompt: string, opts?: { maxTokens?: number; label?: string }) => Promise<string>;

const WRITER_TIMEOUT_MS = Number(process.env.WRITER_TIMEOUT_MS) || 180_000;

/** The real completer, NIM via nvidiaFetch — same model, same "thinking off" switch, same
 *  shared NVIDIA_API_KEYS_BG key-pool limiter every other agent-server call respects (§18.4's
 *  rule 4: "writer ko chhote calls me todo... 40 RPM me aaram se aata hai"), which this
 *  pipeline's whole shape (5-6 short calls instead of one long one) is built to fit inside. */
export async function nimComplete(prompt: string, opts: { maxTokens?: number; label?: string } = {}): Promise<string> {
  let res: Response;
  try {
    res = await nvidiaFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      label: opts.label ?? "writer",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        stream: false,
        chat_template_kwargs: { thinking: false }, // see lib/writer.ts — the soft prompt hint alone is not enough
        max_tokens: opts.maxTokens ?? 800,
        messages: [
          { role: "system", content: "detailed thinking off\n\nYou write only from the context you are given. If a fact is not in it, you do not state it." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(WRITER_TIMEOUT_MS),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || /aborted|timeout/i.test(e?.message ?? "")) {
      throw new Error(`Mr. Writer's model did not answer within ${Math.round(WRITER_TIMEOUT_MS / 1000)}s (${opts.label ?? "writer"} step).`);
    }
    throw e;
  }

  if (!res.ok) throw new Error(`NVIDIA writer call failed (${opts.label ?? "writer"}, ${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data: any = await res.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error(`NVIDIA writer: no content in response (${opts.label ?? "writer"} step)`);
  if (choice?.finish_reason === "length") throw new Error(`Mr. Writer's ${opts.label ?? "writer"} step was cut off by the model's token limit.`);
  return text;
}

/** Strict-enough JSON extraction for a model that was asked for "ONLY JSON" and sometimes
 *  still wraps it in a code fence. Throws with the raw text attached (truncated) rather than
 *  a bare parse error — every upstream caller needs to know WHICH step produced garbage. */
function parseJsonReply<T>(raw: string, step: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    throw new Error(`Mr. Writer's ${step} step did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}

function contextLines(context?: WriterContext): string {
  if (!context) return "";
  const bits: string[] = [];
  if (context.businessName) bits.push(`Business: ${context.businessName}`);
  if (context.niche) bits.push(`What they do: ${context.niche}`);
  if (context.audience) bits.push(`Audience: ${context.audience}`);
  if (context.tone) bits.push(`Brand tone: ${context.tone}`);
  return bits.length ? `BUSINESS CONTEXT:\n${bits.join("\n")}` : "";
}

/* ---------------------------------------------------------------- 1 · outline ------------ */

// Raised 3 → 4 on 2026-08-31. Belt and braces with the per-section floor: even if the model
// under-delivers on every section the way it did at 3×~120 words, four sections clear the
// quality gate's 600-word block instead of landing at 362 and being thrown away.
const MIN_SECTIONS = 4;
const MAX_SECTIONS = 6;

export async function buildOutline(
  topic: string,
  blueprint: string | undefined,
  context: WriterContext | undefined,
  complete: Completer,
  research?: ResearchResult | null
): Promise<Outline> {
  const researchLines = research?.context
    ? `WHAT THE OPEN WEB COVERS ON THIS TOPIC (gpt-researcher, background only — use this only to decide which subtopics and reader questions are worth a section; do NOT copy any fact, number, name or claim from it into the outline or later into the article — every fact the article states must come from BUSINESS CONTEXT / BLUEPRINT above, not from here):\n${research.context.slice(0, 3000)}`
    : "";

  const prompt = [
    `Plan the structure of an SEO article on "${topic}". Do not write the article — only the outline.`,
    contextLines(context),
    blueprint ? `BLUEPRINT (from real keyword research — use these related queries as section subjects, most-searched first):\n${blueprint}` : "",
    researchLines,
    `Produce ${MIN_SECTIONS}-${MAX_SECTIONS} sections (H2s). For each: the heading, what it must accomplish (goal), the exact phrase it should place naturally (keyword — from the blueprint's related queries when there are enough, otherwise a natural variation of the topic), and the single reader question it answers.`,
    `The article title is separate from the topic — write a real title a reader would click, not the raw keyword.`,
    // documnet/Article_Writing_Rules.md sections 1, 2, 9 and 13, checked hard by lib/articleReview.ts:
    // asking for them at the outline is what lets most drafts clear the review on its first round.
    `Every heading must be the real question a searcher would type, ending with "?". The FIRST heading must contain "${topic}". One heading must ask for a verdict (for example "What is our verdict on ...?"), and that section's job is to make a clear recommendation.`,
    `Reply with ONLY JSON: {"title":"...","sections":[{"h2":"...","goal":"...","keyword":"...","readerQuestion":"..."}]}`,
  ].filter(Boolean).join("\n\n");

  const raw = await complete(prompt, { maxTokens: 900, label: "writer.outline" });
  const parsed = parseJsonReply<{ title?: string; sections?: Partial<OutlineSection>[] }>(raw, "outline");

  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((s) => ({ h2: String(s.h2 ?? "").trim(), goal: String(s.goal ?? "").trim(), keyword: String(s.keyword ?? "").trim(), readerQuestion: String(s.readerQuestion ?? "").trim() }))
    .filter((s) => s.h2)
    .slice(0, MAX_SECTIONS);

  if (sections.length < MIN_SECTIONS) {
    throw new Error(`Mr. Writer's outline step produced only ${sections.length} usable section(s) — refusing to write an article that thin.`);
  }

  return { title: String(parsed.title ?? "").trim() || topic, sections };
}

/* ---------------------------------------------------------------- 2 · sections ----------- */

/** One H2, on its own. No sibling text reaches this call — see the file header for why that
 *  is a deliberate trade, made up for in `polishArticle`. */
export async function writeSection(
  topic: string,
  outline: Outline,
  section: OutlineSection,
  context: WriterContext | undefined,
  complete: Completer
): Promise<string> {
  const prompt = [
    `Write ONE section of an article titled "${outline.title}" (overall subject: "${topic}").`,
    contextLines(context),
    context?.siteBrain ? context.siteBrain : "",
    context?.cta ? `If this section is where a call to action fits naturally, point the reader at "${context.cta.name}"${context.cta.url ? ` (link it to ${context.cta.url})` : " (no URL on file — name it, do not invent a link)"}. Otherwise skip the CTA — it does not belong in every section.` : "",
    // E-E-A-T linking (2026-09-04) — offered here as a soft, section-local fit, same pattern as
    // the CTA line above; polishArticle below is the backstop that guarantees at least one
    // actually lands, since not every section is a natural fit for either.
    context?.proof?.length
      ? `If a claim in this section is backed by real proof on file, link it: ${context.proof.slice(0, 4).map((p) => `"${p.claim}" (${p.url})`).join("; ")}. Only where it genuinely supports what this section says — do not force it in.`
      : "",
    context?.trustPage
      ? `If this section is where a reader would naturally want to know who is behind this, link the site's own About/Contact page: ${context.trustPage.url}. Otherwise skip it here.`
      : "",
    `SECTION HEADING: ${section.h2}`,
    `THIS SECTION'S JOB: ${section.goal}`,
    `THE READER'S QUESTION IT ANSWERS: ${section.readerQuestion}`,
    `Place this phrase naturally, once: "${section.keyword}"`,
    // LENGTH IS STATED AS A HARD FLOOR, NOT A RANGE. Measured live 2026-08-31: with
    // "300-400 words" the model delivered ~120 per section, so a 3-section article came out at
    // 362 words and the quality gate blocked it (DEFAULT_MIN_WORDS 600) — a real article,
    // written about the right thing, thrown away for length alone. A floor plus an explicit
    // "do not stop early" reads as a requirement rather than a suggestion.
    `LENGTH: at least 300 words for this section — this is a hard minimum, not a target. Do not stop early; if you run short, go deeper on the reader's question with specifics rather than padding.`,
    `Start with "## ${section.h2}" then the prose. The very next paragraph after the heading must answer "${section.readerQuestion}" directly in its first sentence (the number, the yes/no, or the name first), in 40-58 words total — this is the length Google most often lifts into a featured snippet, so do not open with throat-clearing.`,
    `Short paragraphs (2-4 sentences) for everything after that first one. No filler, no "in today's fast-paced world" openings. Never use an em dash (—); use a period, comma, or colon instead. Use only facts present in the context above — never invent a statistic, price, award, client name or date.`,
    `Rhythm: at least one sentence of 6 words or fewer for every 150 words, and never three sentences in a row within 5 words of each other in length. No semicolons. Never write "the best", "guaranteed", "#1" or "number one", and never "studies show" or "experts say" unless that sentence links the real source. If the heading asks how to do something, or for steps, types, ways or tips, include a list of 5-8 items of 3-8 words each.`,
    `Output markdown only — no preamble, no explanation.`,
  ].filter(Boolean).join("\n\n");

  // 700 tokens capped a 300-word section at roughly its own minimum, leaving the model no room
  // to satisfy the floor above — 1100 gives ~450 words of headroom.
  const text = await complete(prompt, { maxTokens: 1100, label: "writer.section" });
  return text.trim();
}

/* ---------------------------------------------------------------- 3 · polish ------------- */

/** One call, the whole draft, full context restored — this is where inter-section transitions
 *  and the intro actually get written, because it is the first point in the pipeline where the
 *  WHOLE article exists to write them from. */
export async function polishArticle(
  outline: Outline,
  topic: string,
  sections: PipelineSection[],
  context: WriterContext | undefined,
  complete: Completer
): Promise<string> {
  const draft = [`# ${outline.title}`, "", ...sections.map((s) => s.text)].join("\n\n");

  // E-E-A-T linking backstop (2026-09-04) — writeSection above already offers these per-section,
  // but not every section is a natural fit for either, so nothing guarantees one actually
  // landed. This is the one point in the pipeline that sees the WHOLE assembled draft, so it is
  // the only place that can reliably check "is it already there?" before asking for it.
  const proofLine = context?.proof?.length
    ? `Real proof on file: ${context.proof.slice(0, 4).map((p) => `"${p.claim}" (${p.url})`).join("; ")}.`
    : "";
  const trustLine = context?.trustPage ? `The site's own About/Contact page: ${context.trustPage.url}.` : "";
  const eeatFixLine =
    proofLine || trustLine
      ? `7. If the draft does not already link to real evidence anywhere, add ONE natural sentence that does. ${proofLine} ${trustLine} Link whichever genuinely fits what the article already says — never force an awkward mention, and never link anything not listed here. Skip this if the draft already links one of them.`
      : "";

  // Forced-structure backstops (documnet/Article_Writing_Rules.md sections 4 and 6, owner
  // instruction 2026-09-12: every article, not just comparative or FAQ-shaped ones) — same "is
  // it already there?" pattern as eeatFixLine above, and for the same reason: this is the one
  // point in the pipeline that sees the whole draft, so it is the only place that can check
  // before asking for something rather than asking unconditionally and risking a duplicate.
  const tableFixLine = hasMarkdownTable(draft)
    ? ""
    : `8. Add ONE real markdown table (a header row, then a --- separator row) summarizing numbers already stated in the draft above (prices, timeframes, options) — never invent a figure to fill a cell.`;
  const listFixLine =
    markdownListItemCount(draft) >= MIN_LIST_ITEMS
      ? ""
      : `9. Add a bullet or numbered list of at least ${MIN_LIST_ITEMS} items somewhere it fits naturally — steps, a short set of parallel facts, or options already discussed in the draft.`;
  const qaFixLine =
    questionAnswerPairCount(draft) >= MIN_QA_PAIRS
      ? ""
      : `10. Add a "Quick answers about ${topic}" section near the end: ${MIN_QA_PAIRS}-4 short list items, each "- **Question?** One-sentence answer," covering things not already answered by an H2 above. Never title this section "FAQ" or "Frequently Asked Questions" — that heading text is banned regardless of how the section is formatted.`;

  const prompt = [
    `Polish this article draft on "${topic}". Do not shorten it or remove any section — every H2 below must still be present, in the same order.`,
    contextLines(context),
    `WHAT TO FIX:`,
    `1. Write or rewrite the opening (before the first ##) so it answers the primary topic in the first 100 words — no throat-clearing.`,
    `2. Smooth the transition between each pair of sections — right now they were written independently and may jump.`,
    `3. Remove repeated phrases and any AI-cliché wording (delve, tapestry, in today's fast-paced world, game-changer, unlock, unleash, and similar).`,
    `4. End with one concrete next step the reader can take.`,
    `5. Do NOT add facts that are not already in the draft or the context above.`,
    `6. Replace every em dash (—) with a period, comma, or colon. Check that the paragraph right after each ## heading still answers it directly in 40-58 words after your edits; a rewrite that pushes it outside that range needs a further trim, not a new fact added to pad it back out.`,
    eeatFixLine,
    tableFixLine,
    listFixLine,
    qaFixLine,
    ``,
    `DRAFT:`,
    draft,
    ``,
    `Output the complete polished article as markdown, starting with "# ${outline.title}" — no preamble, no explanation.`,
  ].filter(Boolean).join("\n\n");

  const text = await complete(prompt, { maxTokens: 4096, label: "writer.polish" });
  return text.trim();
}

/* ---------------------------------------------------------------- 3b · revise ------------ */

/** The hard-follow step (documnet/Article_Writing_Rules.md Part 3): qualityGate.ts is a real
 *  check, but until this function existed a gate failure just marked the row `status: 'failed'`
 *  and stopped (agents/writer.ts) — nothing ever asked the model to fix what the gate found.
 *  A prompt telling the model to "follow the rules" is a request; this is the enforcement.
 *
 *  Deliberately narrow: it is handed the EXACT block-level failures (never the warnings, which
 *  are worth a human's glance but not worth spending a retry on) and told to fix only those,
 *  leaving everything else in the draft untouched. A full regeneration would re-roll every rule
 *  that was already passing along with the ones that were not — this targets just the failures,
 *  the same "targeted rewrite, not full regeneration" rule Part 3 section 21 gives a reason for. */
export async function reviseArticle(
  title: string,
  topic: string,
  body: string,
  failures: string[],
  complete: Completer,
  notes?: string
): Promise<string> {
  const prompt = [
    `This article on "${topic}" failed its pre-publish quality gate. Fix ONLY the specific problems listed below. Do not shorten it, do not remove or reorder any section, do not touch anything that was not flagged — every "##" heading must still be present, in the same order, and the word count must not drop.`,
    `PROBLEMS TO FIX:`,
    ...failures.map((f, i) => `${i + 1}. ${f}`),
    ...(notes ? [notes] : []),
    ``,
    `DRAFT:`,
    body,
    ``,
    `Output the complete corrected article as markdown, starting with "# ${title}" — no preamble, no explanation, no note about what you changed.`,
  ].join("\n\n");

  const text = await complete(prompt, { maxTokens: 4096, label: "writer.revise" });
  return text.trim();
}

/* ---------------------------------------------------------------- 3c · humanize audit ---- */

export type HumanizeIssue = { rule: string; quote: string; fix: string };
export type HumanizeAudit = { passed: boolean; issues: HumanizeIssue[] };

/** The judgment-needed half of documnet/Article_Writing_Rules.md Part 2 (sections 14-18) and
 *  the judgment items in Part 1 that qualityGate.ts cannot check by regex: RLHF-voice tells
 *  (acknowledgment openers, unprompted on-the-other-hand balancing, hedged closers), whether a
 *  first-hand-sounding experience detail is genuinely present rather than just present in form,
 *  whether the article commits to a real verdict instead of hedging perpetually, and whether
 *  sentence rhythm reads as genuinely varied rather than uniform.
 *
 *  This is a SEPARATE model call from the one that wrote the article (Part 3 section 21's own
 *  reasoning: a model grading its own homework in the same context tends to rate it favourably),
 *  given only the finished draft and this rubric, with no memory of having written it.
 *
 *  Deliberately NOT wired into qualityGate.ts's pass/fail: these are subjective judgment calls,
 *  not measurable facts, and treating an LLM's own opinion about "does this read human" as a
 *  hard publish-blocking gate would fail exactly the "never let one code path invent false
 *  confidence" principle this whole file otherwise follows. It is advisory — see agents/writer.ts
 *  for the one bounded fix attempt this feeds, same "try once, then accept the result and move
 *  on" shape as the SEO rewrite loop in agents/seo.ts. */
export async function auditHumanization(body: string, topic: string, complete: Completer): Promise<HumanizeAudit> {
  const prompt = [
    `You are a strict, independent editor reviewing a finished article on "${topic}" for whether it reads as genuinely human-written, not for factual accuracy or SEO structure (those are checked elsewhere).`,
    `Check specifically for:`,
    `1. RLHF/instruction-tuning voice: acknowledgment-style openers ("That's a great question", "Certainly!"), unprompted on-the-other-hand balancing where the article was not asked to weigh two sides, hedged closers ("I hope this helps", "let me know if you have questions"), or generic assistant-register phrasing anywhere in the body.`,
    `2. Missing experience signal: does the article read as pure explanation with zero first-hand-sounding detail (a specific number, a concrete scenario, a "in practice, X happens" line), or does it have at least one such detail?`,
    `3. Perpetual hedging: does the article ever actually commit to a direct answer or a real recommendation, or does every claim get hedged into vagueness ("results may vary", "it depends on many factors" with no factors named)?`,
    `4. Uniform sentence rhythm: are most sentences roughly the same length with the same clause structure, rather than a genuine mix of short and long?`,
    `5. Repeated identical opening patterns: do 3 or more sentences or list items in a row start with the exact same grammatical construction?`,
    `6. Unsupported authority: a claim presented as established fact, a statistic, or a superlative with no named, linked source behind it ("studies show", "experts agree", "the most trusted").`,
    `7. Smoothed-over disagreement: where the article cites two sources or numbers that do not agree, did it silently pick one or blend them instead of stating both and why they differ?`,
    ``,
    `Reply with ONLY JSON, no preamble: {"passed": true or false, "issues": [{"rule": "which of the checks above", "quote": "the exact offending sentence or phrase from the article", "fix": "a one-sentence instruction for how to rewrite just that part"}]}`,
    `"passed" is true only if you found nothing worth flagging under any of the checks above. An empty "issues" array must accompany passed:true.`,
    ``,
    `ARTICLE:`,
    body,
  ].join("\n\n");

  const raw = await complete(prompt, { maxTokens: 1200, label: "writer.humanize-audit" });
  const parsed = parseJsonReply<{ passed?: boolean; issues?: Partial<HumanizeIssue>[] }>(raw, "humanize-audit");
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .map((i) => ({ rule: String(i.rule ?? "").trim(), quote: String(i.quote ?? "").trim(), fix: String(i.fix ?? "").trim() }))
    .filter((i) => i.rule && i.fix);

  return { passed: parsed.passed !== false && issues.length === 0, issues };
}

/* ---------------------------------------------------------------- 4 · meta --------------- */

export async function writeMeta(
  outline: Outline,
  topic: string,
  body: string,
  complete: Completer,
  context?: WriterContext,
): Promise<WriterMeta> {
  const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 1500);

  const prompt = [
    `Write the SEO metadata for this article. Title: "${outline.title}". Primary keyword: "${topic}".`,
    `EXCERPT (for grounding — do not copy verbatim):\n${excerpt}`,
    `metaTitle: 50-60 characters, includes the primary keyword, different wording from the article title if the title is already the right length.`,
    `metaDescription: 140-160 characters, a real reason to click, includes the primary keyword once.`,
    `slug: lowercase, hyphenated, no stopwords beyond what reads naturally, derived from the title.`,
    `jsonLd: a single-line, valid Article schema.org JSON-LD string (as a JSON string value, escaped) with headline, description and articleBody fields — articleBody may be truncated to a summary, it does not need the full text. Do NOT include author or datePublished — leave those out entirely, they are added afterwards from real data, not guessed.`,
    `Reply with ONLY JSON: {"metaTitle":"...","metaDescription":"...","slug":"...","jsonLd":"..."}`,
  ].join("\n\n");

  const raw = await complete(prompt, { maxTokens: 700, label: "writer.meta" });
  const parsed = parseJsonReply<Partial<WriterMeta>>(raw, "meta");

  return {
    metaTitle: String(parsed.metaTitle ?? "").trim() || outline.title,
    metaDescription: String(parsed.metaDescription ?? "").trim(),
    slug: String(parsed.slug ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || slugify(outline.title),
    jsonLd: withRealAuthorAndDate(String(parsed.jsonLd ?? "").trim(), outline.title, context?.businessName ?? null),
  };
}

/** The model is asked NOT to fill `author`/`datePublished` (see the prompt above) — a name or
 *  a date it invents would look exactly as confident as a real one, and lib/seoChecks.ts's
 *  E-E-A-T checks exist to tell a real signal from an absent one, not from a plausible-looking
 *  fake. So both are stamped here instead, from data that is actually true at this moment:
 *  the tenant's own real name (never invented — absent when Site Brain has none, in which case
 *  `author` is simply left off and the SEO check reports it honestly missing) and the real
 *  wall-clock time this article was written. `dateModified` starts equal to `datePublished`
 *  and is only ever meant to move on a real edit — nothing here updates it later. */
function withRealAuthorAndDate(jsonLdRaw: string, title: string, businessName: string | null): string {
  let ld: Record<string, unknown>;
  try {
    const parsed = jsonLdRaw ? JSON.parse(jsonLdRaw) : {};
    ld = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    ld = {};
  }

  if (!ld["@context"]) ld["@context"] = "https://schema.org";
  if (!ld["@type"]) ld["@type"] = "Article";
  if (!ld.headline) ld.headline = title;

  const now = new Date().toISOString();
  ld.datePublished = now;
  ld.dateModified = now;
  if (businessName) ld.author = { "@type": "Organization", name: businessName };

  return JSON.stringify(ld);
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* ---------------------------------------------------------------- the orchestrator ------- */

export type WriteOptions = {
  /** Called as each section finishes — writer.ts wires this to ctx.data("section", ...) so
   *  the live workspace shows the article assembling itself section by section, for real,
   *  instead of the old post-hoc split of an already-finished one-shot draft. */
  onSection?: (section: PipelineSection) => void;
  /** Real gpt-researcher, injected — writer.ts wires this to lib/research/gptResearcher.ts's
   *  `researchTopic`. Omitted entirely in every existing test, which is deliberate: the
   *  pipeline's shape must not depend on research being present. */
  researcher?: Researcher;
  /** Fires once, right after the research step resolves (found or skipped) — writer.ts wires
   *  this to ctx.data("research", ...) so the live workspace can show whether gpt-researcher
   *  actually ran for this article. */
  onResearch?: (result: ResearchResult | null) => void;
};

export async function writeArticlePipeline(
  topic: string,
  blueprint: string | undefined,
  context: WriterContext | undefined,
  complete: Completer,
  opts: WriteOptions = {}
): Promise<PipelineResult> {
  const research = opts.researcher ? await opts.researcher(topic) : null;
  opts.onResearch?.(research);

  const outline = await buildOutline(topic, blueprint, context, complete, research);

  // Truly concurrent — see the file header for why this is the deliberate reading of the
  // plan's "parallel" against its "previous section's last 2 lines". `onSection` fires the
  // instant EACH ONE resolves, not after every section is done: the old `Promise.all` then
  // `for` loop waited for the slowest section before emitting anything, so the live canvas sat
  // on "Writing the outline…" for the entire generation window and then dumped every section
  // at once (owner, 2026-09-12, screenshot: elapsed climbing past six minutes with a blank
  // canvas — "outliner bahut der tak aisa hi rehta hai"). `sections` is still written by index
  // so order and `polishArticle`'s input are unaffected — only the moment each one is reported
  // moved earlier, to whenever that section's own call actually finished.
  const sections: PipelineSection[] = new Array(outline.sections.length);
  await Promise.all(
    outline.sections.map(async (s, i) => {
      const text = await writeSection(topic, outline, s, context, complete);
      const section: PipelineSection = { h2: s.h2, text, words: text.trim().split(/\s+/).filter(Boolean).length };
      sections[i] = section;
      opts.onSection?.(section);
    })
  );

  const polished = await polishArticle(outline, topic, sections, context, complete);
  const meta = await writeMeta(outline, topic, polished, complete, context);

  return { title: outline.title, body: polished, sections, meta };
}
