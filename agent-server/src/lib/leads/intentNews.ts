/** News as a buying signal: a company in the news for expanding, opening a plant, winning a contract,
 *  launching or raising money is a company whose needs just changed — the best "why now" there is.
 *
 *  HOW A HEADLINE BECOMES A LEAD (every step is checkable, none is a guess):
 *
 *    1. Google News RSS for the buyer segment + place + event words. A public, keyless feed meant to
 *       be read by programs. Dated and linked, so every signal can be checked by a human.
 *    2. The model reads the headlines and returns which ones name a SPECIFIC COMPANY in such an
 *       event. CODE then checks each answer: the company name must appear, letter for letter, in the
 *       headline the model pointed at. A name the model made up cannot pass.
 *    3. The company's website is looked up (resolveWebsite, a search API) and kept only if its domain
 *       plausibly IS that company (domainMatchesName). No website = no lead: nothing to research or
 *       reach, and the pipeline would drop it anyway.
 *
 *  OFF unless a website resolver exists (a search key) — without one every headline dead-ends at
 *  step 3, and spending a model call to get there would be waste. Resolver lookups are capped per run.
 *  A failing feed or model is a report line, never an exception.
 */

import * as cheerio from "cheerio";
import type { Candidate } from "./sources.js";
import type { Icp } from "./icp.js";

export type LlmJson = (prompt: string) => Promise<unknown>;
export type ResolveWebsite = (companyName: string, geo: string | null) => Promise<{ website: string; domain: string } | null>;

export type NewsItem = { title: string; headline: string; publisher: string | null; link: string; at: string | null };
export type NewsEvent = "expansion" | "new-facility" | "contract" | "launch" | "funding" | "other";
export type NewsFinding = { company: string; event: NewsEvent; item: NewsItem };

const EVENTS: NewsEvent[] = ["expansion", "new-facility", "contract", "launch", "funding", "other"];
const NEWS_HOST = "news.google.com";
const MAX_HEADLINES = 30;
const FRESH_DAYS = 45; // an event older than this is history, not a reason to write today

// ── 1 · the feed ─────────────────────────────────────────────────────────────────────────────

const EVENT_WORDS = '(expansion OR expands OR "new plant" OR "new facility" OR "new factory" OR contract OR awarded OR launches OR "raises funding" OR "opens new")';

export function newsQuery(industry: string, geo: string | null): string {
  return `"${industry}" ${geo ? `"${geo}" ` : ""}${EVENT_WORDS} when:30d`.replace(/\s+/g, " ").trim();
}

/** Google News region params from a free-text geo; English edition, no region when unknown. */
export function newsFeedUrl(industry: string, geo: string | null, gl: string | null): string {
  const region = gl ? gl.toUpperCase() : "US";
  const q = encodeURIComponent(newsQuery(industry, geo));
  return `https://${NEWS_HOST}/rss/search?q=${q}&hl=en-${region}&gl=${region}&ceid=${region}:en`;
}

/** RSS text -> items. "Headline - Publisher" titles are split so the publisher is never mistaken
 *  for the company. Exported for tests (no network). */
export function parseNewsRss(xml: string): NewsItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: NewsItem[] = [];
  $("item").each((_, el) => {
    const title = $(el).children("title").first().text().replace(/\s+/g, " ").trim();
    const link = $(el).children("link").first().text().trim();
    if (!title || !/^https?:\/\//i.test(link)) return;
    const sourceTag = $(el).children("source").first().text().trim() || null;
    const m = title.match(/^(.*\S)\s+-\s+([^-]{2,60})$/);
    const headline = m ? m[1].trim() : title;
    const publisher = sourceTag ?? (m ? m[2].trim() : null);
    const t = Date.parse($(el).children("pubDate").first().text().trim());
    out.push({ title, headline, publisher, link, at: Number.isFinite(t) ? new Date(t).toISOString() : null });
  });
  return out;
}

// ── 2 · the model names the companies, code checks it ────────────────────────────────────────

export function buildNewsPrompt(items: NewsItem[], segment: string, offer: string | null): string {
  return [
    "You find companies whose situation just changed, from news headlines, for a sales tool.",
    `OUR OFFER: ${offer || "(not stated)"}`,
    `THE KIND OF BUYER WE WANT: ${segment}`,
    "",
    "HEADLINES (numbered):",
    ...items.map((it, i) => `${i}. ${it.headline}`),
    "",
    "Pick every headline that reports a SPECIFIC COMPANY in an event that may soon need our offer:",
    "expansion, a new plant or facility, a new contract, a launch, or new funding.",
    "",
    "RULES:",
    "1. `company` is the company's name EXACTLY as written in that headline, letter for letter.",
    "2. Skip headlines about governments, agencies, news outlets, people, or no named company.",
    "3. Skip companies that SELL our offer (peers) — we want companies that BUY it.",
    "4. When unsure, skip. A short list of certain ones beats a long list of maybes.",
    "",
    `event is one of: ${EVENTS.join(" | ")}`,
    'Reply with ONLY JSON: {"items":[{"i":0,"company":"...","event":"expansion"}]}',
  ].join("\n");
}

