/** Deciding WHAT each image should show, and refusing to let that decision be random
 *  (MASTER_PLAN §19.4.2, §19.4.3).
 *
 *  The owner's instruction, twice, in his own words: images must match the paragraph they sit
 *  with ("jis chiz ke upar article/paragraph hai usi pe image ho"), and nothing may be random.
 *  A model asked "describe a picture for this article" will happily answer for an article it
 *  only skimmed, so its answer is not trusted here — it is CHECKED, by code, against the
 *  article's own text. Three gates below, all deterministic, all tested from fixtures.
 *
 *  AND ONE HONEST LIMIT, which is why `card` exists.
 *  Asked (2026-09-05) whether a section explaining "what the USA map looks like" would get a
 *  map: no. FLUX is a diffusion model. It draws something map-SHAPED with the wrong coastline,
 *  cities in the wrong places and letters that are not letters. That is a made-up fact wearing
 *  a picture, which is the one thing this codebase does not ship. So a section that explains
 *  something FACTUAL — a map, a chart, numbers, numbered steps — does not go to the image model
 *  at all: it gets a `card`, drawn by code (lib/media/render.ts) out of that section's OWN
 *  words and numbers. Always true, always readable, and it costs nothing.
 */

import { completeJson } from "../llm.js";
import type { SiteProfile } from "../siteProfile.js";

/* ---------------------------------------------------------------- shapes ---------------- */

/** What kind of picture a slot gets. `photo`/`illustration` go to the image model; `card` is
 *  drawn by us and never touches a provider. */
export type VisualKind = "photo" | "illustration" | "card";

/** A card is only ever built from text the section already contains. */
export type CardKind = "steps" | "stats" | "keypoint";

export type ImageSlot = {
  /** 'thumb' | 'hero' | 'inline_1..3' */
  slot: string;
  kind: VisualKind;
  /** The article heading this image belongs to. null for thumb/hero, which belong to the
   *  article as a whole. Never invented: gate 1 checks it against the real headings. */
  anchor: string | null;
  /** What the section actually explains, in the model's words — the thing gate 2 verifies. */
  depicts: string;
  /** The visual, in the model's words. Only ever used as one ingredient of the final prompt. */
  subject: string;
  alt: string;
  /** For kind === "card": what to draw, and the section's own text/numbers to draw it from. */
  card?: { type: CardKind; lines: string[] };
  /** Why this slot ended up as it did — kept so the Approvals card can explain itself and so
   *  a fallback is visible rather than silent. */
  note?: string;
};

export type ImagePlan = {
  style: "photo" | "illustration";
  slots: ImageSlot[];
};

export type ArticleSection = { heading: string; text: string };

export type ArticleForImages = {
  id: string;
  title: string;
  intro: string;
  sections: ArticleSection[];
  wordCount: number;
};

/* ---------------------------------------------------------------- the ladder ------------ */

/** §19.4.2: every article gets at least two images, and longer articles get more. Returns how
 *  many INLINE slots to attempt — thumb and hero are always there. */
export function inlineCount(wordCount: number, sections: number): number {
  const byLength = wordCount >= 2700 ? 3 : wordCount >= 1800 ? 2 : wordCount >= 900 ? 1 : 0;
  // An image belongs to a section, so there can never be more inline images than sections.
  return Math.max(0, Math.min(byLength, sections));
}

/* ---------------------------------------------------------------- gate 3: what kind ----- */

/** Words that mean "this passage is explaining a fact with a shape" — a map, a chart, a table.
 *  A diffusion model cannot draw any of these truthfully. */
const FACTUAL_VISUAL = /\b(map|maps|atlas|chart|charts|graph|graphs|table|tables|diagram|diagrams|timeline|flowchart|infographic|schematic|blueprint|floor ?plan|org ?chart)\b/i;
/** A numbered or bulleted procedure. */
const STEP_LINE = /^\s*(?:\d+[.)]\s+|[-*•]\s+)/;
/** A percentage, a currency figure, or a plain number with a unit — the stuff of a stat card. */
const FIGURE = /(\d+(?:\.\d+)?\s?%|[$£€₹]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:kg|km|m²|sqft|sq ft|years?|months?|days?|hours?|minutes?|x)\b)/gi;

