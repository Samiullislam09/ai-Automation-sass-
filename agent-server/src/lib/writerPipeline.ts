import { env } from "../env.js";
import { nvidiaFetch } from "./nvidia.js";
import type { WriterContext } from "./writer.js";

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
 *  shared 30rpm limiter every other agent-server call respects (§18.4's rule 4: "writer ko
 *  chhote calls me todo... 40 RPM me aaram se aata hai"), which this pipeline's whole shape
 *  (5-6 short calls instead of one long one) is built to fit inside. */
export async function nimComplete(prompt: string, opts: { maxTokens?: number; label?: string } = {}): Promise<string> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  let res: Response;
  try {
    res = await nvidiaFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      label: opts.label ?? "writer",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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

const MIN_SECTIONS = 3;
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
    `SECTION HEADING: ${section.h2}`,
    `THIS SECTION'S JOB: ${section.goal}`,
    `THE READER'S QUESTION IT ANSWERS: ${section.readerQuestion}`,
    `Place this phrase naturally, once: "${section.keyword}"`,
    `300-400 words. Start with "## ${section.h2}" then the prose. Short paragraphs (2-4 sentences). No filler, no "in today's fast-paced world" openings. Use only facts present in the context above — never invent a statistic, price, award, client name or date.`,
    `Output markdown only — no preamble, no explanation.`,
  ].filter(Boolean).join("\n\n");

  const text = await complete(prompt, { maxTokens: 700, label: "writer.section" });
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

  const prompt = [
    `Polish this article draft on "${topic}". Do not shorten it or remove any section — every H2 below must still be present, in the same order.`,
    contextLines(context),
    `WHAT TO FIX:`,
    `1. Write or rewrite the opening (before the first ##) so it answers the primary topic in the first 100 words — no throat-clearing.`,
    `2. Smooth the transition between each pair of sections — right now they were written independently and may jump.`,
    `3. Remove repeated phrases and any AI-cliché wording (delve, tapestry, in today's fast-paced world, game-changer, unlock, unleash, and similar).`,
    `4. End with one concrete next step the reader can take.`,
    `5. Do NOT add facts that are not already in the draft or the context above.`,
    ``,
    `DRAFT:`,
    draft,
    ``,
    `Output the complete polished article as markdown, starting with "# ${outline.title}" — no preamble, no explanation.`,
  ].join("\n\n");

  const text = await complete(prompt, { maxTokens: 4096, label: "writer.polish" });
  return text.trim();
}

/* ---------------------------------------------------------------- 4 · meta --------------- */

export async function writeMeta(outline: Outline, topic: string, body: string, complete: Completer): Promise<WriterMeta> {
  const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 1500);

  const prompt = [
    `Write the SEO metadata for this article. Title: "${outline.title}". Primary keyword: "${topic}".`,
    `EXCERPT (for grounding — do not copy verbatim):\n${excerpt}`,
    `metaTitle: 50-60 characters, includes the primary keyword, different wording from the article title if the title is already the right length.`,
    `metaDescription: 140-160 characters, a real reason to click, includes the primary keyword once.`,
    `slug: lowercase, hyphenated, no stopwords beyond what reads naturally, derived from the title.`,
    `jsonLd: a single-line, valid Article schema.org JSON-LD string (as a JSON string value, escaped) with headline, description and articleBody fields — articleBody may be truncated to a summary, it does not need the full text.`,
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
    jsonLd: String(parsed.jsonLd ?? "").trim(),
  };
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
  // plan's "parallel" against its "previous section's last 2 lines".
  const texts = await Promise.all(outline.sections.map((s) => writeSection(topic, outline, s, context, complete)));
  const sections: PipelineSection[] = outline.sections.map((s, i) => ({
    h2: s.h2,
    text: texts[i],
    words: texts[i].trim().split(/\s+/).filter(Boolean).length,
  }));
  for (const section of sections) opts.onSection?.(section);

  const polished = await polishArticle(outline, topic, sections, context, complete);
  const meta = await writeMeta(outline, topic, polished, complete);

  return { title: outline.title, body: polished, sections, meta };
}
