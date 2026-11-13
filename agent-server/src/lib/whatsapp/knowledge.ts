/** What the assistant knows from the business's own website, at the moment a customer asks.
 *
 *  Until now a WhatsApp reply was written from three lines of Site Brain. The pages the crawler had
 *  already read and embedded — service details, process, timelines, requirements — were never
 *  consulted, so "give me some information about ISO" got a generic sentence while the site had whole
 *  pages on it (client chat, 2026-11-13).
 *
 *  TWO STAGES, and neither needs anything new in the database beyond migration 042:
 *   1. PAGE: embed the customer's question (≈0.4 s measured, 0.27–0.76 s over ten calls) and ask
 *      Postgres for the nearest three pages (match_site_pages). No text travels yet.
 *   2. PASSAGE: read the text of those pages (cached), cut it into paragraphs, and keep the few that
 *      share the most words with the question. Choosing paragraphs by overlap rather than by vector
 *      is deliberate: only the first ~1800 characters of a page are embedded, so a paragraph further
 *      down — exactly where the price list or the process steps live — has no vector of its own.
 *
 *  EVERYTHING HERE FAILS OPEN. Retrieval is an enhancement to a reply, never a gate on it: a timeout,
 *  a missing function (migration not applied yet), an empty table all return [] and the reply carries
 *  on from the business brief exactly as before. A customer is never kept waiting on the knowledge
 *  lookup — it has its own short deadline.
 *
 *  Pure parts (queryFor, shouldRetrieve, splitPassages, pickPassages) are separate and unit-tested;
 *  retrieveKnowledge is the only part that touches the network. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed } from "../embeddings.js";
import type { Msg } from "./conversation.js";

export type Passage = { url: string; title: string; text: string; score: number };

/** The whole lookup — embedding, RPC, page text — must fit in this, or the reply goes without it. */
export const KNOWLEDGE_DEADLINE_MS = 4_000;
const EMBED_TIMEOUT_MS = 3_000;
const PAGES = 3;
const MAX_PASSAGES = 4;
const MAX_CHARS = 1_800;
const PASSAGE_MAX = 600;
const PASSAGE_MIN = 40;
/** A passage is closed once it reaches this size. */
const PASSAGE_FLUSH = 120;
/** Share (by weight) of the question's content words a passage must contain to be shown. */
const MIN_COVERAGE = 0.3;
/** A page whose OPENING embeds at least this close to the question counts as about the right thing
 *  even if no paragraph shares a word with it (a Hinglish question over an English site). A first
 *  guess for nemotron-3-embed-1b: it is calibrated against real pages once migration 042 is applied
 *  (knowledge.live.ts prints the similarities), not argued from here. */
const SEMANTIC_MIN = 0.45;

/* ── what to look up ─────────────────────────────────────────────────────────────────────── */

const ACK = /^\s*(ok|okay|k|kk|thanks|thank you|thx|ty|hmm+|hm+|yes|yeah|yep|no|nope|haan|han|ji|theek hai|thik hai|accha|acha|sure|fine|cool|great|done|👍|🙏)[\s.!?]*$/i;

const STOP = new Set((
  "the a an and or but if then than that this these those with without for from into onto over under about after before of to in on at by is are was were be been being do does did have has had will would can could should may might " +
  "you your yours we our ours they them their it its i me my mine he she his her what which who whom when where why how any some all also just very more most much many such not no yes please tell give send want need like know get got let " +
  "hai hain tha thi hota hoti hote hoga hogi kya kaise kab kitna kitne kyun kahan aap aapka aapki tum hum mujhe mera meri liye karo kar karna batao bata bhi aur toh se ko ka ki ke mein par pe wala wali iska iski iske uska uski uske isme usme yeh woh"
).split(/\s+/));

export function queryTerms(q: string): string[] {
  const seen = new Set<string>();
  for (const w of String(q).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9ऀ-ॿ\s-]/g, " ").split(/\s+/)) {
    const t = w.replace(/^-+|-+$/g, "");
    if (t.length >= 3 && !STOP.has(t)) seen.add(t);
  }
  return [...seen];
}

/** Whether this customer message deserves a lookup at all. A bare "ok", a greeting or a placeholder
 *  does not — it would cost an embedding for nothing. */
export function shouldRetrieve(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 8 || t.startsWith("[") || ACK.test(t)) return false;
  const terms = queryTerms(t).length;
  // A question mark, two content words, or one content word in a real sentence ("iska process kya hai").
  return t.includes("?") || terms >= 2 || (terms >= 1 && t.split(/\s+/).length >= 3);
}

/** The text to search with: the customer's latest message — and, when that is only a few words
 *  ("and the timeline?"), the message before it, which carries the topic. */