/** Lines of a section that look like steps, in order, cleaned of their bullet. */
export function stepLines(text: string): string[] {
  return text
    .split(/\n+/)
    .filter((l) => STEP_LINE.test(l))
    .map((l) => l.replace(STEP_LINE, "").trim())
    .filter(Boolean);
}

/** Figures found in a section, with the few words around each — "38% of roofs", not "38%". */
export function figureLines(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const at = m.index ?? 0;
    // The label is the words right after the figure, and it STOPS at the next figure — a stat
    // card row must read "38% of the leaks", never "2 hours and costs $450 for a small".
    const after = text.slice(at + m[0].length, at + m[0].length + 48).replace(/\s+/g, " ").trim();
    const untilNextFigure = after.split(/(?=[$£€₹]\s?\d)|(?=\b\d)/)[0];
    const label = untilNextFigure.split(/[.;!?]/)[0].split(" ").slice(0, 6).join(" ").replace(/\s+(and|or|but|with|for|of|in|to)$/i, "").trim();
    out.push(label ? `${m[0].trim()} ${label}` : m[0].trim());
    if (out.length >= 4) break;
  }
  return out;
}

/** GATE 3 — the kind of visual comes from what the section IS, not from what a model prefers.
 *  Returns a card (with the section's own lines) or null to mean "a picture is fine here". */
export function cardFor(section: ArticleSection): { type: CardKind; lines: string[]; why: string } | null {
  const haystack = `${section.heading}\n${section.text}`;
  const steps = stepLines(section.text);
  if (steps.length >= 3) {
    return { type: "steps", lines: steps.slice(0, 5), why: "the section is a numbered procedure — a drawn picture of steps would be decoration, this is the steps" };
  }
  const figures = figureLines(section.text);
  if (figures.length >= 2) {
    return { type: "stats", lines: figures, why: "the section turns on figures — these are the section's own, not an illustration of numbers" };
  }
  if (FACTUAL_VISUAL.test(haystack)) {
    return {
      type: "keypoint",
      lines: [firstSentence(section.text) || section.heading],
      why: "the section explains something with a real shape (a map, a chart, a diagram) — an image model would draw a convincing wrong one, so this states the point instead",
    };
  }
  return null;
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  return (end === -1 ? clean : clean.slice(0, end + 1)).slice(0, 180);
}

/* ---------------------------------------------------------------- gates 1 and 2 --------- */

const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those of in on at to for with from by as is are was were be been being it its it's about into over under how what why when where which who whom your you our we they them their he she his her not no do does did can could should would will shall may might must have has had".split(
    " ",
  )),
);

/** Content words, lower-cased, stemmed just enough that "roofs" matches "roof". */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    const w = raw.replace(/['’]s$/, "");
    if (STOPWORDS.has(w)) continue;
    out.add(w);
    if (w.endsWith("ies") && w.length > 4) out.add(w.slice(0, -3) + "y");
    else if (w.endsWith("es") && w.length > 4) out.add(w.slice(0, -2));
    else if (w.endsWith("s") && w.length > 3) out.add(w.slice(0, -1));
  }
  return out;
}

/** GATE 2 — does this brief actually describe THAT section? At least one content word shared.
 *  This is what a "generic stock photo" answer fails: a model that wrote "a modern office" for
 *  a section about gutter guards shares nothing with it. */
export function describesSection(depicts: string, subject: string, section: ArticleSection): boolean {
  const theirs = contentWords(`${depicts} ${subject}`);
  const ours = contentWords(`${section.heading} ${section.text}`);
  for (const w of theirs) if (ours.has(w)) return true;
  return false;
}

/* ---------------------------------------------------------------- the prompt ------------ */

const STYLE_PHRASE: Record<"photo" | "illustration", string> = {
  photo: "editorial photograph, realistic, natural light, shallow depth of field",
  illustration: "clean flat vector illustration, simple shapes, generous whitespace",
};

