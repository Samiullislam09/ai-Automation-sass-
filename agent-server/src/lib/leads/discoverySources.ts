/** Discovery sources that run on the Scrapling service (scrapling-service/) instead of a search API.
 *
 *  Two sources, both of which find companies by READING pages rather than asking a search engine:
 *
 *   · `directory` — a business directory / member list / exhibitor list. The owner names the
 *     directories (LEADS_DIRECTORY_URLS, a search-URL template per site) and the service names the
 *     hosts it will read (LIST_ALLOWED_HOSTS). Every company the page links to is a candidate; the
 *     pipeline then reads each one's own site and decides whether it is a buyer.
 *   · `clients`   — a competitor's public "our clients / case studies" pages. A company that already
 *     bought the same thing from a peer is the best buyer there is, and the competitor said so
 *     themselves on a public page. Competitor sites come from the tenant's own list
 *     (settings.competitor_sites), which the agent also grows from the competitors it screens out.
 *
 *  Both are OFF (return nothing, with a reason) unless SCRAPLING_SERVICE_URL is set, and a source
 *  that fails is a report line, never a thrown error — same contract as every source in sources.ts.
 *
 *  A candidate with no website (a client logo that links nowhere) is dropped here: with no site and
 *  no phone there is nothing to research or reach, and a lead we cannot contact is noise.
 */

import type { Candidate } from "./sources.js";
import type { Icp } from "./icp.js";
import { domainOf } from "./compliance.js";
import { clientsViaScrapling, listViaScrapling, scraplingConfigured, type FoundCompany } from "./scraplingClient.js";

export type ExtraSourceResult = { candidates: Candidate[]; note: string };

// A small cache: the same directory page or competitor is not re-read on every scheduled run.
const TTL_MS = 6 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; value: FoundCompany[] }>();
export function __resetDiscoveryCache() {
  memo.clear();
}
async function memoised(key: string, fn: () => Promise<FoundCompany[] | null>): Promise<FoundCompany[] | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fn();
  if (value) memo.set(key, { at: Date.now(), value });
  return value;
}

// ── directory ────────────────────────────────────────────────────────────────────────────────

/** LEADS_DIRECTORY_URLS: search-URL templates, whitespace- or comma-separated, with {q} (what to
 *  look for) and optionally {geo}. e.g. https://directory.example/search?q={q}&loc={geo} */
export function directoryTemplates(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.LEADS_DIRECTORY_URLS ?? "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => /^https?:\/\/.+\{q\}/i.test(t));
}

export function directoryConfigured(): boolean {
  return scraplingConfigured() && directoryTemplates().length > 0;
}

/** The bare phrases to look a directory up by: the buyer segment first, then the AI-expanded ones. */
export function directoryQueries(icp: Icp, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [icp.industry, ...(icp.expandedTerms ?? [])]) {
    const t = String(q ?? "").replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function fillTemplate(template: string, q: string, geo: string | null): string {
  return template.replace(/\{q\}/g, encodeURIComponent(q)).replace(/\{geo\}/g, encodeURIComponent(geo ?? ""));
}

function toCandidate(c: FoundCompany, source: "directory" | "clients", why: string, attribution: string): Candidate | null {
  if (!c.website) return null; // see the header: no site, nothing to research or reach
  const domain = c.domain ?? domainOf(c.website);
  return {
    name: c.name,
    website: c.website,
    domain,
    phone: null,
    address: null,
    categories: [why],
    source,
    sourceRef: domain ?? c.website,
    attribution,
  };
}

/** Companies from the configured business directories for this ICP. */
export async function directorySearch(icp: Icp, limit: number, fetchImpl: typeof fetch = fetch): Promise<ExtraSourceResult> {
  if (!scraplingConfigured()) return { candidates: [], note: "no SCRAPLING_SERVICE_URL — directory search is off" };
  const templates = directoryTemplates();
  if (!templates.length) return { candidates: [], note: "no LEADS_DIRECTORY_URLS — no directory is configured" };

  const maxQ = Math.max(1, Math.min(6, Number(process.env.LEADS_DIRECTORY_MAX_QUERIES) || 3));
  const queries = directoryQueries(icp, maxQ);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];

  outer: for (const template of templates) {
    for (const q of queries) {
      const url = fillTemplate(template, q, icp.geo);
      const rows = await memoised(`dir:${url}`, async () => {
        const r = await listViaScrapling(url, { maxPages: 2, limit: Math.min(60, limit) }, fetchImpl);
        if (!r) return null;
        if (!r.ok) {
          problems.push(r.reason);
          return null;
        }
        return r.companies;
      });
      for (const c of rows ?? []) {
        const cand = toCandidate(c, "directory", `listed in a directory for "${q}"`, `Found in a business directory (${hostOnly(url)})`);
        const key = cand?.domain;
        if (!cand || !key || seen.has(key)) continue;
        seen.add(key);
        out.push(cand);
        if (out.length >= limit) break outer;
      }
    }
  }

  if (out.length) return { candidates: out, note: `${out.length} companies from ${templates.length} director${templates.length === 1 ? "y" : "ies"}` };
  return { candidates: [], note: problems.length ? `directory search found nothing — ${problems[0]}` : "directories had no matching companies" };
}

// ── competitors' clients ─────────────────────────────────────────────────────────────────────

/** Which competitor sites to read this run: a few, rotating daily so a long list is covered over
 *  time instead of always hammering the first. Pure, so it is testable. */
export function pickCompetitors(sites: string[], perRun: number, now: Date = new Date()): string[] {
  const clean = [...new Set(sites.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (clean.length <= perRun) return clean;
  const start = Math.floor(now.getTime() / 86_400_000) % clean.length;
  return Array.from({ length: perRun }, (_, i) => clean[(start + i) % clean.length]);
}

/** Customers named on the competitors' own public client pages. */
export async function competitorClientsSearch(
  competitorSites: string[],
  ownDomain: string | null,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtraSourceResult> {
  if (!scraplingConfigured()) return { candidates: [], note: "no SCRAPLING_SERVICE_URL — competitor-client search is off" };
  if (!competitorSites.length) return { candidates: [], note: "no competitor sites on file yet (they are learned as competitors are screened out)" };

  const perRun = Math.max(1, Math.min(6, Number(process.env.LEADS_CLIENTS_COMPETITORS_PER_RUN) || 3));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];
  let read = 0;

  for (const site of pickCompetitors(competitorSites, perRun)) {
    if (out.length >= limit) break;
    const rows = await memoised(`clients:${site}`, async () => {
      const r = await clientsViaScrapling(site.includes("://") ? site : `https://${site}`, { limit: 40 }, fetchImpl);
      if (!r) return null;
      if (!r.ok) {
        problems.push(`${site}: ${r.reason}`);
        return null;
      }
      return r.companies;
    });
    if (rows) read += 1;
    const compDomain = domainOf(site.includes("://") ? site : `https://${site}`);
    for (const c of rows ?? []) {
      const cand = toCandidate(c, "clients", `named as a client on ${compDomain ?? site}`, `Listed as a client of ${compDomain ?? site}`);
      const key = cand?.domain;
      // Never the competitor itself, and never the tenant's own site.
      if (!cand || !key || seen.has(key) || key === compDomain || (ownDomain && key === ownDomain)) continue;
      seen.add(key);
      out.push(cand);
      if (out.length >= limit) break;
    }
  }

  if (out.length) return { candidates: out, note: `${out.length} clients named by ${read} competitor site${read === 1 ? "" : "s"}` };
  return { candidates: [], note: problems.length ? `competitor clients — ${problems[0]}` : "competitor sites list no clients" };
}

function hostOnly(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
