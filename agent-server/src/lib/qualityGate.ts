/** Real, computed quality checks for a generated article — Build Guide Step 12.
 *  Deliberately only claims what's actually measurable from the text itself (word count,
 *  section headings, links). The old demo UI showed a fake "originality 98%" — dropped
 *  rather than faked; a real plagiarism/originality check is a separate paid API, out of
 *  scope here (add one later if needed, don't invent a number in the meantime). */
export type QualityGate = {
  wordCount: number;
  sections: number;
  links: number;
  passed: boolean;
  reasons: string[];
};

const MIN_WORDS = 600;
const MIN_SECTIONS = 2;

export function gateArticle(body: string): QualityGate {
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const sections = (body.match(/^#{2,3}\s+\S/gm) || []).length;
  const links = (body.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;

  const reasons: string[] = [];
  if (wordCount < MIN_WORDS) reasons.push(`only ${wordCount} words (need ${MIN_WORDS}+)`);
  if (sections < MIN_SECTIONS) reasons.push(`only ${sections} section heading(s) (need ${MIN_SECTIONS}+)`);

  return { wordCount, sections, links, passed: reasons.length === 0, reasons };
}

/** Article body starts with "# Title" per the writer's prompt (lib/writer.ts) — pull that
 *  out as the real title instead of reusing the raw topic string, falling back to the
 *  topic if the model didn't format it as expected. */
export function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}