/** Model output -> verified findings. The company name has to be in the headline it points at. */
export function validateFindings(raw: unknown, items: NewsItem[]): NewsFinding[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as any).items) ? ((raw as any).items as any[]) : [];
  const out: NewsFinding[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const i = Number(r?.i);
    const company = typeof r?.company === "string" ? r.company.replace(/\s+/g, " ").trim() : "";
    const item = Number.isInteger(i) ? items[i] : undefined;
    if (!item || company.length < 2 || company.length > 60) continue;
    if (!item.headline.toLowerCase().includes(company.toLowerCase())) continue; // not in the headline: invented
    if (item.publisher && company.toLowerCase() === item.publisher.toLowerCase()) continue; // the outlet, not a company
    const key = company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const event = EVENTS.includes(r?.event) ? (r.event as NewsEvent) : "other";
    out.push({ company, event, item });
  }
  return out;
}

// ── 3 · the website, and whether it is really theirs ─────────────────────────────────────────

const LEGAL_SUFFIX = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co|company|group|holding|holdings|plc|pjsc|fze|fzco|gmbh|pvt|private|sa|ag|the)\b/gi;

function compact(s: string): string {
  return s.toLowerCase().replace(LEGAL_SUFFIX, " ").replace(/[^a-z0-9]+/g, "");
}

/** Does this domain plausibly belong to this company? The domain's main label must contain the
 *  company's compacted name (or the other way round, for a label of 4+ letters). "Emirates Steel
 *  Industries LLC" -> emiratessteelindustries; emiratessteel.com passes, gulfnews.com does not. */
export function domainMatchesName(name: string, domain: string): boolean {
  const label = compact(domain.replace(/^www\./, "").split(".")[0]);
  const n = compact(name);
  if (!label || !n) return false;
  if (label.length >= 4 && n.includes(label)) return true;
  return n.length >= 4 && label.includes(n);
}

// ── the source ───────────────────────────────────────────────────────────────────────────────

export type NewsDeps = {
  fetchImpl?: typeof fetch;
  llmJson: LlmJson;
  resolveWebsite: ResolveWebsite | null;
  gl?: string | null;
  offer?: string | null;
  now?: () => Date;
};

export function newsIntentEnabled(): boolean {
  return process.env.LEADS_NEWS_INTENT !== "0";
}

export async function newsIntentSearch(icp: Icp, limit: number, deps: NewsDeps): Promise<{ candidates: Candidate[]; note: string }> {
  if (!newsIntentEnabled()) return { candidates: [], note: "switched off (LEADS_NEWS_INTENT=0)" };
  if (!deps.resolveWebsite) return { candidates: [], note: "needs a search key (SERPER_API_KEY) to find each company's website — off" };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? (() => new Date()))();

  let xml: string;
  try {
    const res = await fetchImpl(newsFeedUrl(icp.industry, icp.geo, deps.gl ?? null), {
      headers: { "User-Agent": "MenCraLeadBot/1.0 (+https://mencra.com/bot)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { candidates: [], note: `news feed answered HTTP ${res.status}` };
    xml = await res.text();
  } catch (e: any) {
    return { candidates: [], note: `news feed unreachable (${String(e?.message ?? e).slice(0, 80)})` };
  }

  const fresh = parseNewsRss(xml)
    .filter((it) => !it.at || now.getTime() - Date.parse(it.at) <= FRESH_DAYS * 86_400_000)
    .slice(0, MAX_HEADLINES);
  if (!fresh.length) return { candidates: [], note: "no recent news for this segment" };

  let findings: NewsFinding[];
  try {
    findings = validateFindings(await deps.llmJson(buildNewsPrompt(fresh, icp.industry, deps.offer ?? null)), fresh);
  } catch (e: any) {
    return { candidates: [], note: `could not read the headlines (${String(e?.message ?? e).slice(0, 80)})` };
  }
  if (!findings.length) return { candidates: [], note: `${fresh.length} headlines, none named a company in a growth event` };

  const maxLookups = Math.max(1, Math.min(10, Number(process.env.LEADS_NEWS_MAX_LOOKUPS) || 5));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let looked = 0;
  for (const f of findings) {
    if (out.length >= limit || looked >= maxLookups) break;
    looked += 1;
    const site = await deps.resolveWebsite(f.company, icp.geo).catch(() => null);
    if (!site || !domainMatchesName(f.company, site.domain) || seen.has(site.domain)) continue;
    seen.add(site.domain);
    out.push({
      name: f.company,
      website: site.website,
      domain: site.domain,
      phone: null,
      address: null,
      categories: [`news: ${f.event}`],
      source: "news",
      sourceRef: f.item.link,
      attribution: `In the news: "${f.item.headline}"${f.item.publisher ? ` (${f.item.publisher})` : ""}`,
      intent: { kind: "news", text: `${f.event}: ${f.item.headline}`, url: f.item.link, at: f.item.at },
    });
  }
  return {
    candidates: out,
    note: out.length
      ? `${out.length} companies in growth news (${findings.length} named, ${looked} website lookups)`
      : `${findings.length} companies named in the news, but none of their websites could be confirmed`,
  };
}
