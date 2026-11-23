/** LinkedIn company pages, read from the SEARCH RESULT — never from LinkedIn.
 *
 *  A web search for "manufacturers Dubai linkedin company" returns linkedin.com/company/... results
 *  whose title and snippet already say who the company is: "Acme Steel | LinkedIn" and
 *  "Manufacturing · 51-200 employees · Dubai". That text is what the search engine publishes about
 *  the page; we never request linkedin.com ourselves, so there is no login wall to get past, no
 *  account to risk and nothing of LinkedIn's to evade. (Directly fetching LinkedIn needs fake
 *  accounts and fingerprint spoofing, which this codebase does not do.)
 *
 *  A listing gives a NAME, a SIZE and a link — no website, no contact. So the same two-step as the
 *  news source: look the company's own website up (resolveWebsite), keep it only when the domain
 *  plausibly IS that company (domainMatchesName), and hand the candidate to the normal pipeline,
 *  which reads that website and decides whether they are a buyer. No confirmed website = no lead.
 *
 *  Plain words only: Serper's free tier rejects Google operators (`site:`), so the query uses the
 *  word "linkedin" and the filtering happens on the result's own URL. Costs 1 search per query plus
 *  1 per website lookup; both are capped per run.
 */

import type { Candidate } from "./sources.js";
import type { Icp } from "./icp.js";
import { domainMatchesName, type ResolveWebsite } from "./intentNews.js";

/** One web search -> its organic results (Serper's `organic` array). null = no search key. */
export type WebSearch = (query: string, geo: string | null) => Promise<any[]>;

export type LinkedinListing = { name: string; slug: string; url: string; employees: string | null; employeesMax: number | null };

// ── parsing one result ───────────────────────────────────────────────────────────────────────

/** The company slug from a linkedin.com/company/<slug> URL, or null for anything else (a person,
 *  a post, a job, a school, a regional login page). */
export function companySlug(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/company\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** "Acme Steel | LinkedIn" / "Acme Steel - LinkedIn" / "Acme Steel: Overview | LinkedIn" -> "Acme Steel". */
export function nameFromTitle(title: string): string | null {
  let t = String(title ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*[|\-–—:·]\s*linkedin.*$/i, "").trim();
  t = t.split(/\s[|\-–—]\s/)[0].replace(/:\s*(overview|company|about).*$/i, "").trim();
  if (t.length < 2 || t.length > 70 || /^linkedin$/i.test(t)) return null;
  return t;
}

/** "51-200 employees" / "1,001-5,000 employees" / "10,001+ employees" from a snippet. */
export function employeesFromSnippet(snippet: string): { text: string; max: number | null } | null {
  const s = String(snippet ?? "");
  const range = s.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s*employees/i);
  if (range) return { text: `${range[1]}-${range[2]} employees`, max: Number(range[2].replace(/,/g, "")) };
  const plus = s.match(/(\d[\d,]*)\+\s*employees/i);
  if (plus) return { text: `${plus[1]}+ employees`, max: null };
  const exact = s.match(/(\d[\d,]*)\s*employees/i);
  if (exact) return { text: `${exact[1]} employees`, max: Number(exact[1].replace(/,/g, "")) };
  return null;
}

export function listingFromResult(r: any): LinkedinListing | null {
  const link = String(r?.link ?? "");
  const slug = companySlug(link);
  const name = nameFromTitle(String(r?.title ?? ""));
  if (!slug || !name) return null;
  const emp = employeesFromSnippet(String(r?.snippet ?? ""));
  return { name, slug, url: link, employees: emp?.text ?? null, employeesMax: emp?.max ?? null };
}

// ── the source ───────────────────────────────────────────────────────────────────────────────

export function linkedinEnabled(): boolean {
  return process.env.LEADS_LINKEDIN !== "0";
}

/** Bare category words for the query: the segment, then its expansions, never the place. */
export function linkedinQueries(icp: Icp, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [icp.industry, ...(icp.expandedTerms ?? [])]) {
    const w = String(t ?? "").replace(/\s+/g, " ").trim();
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(`${w}${icp.geo ? ` ${icp.geo}` : ""} linkedin company`);
    if (out.length >= max) break;
  }
  return out;
}

export type LinkedinDeps = { search: WebSearch | null; resolveWebsite: ResolveWebsite | null };

export async function linkedinSearch(icp: Icp, limit: number, deps: LinkedinDeps): Promise<{ candidates: Candidate[]; note: string }> {
  if (!linkedinEnabled()) return { candidates: [], note: "switched off (LEADS_LINKEDIN=0)" };
  if (!deps.search || !deps.resolveWebsite) return { candidates: [], note: "needs a search key (SERPER_API_KEY) — off" };

  const maxQueries = Math.max(1, Math.min(3, Number(process.env.LEADS_LINKEDIN_QUERIES) || 2));
  const maxLookups = Math.max(1, Math.min(12, Number(process.env.LEADS_LINKEDIN_MAX_LOOKUPS) || 6));

  const listings: LinkedinListing[] = [];
  const slugs = new Set<string>();
  for (const q of linkedinQueries(icp, maxQueries)) {
    let rows: any[] = [];
    try {
      rows = await deps.search(q, icp.geo);
    } catch {
      continue;
    }
    for (const r of rows) {
      const l = listingFromResult(r);
      if (!l || slugs.has(l.slug)) continue;
      slugs.add(l.slug);
      listings.push(l);
    }
  }
  if (!listings.length) return { candidates: [], note: "no LinkedIn company listings in the search results" };

  const out: Candidate[] = [];
  const seenDomains = new Set<string>();
  let looked = 0;
  for (const l of listings) {
    if (out.length >= limit || looked >= maxLookups) break;
    looked += 1;
    const site = await deps.resolveWebsite(l.name, icp.geo).catch(() => null);
    if (!site || !domainMatchesName(l.name, site.domain) || seenDomains.has(site.domain)) continue;
    seenDomains.add(site.domain);
    out.push({
      name: l.name,
      website: site.website,
      domain: site.domain,
      phone: null,
      address: null,
      categories: ["LinkedIn company page", ...(l.employees ? [l.employees] : [])],
      source: "linkedin",
      sourceRef: l.url,
      attribution: `LinkedIn company listing${l.employees ? ` (${l.employees})` : ""} — read from a public search result`,
    });
  }
  return {
    candidates: out,
    note: out.length
      ? `${out.length} companies from ${listings.length} LinkedIn listings (${looked} website lookups)`
      : `${listings.length} LinkedIn listings, but none had a website we could confirm`,
  };
}
