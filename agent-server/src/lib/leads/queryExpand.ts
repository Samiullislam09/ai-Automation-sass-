/** Widen ONE buyer segment into the several ways the web actually names it.
 *
 *  A segment is a single phrase ("Manufacturers") but a directory files the same companies under
 *  "factories", "industrial units", "fabrication", "exporters"... One query finds one of those
 *  shelves. This asks the model for the other shelves — and ONLY that: it returns bare category
 *  phrases, never companies, never places, never anything about the tenant's own trade.
 *
 *  Same discipline as buyerProfile.ts: the model drafts, code validates. A phrase that is too
 *  short, too long, carries a digit or a place the model was told not to add, or repeats one we
 *  already have is dropped here. A model that cannot be reached means no expansion, not a failed
 *  run — the run simply keeps the terms it had. The buyer-vs-competitor gate downstream still
 *  screens every company these phrases surface, so a loose phrase costs a wasted read, not a bad lead. */

export type LlmJson = (prompt: string) => Promise<unknown>;

const MAX_TERMS = 10;
const cache = new Map<string, string[]>();
export function __resetExpandCache() {
  cache.clear();
}

export function buildExpandPrompt(segment: string, whyBuy: string | null, offer: string | null, have: string[]): string {
  return [
    "You help a sales tool find BUYERS in business directories and web listings.",
    `OUR OFFER: ${offer || "(not stated)"}`,
    `ONE KIND OF BUYER: ${segment}${whyBuy ? ` — they buy because: ${whyBuy}` : ""}`,
    `PHRASES WE ALREADY SEARCH: ${have.join("; ") || "(none)"}`,
    "",
    `List up to ${MAX_TERMS} OTHER short category phrases that directories and listings use for this same kind of buyer:`,
    "synonyms, narrower sub-types, and the industries they sit in.",
    "",
    "RULES:",
    "1. Phrases name KINDS of organisation (2 to 4 words). Never a company name, never a person.",
    "2. NO place names (no city, region or country) — the place is added separately.",
    "3. Never a phrase for organisations that SELL our offer — only organisations that BUY it.",
    "4. No phrase that repeats one we already search.",
    "",
    'Reply with ONLY JSON: {"terms":["...","..."]}',
  ].join("\n");
}

/** Model output -> clean phrases. Exported for tests. */
export function validateTerms(raw: unknown, have: string[]): string[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as any).terms) ? ((raw as any).terms as unknown[]) : [];
  const seen = new Set(have.map((h) => h.trim().toLowerCase()));
  const out: string[] = [];
  for (const t of list) {
    const s = typeof t === "string" ? t.replace(/\s+/g, " ").trim() : "";
    const k = s.toLowerCase();
    if (s.length < 4 || s.length > 50) continue;
    if (/\d/.test(s)) continue; // a number is a year, a count or a postcode, not a category
    if (s.split(" ").length > 5) continue; // a sentence
    if (/\b(in|near|around|at)\s+[A-Z]/.test(s)) continue; // "... in Dubai" — a place slipped in
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

export async function expandTerms(
  input: { segment: string; whyBuy?: string | null; offer?: string | null; have?: string[] },
  llmJson: LlmJson,
): Promise<string[]> {
  const have = (input.have ?? []).filter(Boolean);
  const key = `${input.segment.toLowerCase()}|${(input.offer ?? "").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return validateTerms({ terms: hit }, have);
  try {
    const raw = await llmJson(buildExpandPrompt(input.segment, input.whyBuy ?? null, input.offer ?? null, have));
    const terms = validateTerms(raw, have);
    cache.set(key, terms);
    return terms;
  } catch {
    return [];
  }
}
