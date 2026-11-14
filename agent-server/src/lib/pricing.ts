/** Finding the price on the business's own website — and refusing to invent one.
 *
 *  Why this exists. The Site Brain's `pricing` used to come from ONE question put to a language model about
 *  the first eight "key" pages, 1,400 characters each (agents/analyst.ts). Two problems:
 *   1. The price is often not there. A /pricing page that is not among the eight, or a figure further down a
 *      long page, was simply never read.
 *   2. Nothing checked the answer. The prompt said "EXACTLY as printed", but a model that has been asked for
 *      a price range will sometimes produce a plausible one. A wrong number here is the worst possible
 *      mistake: the WhatsApp assistant quotes it to a customer as the business's own price.
 *
 *  So this module reads EVERY crawled page, deterministically, and only then asks a model — to summarise
 *  amounts that were printed, never to find them. And the model's answer is then CHECKED: every number in
 *  the range it returns must appear in the text of the pages. An answer that fails the check is discarded,
 *  not trusted. No amount on the site means no price, and the assistant says it cannot share one.
 *
 *  Three outcomes, in order of strength:
 *   - a grounded range ("AED 4,000–9,000", "from $29/month")        → pricing.range set
 *   - no figure, but the site says pricing is by quote / on request → model "quote", no range
 *   - nothing                                                         → null
 *
 *  The pure parts (amounts, snippets, grounding, quote phrases) are unit-tested; only `detectPricing` calls
 *  a model, and it takes the call as a parameter so tests never touch the network. */
import type { Pricing } from "./siteProfile.js";

export type PricePage = { url: string; title?: string | null; text: string };
export type PriceFinding = { pricing: Pricing; sources: string[] };

/* ── amounts ─────────────────────────────────────────────────────────────────────────────── */