/** Never negotiable, and the reason is in each clause: no text (a diffusion model writes
 *  gibberish), no logos or signage (someone else's brand), no people (a real-looking face
 *  nobody consented to). */
const NEGATIVE = "no text, no words, no letters, no numbers, no watermark, no logo, no signage, no people, no faces";

/** The final prompt. The model contributes `subject` and nothing else — the rest is assembled
 *  here, identically every time, from the site's own profile. */
export function buildPrompt(subject: string, style: "photo" | "illustration", profile: SiteProfile | null): string {
  const setting: string[] = [];
  const industry = (profile?.what_they_do ?? "").split(/[.,;]/)[0].trim();
  if (industry) setting.push(`context: ${industry.slice(0, 90)}`);
  if (profile?.geo) setting.push(`set in ${String(profile.geo).slice(0, 40)}`);
  return [subject.trim().slice(0, 220), STYLE_PHRASE[style], ...setting, NEGATIVE].filter(Boolean).join(", ");
}

/** Same article + same slot = same picture, for ever (§19.4.3). `bump` is the user's own
 *  "another image" button, and the only thing that ever changes it. */
export function seedFor(articleId: string, slot: string, bump = 0): number {
  let h = 2166136261;
  for (const ch of `${articleId}:${slot}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2_000_000_000) + bump;
}

/* ---------------------------------------------------------------- the plan -------------- */

type InlineBrief = { anchor?: string; depicts?: string; subject?: string; alt?: string };

type ModelReply = {
  style?: string;
  thumb?: { depicts?: string; subject?: string; alt?: string };
  hero?: { depicts?: string; subject?: string; alt?: string };
  inline?: InlineBrief[];
};

function prompt(article: ArticleForImages, profile: SiteProfile | null, wantInline: number): string {
  const sections = article.sections
    .slice(0, 12)
    .map((s, i) => `${i + 1}. ${s.heading}\n${s.text.replace(/\s+/g, " ").trim().slice(0, 400)}`)
    .join("\n\n");
  return [
    "You are choosing pictures for a blog article. You do NOT write the article.",
    "",
    `TITLE: ${article.title}`,
    `INTRO: ${article.intro.replace(/\s+/g, " ").trim().slice(0, 500)}`,
    "",
    "SECTIONS:",
    sections || "(none)",
    "",
    profile?.what_they_do ? `THE BUSINESS: ${profile.what_they_do}` : "",
    profile?.geo ? `WHERE: ${profile.geo}` : "",
    "",
    "Rules:",
    '- "style": "photo" for businesses whose customers expect real places (restaurant, clinic, property, trades); "illustration" for software and services.',
    "- thumb and hero are about the WHOLE article, and must show two different things — not the same scene twice.",
    `- inline: exactly ${wantInline} entr${wantInline === 1 ? "y" : "ies"}, each for ONE of the sections above. "anchor" must be that section's heading, copied exactly.`,
    '- "depicts": what that section actually explains, in your own words, using the section\'s own vocabulary.',
    '- "subject": the picture, as a scene. A camera could photograph it. No text, no logos, no people.',
    '- "alt": one sentence describing the picture for someone who cannot see it.',
    "",
    'Reply with ONLY JSON: {"style":"photo","thumb":{"depicts":"","subject":"","alt":""},"hero":{"depicts":"","subject":"","alt":""},"inline":[{"anchor":"","depicts":"","subject":"","alt":""}]}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Builds the image plan for one article: ask once, then check every answer against the
 *  article itself. `complete` is injectable so the gates can be tested without a model. */
export async function planImages(
  article: ArticleForImages,
  profile: SiteProfile | null,
  opts: { complete?: <T>(p: string) => Promise<T> } = {},
): Promise<ImagePlan> {
  const complete = opts.complete ?? completeJson;
  const wantInline = inlineCount(article.wordCount, article.sections.length);

  let reply: ModelReply = {};
  try {
    reply = await complete<ModelReply>(prompt(article, profile, wantInline));
  } catch (e: any) {
    // A model that will not answer must not cost the article its images — every slot falls
    // back to something built from the article's own text.
    console.warn(`[image.plan] the brief call failed, falling back to the article's own words: ${e?.message ?? e}`);
  }

  const style: "photo" | "illustration" = reply?.style === "illustration" ? "illustration" : "photo";
  const slots: ImageSlot[] = [];

  // ── thumb and hero: about the article as a whole ─────────────────────────────────────
  const whole: ArticleSection = { heading: article.title, text: `${article.intro} ${article.sections.map((s) => s.heading).join(". ")}` };
  for (const [slot, given] of [["thumb", reply?.thumb], ["hero", reply?.hero]] as const) {
    const depicts = String(given?.depicts ?? "").trim();
    const subject = String(given?.subject ?? "").trim();
    const ok = subject && describesSection(depicts || subject, subject, whole);
    slots.push({
      slot,
      kind: style,
      anchor: null,
      depicts: ok ? depicts || subject : article.title,
      subject: ok ? subject : `${article.title} — the subject of the article, as a scene`,
      alt: String(given?.alt ?? "").trim() || article.title,
      note: ok ? undefined : "the brief did not describe this article, so the title is the subject",
    });
  }

  // ── inline: one per section, in the article's own order ──────────────────────────────
  const byHeading = new Map(article.sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  const used = new Set<string>();
  const given = Array.isArray(reply?.inline) ? reply.inline : [];

  // GATE 1 — an anchor must be a heading this article really has. A made-up one is dropped,
  // never rendered, and the slot falls to the next unused section instead.
  const resolved: { section: ArticleSection; from: InlineBrief | undefined }[] = [];
  for (const entry of given) {
    const key = String(entry?.anchor ?? "").trim().toLowerCase();
    const section = byHeading.get(key);
    if (!section || used.has(key)) continue;
    used.add(key);
    resolved.push({ section, from: entry });
  }
  // Longest sections first for anything the model did not (or could not) anchor.
  const spare = article.sections
    .filter((s) => !used.has(s.heading.trim().toLowerCase()))
    .sort((a, b) => b.text.length - a.text.length);

  for (let i = 0; i < wantInline; i++) {
    const picked = resolved[i] ?? (spare.length ? { section: spare.shift()!, from: undefined } : null);
    if (!picked) break;
    const section = picked.section;
    const slot = `inline_${i + 1}`;

    // GATE 3 first: a factual section never goes to the image model at all.
    const card = cardFor(section);
    if (card) {
      slots.push({
        slot,
        kind: "card",
        anchor: section.heading,
        depicts: firstSentence(section.text) || section.heading,
        subject: "",
        alt: `${section.heading} — ${card.type === "steps" ? "the steps" : card.type === "stats" ? "the figures" : "the key point"} from this section`,
        card: { type: card.type, lines: card.lines },
        note: card.why,
      });
      continue;
    }

    const depicts = String(picked.from?.depicts ?? "").trim();
    const subject = String(picked.from?.subject ?? "").trim();
    // GATE 2: does the brief actually describe THIS section?
    if (subject && describesSection(depicts || subject, subject, section)) {
      slots.push({
        slot,
        kind: style,
        anchor: section.heading,
        depicts,
        subject,
        alt: String(picked.from?.alt ?? "").trim() || `${section.heading} — illustration`,
      });
      continue;
    }

    // The brief was generic (or missing) for this section. Rather than render something
    // unrelated, state the section's own point on a card.
    slots.push({
      slot,
      kind: "card",
      anchor: section.heading,
      depicts: firstSentence(section.text) || section.heading,
      subject: "",
      alt: `${section.heading} — the key point from this section`,
      card: { type: "keypoint", lines: [firstSentence(section.text) || section.heading] },
      note: subject
        ? "the brief for this section did not share a single word with it, so it was not used"
        : "no brief came back for this section",
    });
  }

  return { style, slots };
}
