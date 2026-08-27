/** The content pipeline, written down.
 *
 *  This is the answer to "what rules make sure the article is actually good for MY business?"
 *  — the stages below are the real ones (agent-server/src/agents/*.ts), in the real order, and
 *  the rules are the ones the writer prompt enforces plus the ones lib/qualityGate.ts measures
 *  afterwards. The UI shows this list so the user can hold the team to it.
 *
 *  NOTE: agent-server/src/lib/writer.ts holds the copy that is actually sent to the model, and
 *  agent-server/src/lib/qualityGate.ts the copy that is actually measured. If you change a rule
 *  there, change it here too — this file is documentation for the user, not the enforcement. */

export type PipelineStage = {
  /** store/office agent id (lib/agents-data.ts), so the UI can highlight the right room. */
  id: string;
  name: string;
  what: string;
  /** What it is grounded in — the honesty column: where the input actually comes from. */
  from: string;
};

export const PIPELINE: PipelineStage[] = [
  {
    id: "boss",
    name: "Mr Lxwa plans",
    what: "Picks the next topics your business should publish, and refuses to invent any if there's nothing to go on.",
    from: "Your niche, the pages the crawler read on your site, and everything already written (so nothing repeats).",
  },
  {
    id: "kw",
    name: "Mr. Keyword validates",
    what: "Checks real monthly search volume and pulls the related questions people actually type, then builds the blueprint.",
    from: "DataForSEO live keyword data. No demand found = the topic is dropped, with the reason logged.",
  },
  {
    id: "writer",
    name: "Mr. Writer drafts",
    what: "Writes the article to the blueprint: one section per related query, your tone, your audience, links to your own pages.",
    from: "The blueprint + your business profile (niche, audience, tone) + your crawled page titles and URLs.",
  },
  {
    id: "qa",
    name: "Mr. QA gates it",
    what: "Measures the draft before you ever see it. A draft that fails is marked failed instead of being quietly shipped.",
    from: "The text itself — word count, section count, links. Nothing is scored by vibes.",
  },
  {
    id: "publish",
    name: "You approve",
    what: "The draft waits in Approvals. Publishing only happens after you say so.",
    from: "Your decision. No agent publishes on its own.",
  },
];

/** The rules Mr. Writer is given, verbatim in spirit (agent-server/src/lib/writer.ts). */
export const WRITING_RULES: string[] = [
  "Answer the main keyword in the first 100 words — no throat-clearing intro.",
  "One ## section per related query from the research, biggest search volume first.",
  "Write for your stated audience, in your stated brand tone.",
  "Use only facts from your business profile or the research — never invented stats, prices, awards or dates.",
  "Link to your own crawled pages where relevant, using their real URLs.",
  "Short paragraphs, no filler openings, one concrete next step at the end.",
  "1200–1800 words with a real H1 title.",
];

/** What the quality gate actually measures (agent-server/src/lib/qualityGate.ts). */
export const QUALITY_GATE: string[] = [
  "600–2,500 words, starting with one title line.",
  "At least 3 sections, and the primary keyword in the title or the first 100 words.",
  "No placeholders, no leaked AI text, no duplicate paragraphs, no more than a few AI clichés.",
  "Link count recorded on the item.",
  "Fails the gate → saved as 'failed' and visible, not silently dropped.",
];