// A currency CODE counts only as a whole word. Without that, "2 audits" read as "2 AUD" and "users. 3" as
// "Rs. 3" (found against a real site, 2026-11-14). Symbols ($ € £ ₹) need no such guard.
const CODE = String.raw`(?<![A-Za-z])(?:AED|USD|US\$|SAR|QAR|KWD|BHD|OMR|EUR|GBP|INR|PKR|BDT|CAD|AUD|SGD|Rs\.?|Dhs?\.?)(?![A-Za-z])`;
const CUR = String.raw`(?:${CODE}|د\.إ|[$€£₹])`;
// Proper thousands grouping first ("2,400"), so a figure is not fused with the number printed right after it.
// The text of a crawled page has no spaces between elements: "From$2,4008–12 weeks" is $2,400 and then "8–12".
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(?:k|K|million|lakh|lac)(?![A-Za-z]))?`;
const AMOUNT_RE = new RegExp(String.raw`(?:${CUR}\s?${NUM})|(?:${NUM}\s?(?:${CUR}|dirhams?|dollars?|rupees?|riyals?)(?![A-Za-z]))`, "gi");

/** Every currency amount in a text, with where it starts. "AED 4,000", "$29", "4000 AED", "₹ 15,000". A bare
 *  number with no currency is NOT an amount here — "5 users" or the year 2026 are not prices. */
export function findAmounts(text: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  for (const m of String(text ?? "").matchAll(AMOUNT_RE)) out.push({ text: m[0].trim(), index: m.index ?? 0 });
  return out;
}

const PRICE_CONTEXT = /\b(price|prices|pricing|cost|costs|fee|fees|rate|rates|charge|charges|starting|starts|from|only|just|per|each|package|packages|plan|plans|quote|budget|subscription|monthly|annual|yearly|month|year)\b|\/\s?(mo|month|yr|year|hr|hour)\b/i;
const PRICE_URL = /pric|plan|package|fee|cost|rate|tariff|quote|subscri|buy|shop|store|checkout|offer/i;
/** An address that IS a price page ("/pricing", "/plans"), as opposed to an article about prices ("/iso-cost-in-dubai"). */
const PRICE_PATH = /\/(pricing|prices?|plans|packages|rates|fees|tariffs?)(\/|$|\?|#)/i;

/** A page's own likelihood of being a price page, from its address and title alone. */
export function priceUrlScore(p: PricePage): number {
  return (PRICE_URL.test(p.url) ? 2 : 0) + (p.title && PRICE_URL.test(p.title) ? 1 : 0) + (PRICE_PATH.test(p.url) ? 4 : 0);
}

/** The few places on the site where an amount sits next to price-talk, most likely first: each is the amount
 *  with ~200 characters either side. Bounded, because it goes to a model. */
export function collectSnippets(pages: PricePage[], opts: { max?: number; radius?: number } = {}): { url: string; text: string }[] {
  const max = opts.max ?? 12;
  const radius = opts.radius ?? 200;
  const scored: { url: string; text: string; score: number }[] = [];
  for (const page of pages) {
    const text = String(page.text ?? "");
    const base = priceUrlScore(page);
    let taken = 0;
    for (const a of findAmounts(text)) {
      const from = Math.max(0, a.index - radius);
      const win = text.slice(from, a.index + a.text.length + radius).replace(/\s+/g, " ").trim();
      const near = text.slice(Math.max(0, a.index - 90), a.index + a.text.length + 90);
      const ctx = PRICE_CONTEXT.test(near);
      if (!ctx && base === 0) continue;       // a stray amount on an ordinary page, with no price-talk
      scored.push({ url: page.url, text: win, score: base * 2 + (ctx ? 2 : 0) });
      if (++taken >= 3) break;                 // a page contributes at most three, or one long price list drowns the rest
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: { url: string; text: string }[] = [];
  for (const s of scored) {
    const key = s.text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: s.url, text: s.text });
    if (out.length >= max) break;
  }
  return out;
}

/* ── is a figure really on the site? ─────────────────────────────────────────────────────── */

/** "4,000" -> "4000", so a figure matches however the page punctuates it. */
const normalise = (s: string) => String(s ?? "").replace(/(?<=\d),(?=\d{3})/g, "");

/** Numbers of two or more digits in a string. A lone "5" ("5 users") is too common to prove anything. */
function figures(s: string): string[] {
  return (normalise(s).match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => n.replace(".", "").length >= 2);
}

/** Does every figure in `range` appear in the text of at least one page? This is the whole defence against a
 *  made-up price: a model can word a range any way it likes, but it cannot make "4000" appear on a page that
 *  never printed it. A range with no figure of two digits or more proves nothing and is rejected. */
export function rangeIsGrounded(range: string | null | undefined, texts: string[]): boolean {
  const nums = figures(String(range ?? ""));
  if (!nums.length) return false;
  const hay = texts.map(normalise);
  return nums.every((n) => hay.some((h) => h.includes(n)));
}

/* ── "price on request" ──────────────────────────────────────────────────────────────────── */

const QUOTE_RE = /(request|get|ask for|contact us for|call for|email us for|reach out for)\s+(a\s+)?(free\s+)?(custom\s+)?(quote|quotation|price|pricing)|custom(i[sz]ed)?\s+pric|pricing\s+(is\s+)?(tailored|customi[sz]ed|on request|depends)|quote[- ]based|price\s+on\s+(request|application)|priced\s+per\s+(project|quote)/i;

export function mentionsQuoteOnly(text: string): boolean {
  return QUOTE_RE.test(String(text ?? ""));
}

/* ── the detector ────────────────────────────────────────────────────────────────────────── */

export type CompleteFn = (prompt: string) => Promise<any>;

const MODELS = ["fixed", "quote", "subscription", "free"] as const;
const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s && s.toLowerCase() !== "null" ? s.slice(0, max) : null;
};

export async function detectPricing(pages: PricePage[], complete: CompleteFn): Promise<PriceFinding | null> {
  const all = collectSnippets(pages);
  // A dedicated pricing page IS the business's price list. When there is one, only it is read: an article on
  // the same site about "what ISO costs in Dubai" is a market guide in another currency, and mixing the two
  // produced "from $2,400 to $18,000; from AED 3,000 to AED 25,000" against a real site (2026-11-14).
  const dedicated = all.filter((x) => PRICE_PATH.test(x.url));
  const snippets = dedicated.length ? dedicated : all;

  // Nothing with an amount in it: no model call is needed, and none could be trusted. Either the site says
  // price-by-quote, or it says nothing.
  if (!snippets.length) {
    const hit = pages.filter((p) => mentionsQuoteOnly(p.text)).slice(0, 3);
    return hit.length
      ? { pricing: { model: "quote", range: null, note: "Pricing is shared on request, after understanding the requirement." }, sources: hit.map((p) => p.url) }
      : null;
  }

  let answer: any = null;
  try {
    answer = await complete(
      [
        "Below are short excerpts from one business's own website, each with the address of the page it came from.",
        "",
        snippets.map((s, i) => `[${i + 1}] ${s.url}\n${s.text}`).join("\n\n"),
        "",
        "Summarise what the business charges for what it sells. Rules:",
        "- Use ONLY amounts that appear in the excerpts, copied EXACTLY as printed with their currency. Never calculate, convert, average or round.",
        "- If the excerpts show several prices, give the lowest and highest as a range, or the two or three main ones, in ONE short line of at most 120 characters, e.g. 'from $2,400 to $18,000 depending on the package'.",
        "- Prefer the business's own pricing or packages page over an article ABOUT what such services cost in general.",
        "- Ignore amounts that are not the business's own price: a competitor's price, a customer's budget in an example, a salary, a fine, a government fee, an old or struck-through price.",
        "- If the excerpts do not clearly show what THIS business charges, the range is null. Do not guess.",
        "- model: EXACTLY one word from fixed | quote | subscription | free, only if the excerpts make it clear, else null. No other words.",
        "- note: any condition stated next to the price (per month, per site, plus VAT, starting from...), else null.",
        "",
        'Reply with ONLY JSON: {"model":"...","range":"...","note":"..."}',
      ].join("\n"),
    );
  } catch {
    answer = null;
  }

  const model = (clean(answer?.model, 20) ?? "").toLowerCase();
  const range = clean(answer?.range, 160);
  const note = clean(answer?.note, 200);

  // THE CHECK. Every figure in the range must be printed on the site. If not, the range is discarded — the
  // model was wrong or was making it up, and either way a customer must never be quoted it.
  const grounded = range != null && rangeIsGrounded(range, pages.map((p) => p.text));
  if (grounded) {
    const used = snippets.filter((s) => figures(range!).some((n) => normalise(s.text).includes(n)));
    const sources = [...new Set((used.length ? used : snippets).map((s) => s.url))].slice(0, 4);
    return {
      pricing: { model: (MODELS as readonly string[]).includes(model) ? (model as Pricing["model"]) : null, range, note: note && figures(note).every((n) => rangeIsGrounded(n, pages.map((p) => p.text))) ? note : null },
      sources,
    };
  }

  // Amounts exist but none could be confirmed as the business's own price. Fall back to "by quote" only if
  // the site actually says so; otherwise there is no price to give.
  const hit = pages.filter((p) => mentionsQuoteOnly(p.text)).slice(0, 3);
  return hit.length
    ? { pricing: { model: "quote", range: null, note: "Pricing is shared on request, after understanding the requirement." }, sources: hit.map((p) => p.url) }
    : null;
}
