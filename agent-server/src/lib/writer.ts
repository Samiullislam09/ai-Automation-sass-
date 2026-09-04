/** What every article is grounded in, and the rules every article is held to.
 *
 *  The generation itself moved to writerPipeline.ts (MASTER_PLAN §16.3 Upgrade E — outline,
 *  parallel sections, polish, meta) — this file used to also hold the one-shot NVIDIA call
 *  that pipeline replaced (`writeArticle`/`writeWithNvidia`), which is why anything reading
 *  git history will see it here. It is gone, not renamed: agents/writer.ts calls
 *  `writeArticlePipeline` directly now, and nothing else in the codebase called the one-shot
 *  version, so there was nothing left for it to be a fallback for.
 */

/** Everything we actually know about the business, read from its own row + crawled pages
 *  (see agents/writer.ts). Without this the writer produced generic small-business filler
 *  that could have been about anyone — the single biggest quality problem in the pipeline. */
export type WriterContext = {
  businessName?: string | null;
  websiteUrl?: string | null;
  niche?: string | null;
  audience?: string | null;
  tone?: string | null;
  /** Real crawled pages, used for internal links — never invented URLs. Ordered by
   *  agents/writer.ts so pages in the SAME topic cluster as this article come first (§25.3):
   *  the model links what it reads first, and a sibling page is a better link than a
   *  same-site stranger. */
  pages?: { title: string; url: string }[];
  /** Pre-rendered block of measured Search Console / GA4 facts about this site
   *  (agent-server/src/lib/insights.ts). Empty string when Google isn't connected. */
  searchEvidence?: string;
  /** Pre-rendered Site Brain (lib/siteProfile.ts profileBlock) — what this business does,
   *  what it sells with real URLs, the proof it may state and nothing else, its voice and its
   *  service area (§25.3). Empty string when the analyst has not run. */
  siteBrain?: string;
  /** The thing this article should send the reader to, taken from the offerings that match
   *  its keyword. Replaces the generic "contact us" the writer used to invent. */
  cta?: { name: string; url: string | null } | null;
  /** Real proof this business has on file (Site Brain's own claims, never invented), each with
   *  a URL when one exists — a case study, a certification page, a client result. Only entries
   *  WITH a url are carried here (one with none has nothing to link). This is what lets an
   *  article satisfy lib/seoChecks.ts's "Proof cited" E-E-A-T check on its own, instead of that
   *  check only ever reporting it missing (2026-09-04). */
  proof?: { claim: string; url: string }[];
  /** The crawled About/Contact-style page — same detection lib/seoChecks.ts's "About/Contact
   *  linked" E-E-A-T check uses, so the writer and the check can never disagree on which page
   *  counts. A real Trustworthiness signal per Google's own guidelines; this is what lets an
   *  article link to it on its own instead of the check only ever reporting it absent. */
  trustPage?: { title: string; url: string } | null;
};

/** The rules every article is held to. Written down here (and checked afterwards by
 *  lib/qualityGate.ts) rather than living in someone's head, so "how does it guarantee a good
 *  article?" has an actual answer — and so the UI can show the same list to the user.
 *
 *  writerPipeline.ts's four calls each restate the ONE OR TWO rules relevant to that call
 *  (a section prompt does not need "1200-1800 words" — that is the whole article's job, not
 *  one section's) rather than pasting all nine into every prompt; this array stays the single
 *  place a human reads the whole list, and what qualityGate.ts and seoChecks.ts's comments
 *  point back to. */
export const WRITING_RULES = [
  "Answer the primary keyword in the first 100 words — no throat-clearing intro.",
  "One ## section per related query in the blueprint, in descending search volume order.",
  "Write for the business's stated audience, in its stated tone.",
  "Use only facts present in the business context or in the blueprint. Never invent statistics, prices, awards, client names or dates.",
  "Link to the business's own crawled pages where genuinely relevant, using their real URLs.",
  "Never print a Search Console impression, click, position or session count in the article — that data shapes what you write, it is not content for the reader.",
  "Short paragraphs (2-4 sentences), no filler, no 'in today's fast-paced world' openings.",
  "End with one concrete next step the reader can take.",
  "1200-1800 words, starting with a single '# Title' line.",
];