export function queryFor(thread: Msg[]): string {
  const inbound = thread.filter((m) => m.direction === "in").map((m) => String(m.body ?? "").trim()).filter((b) => b && !b.startsWith("["));
  const last = inbound[inbound.length - 1] ?? "";
  if (last.length >= 25 || inbound.length < 2) return last;
  return `${inbound[inbound.length - 2]} ${last}`.trim();
}

/* ── cutting a page into passages and choosing among them ────────────────────────────────── */

/** Paragraph-sized pieces of a page: split on blank lines and line breaks, short lines (headings,
 *  list items) merged forward until they reach a useful size, long ones cut at a sentence. */
export function splitPassages(content: string): string[] {
  const lines = String(content ?? "").replace(/\r/g, "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  const flush = () => { if (buf.length >= PASSAGE_MIN) out.push(buf); buf = ""; };
  for (const line of lines) {
    if (line.length > PASSAGE_MAX) {
      flush();
      let rest = line;
      while (rest.length > PASSAGE_MAX) {
        let cut = rest.lastIndexOf(". ", PASSAGE_MAX);
        if (cut < PASSAGE_MAX / 2) cut = rest.lastIndexOf(" ", PASSAGE_MAX);
        if (cut < 1) cut = PASSAGE_MAX;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
      }
      if (rest.length >= PASSAGE_MIN) out.push(rest);
      continue;
    }
    // A short line with no full stop is a heading: it starts a new passage and stays attached to the
    // paragraph it introduces (so "How long does it take?" travels with its answer).
    const heading = line.length < 70 && !/[.!]$/.test(line);
    if (heading) { flush(); buf = line; continue; }
    buf = buf ? `${buf} ${line}` : line;
    // Close a passage as soon as it is a paragraph, so an unrelated line after it (a call to action)
    // does not get glued on and shown as if it answered the question.
    if (buf.length >= PASSAGE_FLUSH) flush();
  }
  flush();
  return out;
}

/** How much of the question's meaning is in the passage (0..1). Words are weighted by how rare they
 *  are among the candidate passages: in a site about ISO, "iso" is in nearly every paragraph and says
 *  nothing about WHICH paragraph answers, while "27001" in none is what the question is really about —
 *  an unweighted count made "do you certify ISO 27001 in Saudi?" match every ISO 14001 paragraph on
 *  the single word "iso". A small bonus when the hits are dense: a paragraph about the thing beats a
 *  long one that mentions it once. */
export function lexicalScore(passage: string, terms: string[], weights?: Map<string, number>): number {
  if (!terms.length) return 0;
  const p = passage.toLowerCase();
  let hits = 0, hitW = 0, totalW = 0;
  for (const t of terms) {
    const w = weights?.get(t) ?? 1;
    totalW += w;
    if (p.includes(t)) { hits++; hitW += w; }
  }
  if (!hits || totalW <= 0) return 0;
  const coverage = hitW / totalW;
  const density = Math.min(1, (hits * 40) / Math.max(40, p.length / 4));
  return coverage * 0.8 + density * 0.2;
}

/** Distinct question words present in the passage. */
function hitCount(passage: string, terms: string[]): number {
  const p = passage.toLowerCase();
  return terms.filter((t) => p.includes(t)).length;
}

/** idf-style weights over the candidate passages: ln(1 + N / (1 + df)). A word in none of them gets
 *  the highest weight, so it still counts in the denominator when it is missing. */
function termWeights(terms: string[], passages: string[]): Map<string, number> {
  const N = Math.max(1, passages.length);
  const lower = passages.map((p) => p.toLowerCase());
  const w = new Map<string, number>();
  for (const t of terms) {
    const df = lower.filter((p) => p.includes(t)).length;
    w.set(t, Math.log(1 + N / (1 + df)));
  }
  return w;
}

export type PageHit = { url: string; title: string; similarity: number; text: string };

/** Choose the passages to show the model from the pages the vector search found. Lexical overlap
 *  decides WITHIN and across pages; the page's own similarity breaks ties and rescues the case
 *  where nothing overlaps but the page is clearly about the right thing. */
export function pickPassages(pages: PageHit[], question: string, opts: { maxChars?: number; maxPassages?: number } = {}): Passage[] {
  const maxChars = opts.maxChars ?? MAX_CHARS;
  const maxPassages = opts.maxPassages ?? MAX_PASSAGES;
  const terms = queryTerms(question);
  const split = pages.map((p) => splitPassages(p.text));
  const weights = termWeights(terms, split.flat());
  const scored: Passage[] = [];

  pages.forEach((page, pi) => {
    const ps = split[pi];
    // The words in the page's own TITLE are what the whole page is about, so every paragraph on it
    // shares them and they cannot tell the paragraph that answers from the one that introduces. On
    // the "ISO 14001" page, "How long does ISO 14001 take?" is decided by "long" and "take", not by
    // "iso" and "14001" (without this the page's opening line outranked the timeline). When the title
    // accounts for every word of the question, fall back to all of them.
    const title = page.title.toLowerCase();
    const rest = terms.filter((t) => !title.includes(t));
    const eff = rest.length ? rest : terms;
    // One content word is too thin to call a paragraph relevant ("process" appears on every service
    // page); with a single word the page itself must also be semantically close.
    const minHits = eff.length >= 2 ? 2 : 1;
    let any = false;
    ps.forEach((text, i) => {
      if (hitCount(text, eff) < minHits) return;
      if (eff.length < 2 && page.similarity < SEMANTIC_MIN) return;
      const lex = lexicalScore(text, eff, weights);
      if (lex < MIN_COVERAGE * 0.8) return;
      any = true;
      // Earlier paragraphs are usually the summary: a whisper of preference, not a rule.
      const score = lex * 0.75 + page.similarity * 0.25 - i * 0.002;
      scored.push({ url: page.url, title: page.title, text, score });
    });
    // Nothing on the page shares enough words with the question (a Hinglish question, an English
    // site), but the page itself is what the vector search says it is about: take its opening.
    if (!any && page.similarity >= SEMANTIC_MIN) {
      ps.slice(0, 2).forEach((text, i) => scored.push({ url: page.url, title: page.title, text, score: page.similarity * 0.5 - i * 0.01 }));
    }
  });

  scored.sort((a, b) => b.score - a.score);
  const out: Passage[] = [];
  let used = 0;
  for (const p of scored) {
    if (out.length >= maxPassages) break;
    if (used + p.text.length > maxChars) continue;
    if (out.some((o) => o.text === p.text)) continue;
    out.push(p);
    used += p.text.length;
  }
  return out;
}

/** How the passages are shown to the model. */
export function renderKnowledge(passages: Passage[]): string {
  return passages.map((p) => `- (${p.url.replace(/^https?:\/\//, "")}) ${p.text}`).join("\n");
}

/* ── the network part ────────────────────────────────────────────────────────────────────── */

/** Page text, cached: the same few service pages answer most questions, and re-reading a 6 KB page
 *  for every customer message is exactly the egress pattern that got this project restricted. */
const TEXT_TTL_MS = 10 * 60_000;
const TEXT_MAX = 300;
const textCache = new Map<string, { at: number; text: string }>();

async function pageTexts(supabase: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = textCache.get(id);
    if (hit && now - hit.at < TEXT_TTL_MS) out.set(id, hit.text); else missing.push(id);
  }
  if (missing.length) {
    const { data } = await supabase.from("site_pages").select("id, content_text").eq("tenant_id", tenantId).in("id", missing);
    for (const r of (data ?? []) as { id: string; content_text: string | null }[]) {
      // 12 KB is far more than the ~1.8 KB of passages that will be used; it bounds the memory.
      const text = String(r.content_text ?? "").slice(0, 12_000);
      out.set(r.id, text);
      if (textCache.size >= TEXT_MAX) { const first = textCache.keys().next().value; if (first) textCache.delete(first); }
      textCache.set(r.id, { at: now, text });
    }
  }
  return out;
}

