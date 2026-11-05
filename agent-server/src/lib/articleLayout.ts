/** Deterministic readability pass: no wall-of-text paragraphs.
 *
 *  A model that writes a 27-sentence paragraph cannot be rewritten into shape by another model
 *  call reliably, so the layout is fixed in code: any prose paragraph longer than
 *  MAX_SENTENCES is split at sentence boundaries into short paragraphs. Headings, lists,
 *  tables, images, quotes and code are never touched, and no word is added, removed or reordered.
 *  The first paragraph under an H2 is the featured-snippet answer, so it is capped to fit the
 *  40-58 word window. */

const MAX_SENTENCES = 3;
const MAX_WORDS = 70;
const SNIPPET_MAX_WORDS = 58;

const ABBREV = /\b(?:e\.g|i\.e|etc|vs|inc|ltd|co|no|dr|mr|mrs|ms|approx|fig|st)\.$/i;

function sentencesOf(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z0-9])/);
  const out: string[] = [];
  for (const part of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += " " + part;
    else out.push(part);
  }
  return out.filter(Boolean);
}

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

const isProse = (block: string) => !/^(\s*)(#{1,6}\s|[-*+•]\s|\d+[.)]\s|>|\||```|!\[|<|\[!)/.test(block) && !block.includes("\n|");

export function splitLongParagraphs(body: string): string {
  const blocks = body.replace(/\r/g, "").split(/\n{2,}/);
  let afterH2 = false;
  const out: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (/^##\s/.test(trimmed)) {
      afterH2 = true;
      out.push(block);
      continue;
    }
    if (!trimmed || !isProse(trimmed) || trimmed.includes("\n")) {
      if (trimmed && !/^#{1,6}\s/.test(trimmed)) afterH2 = false;
      out.push(block);
      continue;
    }
    const first = afterH2;
    afterH2 = false;
    const sents = sentencesOf(trimmed);
    if (sents.length <= MAX_SENTENCES && wordCount(trimmed) <= MAX_WORDS) {
      out.push(block);
      continue;
    }
    let current: string[] = [];
    let isFirst = first;
    const flush = () => {
      if (current.length) out.push(current.join(" "));
      current = [];
      isFirst = false;
    };
    for (const sent of sents) {
      const limit = isFirst ? SNIPPET_MAX_WORDS : MAX_WORDS;
      const nextWords = wordCount([...current, sent].join(" "));
      if (current.length && (current.length >= MAX_SENTENCES || nextWords > limit)) flush();
      current.push(sent);
    }
    flush();
  }
  return out.join("\n\n");
}