let warnedMissingFn = false;

/** The passages from this tenant's site that bear on `question`, or [] — never throws, never waits
 *  longer than KNOWLEDGE_DEADLINE_MS. */
export async function retrieveKnowledge(supabase: SupabaseClient, tenantId: string, question: string): Promise<Passage[]> {
  if (!shouldRetrieve(question)) return [];
  const work = async (): Promise<Passage[]> => {
    const vec = await embed(question, { lane: "wa", timeoutMs: EMBED_TIMEOUT_MS, retries: 0 });
    const { data, error } = await supabase.rpc("match_site_pages", {
      p_tenant: tenantId,
      // pgvector's text literal — PostgREST cannot type a vector argument (migration 026).
      p_query: `[${vec.map((x) => x.toFixed(5)).join(",")}]`,
      p_k: PAGES,
    });
    if (error) {
      if (!warnedMissingFn) { warnedMissingFn = true; console.warn(`[whatsapp] website lookup unavailable (apply migration 042?): ${error.message}`); }
      return [];
    }
    const rows = (data ?? []) as { id: string; url: string; title: string | null; similarity: number }[];
    if (!rows.length) return [];
    const texts = await pageTexts(supabase, tenantId, rows.map((r) => r.id));
    return pickPassages(rows.map((r) => ({ url: r.url, title: r.title ?? "", similarity: Number(r.similarity) || 0, text: texts.get(r.id) ?? "" })), question);
  };
  try {
    return await Promise.race([
      work(),
      new Promise<Passage[]>((resolve) => setTimeout(() => resolve([]), KNOWLEDGE_DEADLINE_MS)),
    ]);
  } catch (e: any) {
    console.warn(`[whatsapp] website lookup failed, answering without it: ${e?.message}`);
    return [];
  }
}
