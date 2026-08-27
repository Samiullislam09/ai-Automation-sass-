/** Where leads come from — and the manners we use getting them.
 *
 *  Built to the same shape as lib/dataforseo.ts: a paid source is OPTIONAL. Each source
 *  answers `configured()` for itself, `discover()` uses the ones that can answer, and a run
 *  with no paid key still returns leads instead of an error. A missing key is a degraded run
 *  with a note, never a failure — that is the difference between a product a student can run
 *  and a demo that needs a credit card.
 *
 *  SOURCES
 *
 *   · `osm`    — OpenStreetMap via Nominatim. Free, no key, wired today. Local businesses by
 *                category and area, with website and phone where the map has them.
 *   · `places` — Google Places. SEAM (see below). GOOGLE_PLACES_API_KEY.
 *   · `apollo` — Apollo.io for B2B. SEAM. APOLLO_API_KEY.
 *
 *  MANNERS — why this file is longer than "call an API"
 *
 *   1. Nominatim is somebody's donated server. Its Usage Policy is one request per second, an
 *      identifying User-Agent, and cache what you get. All three are implemented here (the
 *      throttle + 24h cache pattern is lifted straight from lib/autocomplete.ts, which does the
 *      same for Google Suggest). Ignoring it gets the whole product's IP blocked, and OSM has
 *      no support desk to argue with.
 *   2. OSM data is ODbL. Anything shown to a user that came from here carries the attribution
 *      string below.
 *   3. robots.txt is checked before we read ANY lead's website (`fetchPageForResearch`). These
 *      are strangers' sites — nobody asked us to come. A `Disallow` is an answer, and the lead
 *      is dropped with that as its reason rather than fetched anyway. We also honour
 *      `Crawl-delay` and rate-limit ourselves per host regardless.
 *   4. A search API's robots.txt governs crawlers, not its own API clients; for Nominatim the
 *      Usage Policy above is the rule that applies, and it is the one we follow.
 */

import * as cheerio from "cheerio";
import type { Icp } from "./icp.js";
import { domainOf } from "./compliance.js";

// ── identity: who we are, on every request we make ──────────────────────────────────────────

/** Same shape as the crawler's UA (lib/crawl.ts): a name, a URL, and a sentence saying why.
 *  A site owner who looks in their log can tell what we are and block us if they want to. */
export const LEADS_UA = "MrLxwaLeadBot/1.0 (+https://mrlxwa.com/bot; researching a business before writing to it)";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

// ── the shape a source returns ──────────────────────────────────────────────────────────────

export type SourceId = "osm" | "places" | "apollo";

export type Candidate = {
  name: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  address: string | null;
  /** Whatever the source calls this business: "restaurant", "amenity=cafe", an Apollo industry. */
  categories: string[];
  source: SourceId;
  /** The source's own id, so the same business found twice is the same row. */
  sourceRef: string | null;
  /** Shown wherever the lead is shown, when the source requires it (ODbL). */
  attribution: string | null;
};

/** What each source did this run — printed in the agent's output so "why only 4 leads?" has an
 *  answer that names the missing key instead of shrugging. */
export type SourceReport = {
  id: SourceId;
  label: string;
  /** Are its credentials present? */
  configured: boolean;
  /** Is the adapter actually built? A seam is `wired: false` however many keys you set. */
  wired: boolean;
  envVars: string[];
  used: boolean;
  found: number;
  note: string;
};

export type DiscoverResult = { candidates: Candidate[]; reports: SourceReport[] };

// ── throttle + cache, one per external host (lib/autocomplete.ts pattern) ───────────────────

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

/** One serialised chain per host, so two different hosts are not slowed down by each other and
 *  one host is never hit twice inside its gap. */
const chains = new Map<string, { chain: Promise<unknown>; lastAt: number }>();

function throttled<T>(host: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
  const state = chains.get(host) ?? { chain: Promise.resolve(), lastAt: 0 };
  const run = state.chain.then(async () => {
    const wait = state.lastAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    state.lastAt = Date.now();
    return fn();
  });
  state.chain = run.catch(() => undefined);
  chains.set(host, state);
  return run;
}

function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  return undefined;
}

function remember(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
}

/** Test hook: the module-level cache and throttle state are process-wide by design (one
 *  Railway instance), which a test suite has to be able to reset. */
export function __resetSourceCaches() {
  cache.clear();
  chains.clear();
  robotsCache.clear();
}

// ── robots.txt ──────────────────────────────────────────────────────────────────────────────

export type RobotsRules = {
  /** Longest-match-wins prefix rules, as robots.txt is actually specified. */
  allow: string[];
  disallow: string[];
  crawlDelayMs: number;
  /** True when we could not read a robots.txt at all. Absent robots.txt = allowed, which is
   *  the standard's own answer, not a convenience. */
  missing: boolean;
};

const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_HOST_GAP_MS = 1500;

/** Fetch and parse one origin's robots.txt, cached six hours.
 *
 *  Two groups matter: the one naming us, and `*`. A group naming us wins outright if present —
 *  a site owner who wrote our name meant it. */
export async function loadRobots(origin: string, fetchImpl: typeof fetch = fetch): Promise<RobotsRules> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.rules;

  let rules: RobotsRules = { allow: [], disallow: [], crawlDelayMs: 0, missing: true };
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, {
      headers: { "User-Agent": LEADS_UA },
      signal: AbortSignal.timeout(8000),
    });
    // 4xx = no robots.txt = no restrictions. 5xx is the site being broken, and the polite
    // reading of a broken robots.txt is "stay out" — so we do.
    if (res.status >= 500) rules = { allow: [], disallow: ["/"], crawlDelayMs: 0, missing: false };
    else if (res.ok) rules = parseRobots(await res.text());
  } catch {
    // Unreachable: treated as absent. The page fetch that follows will fail anyway if the
    // whole host is down, and the lead is dropped there with a readable reason.
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

export function parseRobots(txt: string, agentToken = "mrlxwaleadbot"): RobotsRules {
  const lines = String(txt ?? "").split(/\r?\n/);
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], delay: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    else if (key === "disallow") current.disallow.push(value);
    else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) current.delay = n;
    }
  }

  const mine = groups.find((g) => g.agents.some((a) => a.includes(agentToken)));
  const star = groups.find((g) => g.agents.includes("*"));
  const group = mine ?? star;
  if (!group) return { allow: [], disallow: [], crawlDelayMs: 0, missing: false };

  return {
    allow: group.allow,
    // An empty `Disallow:` means "nothing is disallowed" — dropping it here is what keeps it
    // from being read as the prefix "" which matches every path.
    disallow: group.disallow.filter(Boolean),
    crawlDelayMs: Math.min(group.delay * 1000, 30_000),
    missing: false,
  };
}

/** Longest matching rule wins; Allow beats Disallow at equal length — the standard behaviour,
 *  and the one a site owner expects when they write an exception. */
export function robotsAllows(rules: RobotsRules, pathname: string): boolean {
  const path = pathname || "/";
  const match = (patterns: string[]) =>
    patterns.reduce((best, p) => (matchesRobotsPattern(p, path) ? Math.max(best, p.length) : best), -1);
  const allow = match(rules.allow);
  const disallow = match(rules.disallow);
  if (disallow < 0) return true;
  return allow >= disallow;
}

function matchesRobotsPattern(pattern: string, path: string): boolean {
  if (!pattern) return false;
  // `*` and a trailing `$` are the two wildcards robots.txt has in practice.
  if (pattern.includes("*") || pattern.endsWith("$")) {
    const body = pattern.replace(/\$$/, "");
    const re = new RegExp(`^${body.split("*").map(escapeRe).join(".*")}${pattern.endsWith("$") ? "$" : ""}`);
    return re.test(path);
  }
  return path.startsWith(pattern);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── reading one lead's website, politely ────────────────────────────────────────────────────

export type FetchedPage = { url: string; title: string; text: string };
export type FetchOutcome = { ok: true; page: FetchedPage } | { ok: false; reason: string };

/** Fetch one page of a stranger's website, after asking their robots.txt.
 *
 *  Returns a REASON rather than throwing, because the reason is what the user sees next to a
 *  dropped lead ("their site says no crawling" is a fine thing to tell somebody). */
export async function fetchPageForResearch(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return { ok: false, reason: `not a usable web address: ${String(url).slice(0, 80)}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "not an http(s) address" };
  }

  const rules = await loadRobots(parsed.origin, fetchImpl);
  if (!robotsAllows(rules, parsed.pathname)) {
    return { ok: false, reason: `${parsed.host}/robots.txt disallows ${parsed.pathname} — we do not read it` };
  }

  const gap = Math.max(rules.crawlDelayMs, DEFAULT_HOST_GAP_MS);
  return throttled(parsed.host, gap, async () => {
    try {
      const res = await fetchImpl(parsed.toString(), {
        headers: { "User-Agent": LEADS_UA, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) return { ok: false as const, reason: `their site answered HTTP ${res.status}` };
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html")) return { ok: false as const, reason: `not a web page (${type.split(";")[0] || "unknown type"})` };

      const html = await res.text();
      const $ = cheerio.load(html);
      $("script, style, noscript, svg, iframe").remove();
      const title = $("title").first().text().trim() || $("h1").first().text().trim() || parsed.host;
      // Kept generous (12k) because the personalisation node needs the ACTUAL words on the page
      // to check a quote against; a 4k slice loses the "we opened our second branch" line that
      // is the whole point of reading it.
      // cheerio's .text() concatenates without regard for layout, so "<h1>Al Safa</h1><p>Lebanese
      // food</p>" comes back as "Al SafaLebanese food" — two real words welded into a third that
      // exists nowhere on the page. The personalisation node quotes this text back at the
      // prospect, so a glued word is a lie in an email. Put a space after every block element
      // before flattening.
      $("body").find("p, div, br, li, tr, td, section, article, header, footer, nav, h1, h2, h3, h4, h5, h6").after(" ");
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12_000);
      if (!text) return { ok: false as const, reason: "their page has no readable text (probably a JavaScript app)" };
      return { ok: true as const, page: { url: parsed.toString(), title, text } };
    } catch (e: any) {
      return { ok: false as const, reason: `could not reach their site (${String(e?.message ?? e).slice(0, 80)})` };
    }
  });
}

// ── source 1 · OpenStreetMap / Nominatim (free, wired) ──────────────────────────────────────

const NOMINATIM_HOST = "nominatim.openstreetmap.org";
/** Their Usage Policy: absolute maximum of 1 request per second. We use 1.2s of margin. */
const NOMINATIM_GAP_MS = 1200;

export function osmConfigured(): boolean {
  return true; // no key, no account — that is the point of it
}

/** Businesses of one kind in one place, from OpenStreetMap.
 *
 *  Nominatim is a geocoder, so the query is free text ("restaurant in Dubai") and the answer is
 *  places with an `extratags` block that often carries website and phone. Anything absent is
 *  null — a missing website is a real fact about a business, and the pipeline drops that lead
 *  with "nothing to read" rather than inventing a domain from the name. */
export async function osmSearch(icp: Icp, limit: number, fetchImpl: typeof fetch = fetch): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const term of icp.searchTerms) {
    if (out.length >= limit) break;
    const key = `osm:${term.toLowerCase()}:${limit}`;
    const hit = cached<Candidate[]>(key);
    const rows =
      hit ??
      (await throttled(NOMINATIM_HOST, NOMINATIM_GAP_MS, async () => {
        const url =
          `https://${NOMINATIM_HOST}/search?` +
          new URLSearchParams({
            q: term,
            format: "jsonv2",
            addressdetails: "1",
            extratags: "1",
            namedetails: "1",
            limit: String(Math.min(50, Math.max(10, limit * 3))),
          }).toString();
        try {
          const res = await fetchImpl(url, {
            headers: { "User-Agent": LEADS_UA, "Accept-Language": "en" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: any = await res.json();
          return Array.isArray(json) ? json.map(toCandidate).filter(Boolean as any as (c: Candidate | null) => c is Candidate) : [];
        } catch (e: any) {
          console.warn(`[leads/osm] "${term}" failed:`, e?.message);
          return [] as Candidate[];
        }
      }));

    if (!hit) remember(key, rows);

    for (const c of rows) {
      const dedupeKey = c.domain ?? `${c.name.toLowerCase()}|${c.address ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(c);
      if (out.length >= limit) break;
    }
  }

  return out;
}

function toCandidate(row: any): Candidate | null {
  const name = String(row?.namedetails?.name ?? row?.name ?? "").trim() || String(row?.display_name ?? "").split(",")[0].trim();
  if (!name) return null;
  const tags = row?.extratags ?? {};
  const website = firstString(tags.website, tags["contact:website"], tags.url);
  const phone = firstString(tags.phone, tags["contact:phone"], tags["contact:mobile"]);
  const categories = [row?.category, row?.type, tags.amenity, tags.shop, tags.cuisine].map((v: unknown) => String(v ?? "").trim()).filter(Boolean);

  return {
    name,
    website: website ?? null,
    domain: domainOf(website),
    phone: phone ?? null,
    address: String(row?.display_name ?? "").trim() || null,
    categories: [...new Set(categories)],
    source: "osm",
    sourceRef: row?.osm_type && row?.osm_id ? `${row.osm_type}/${row.osm_id}` : null,
    attribution: OSM_ATTRIBUTION,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return null;
}

// ── source 2 · Google Places (SEAM) ─────────────────────────────────────────────────────────

/** GOOGLE_PLACES_API_KEY — read from process.env directly and not from src/env.ts, because
 *  env.ts is a shared file and this source is not wired yet; move it there in the same commit
 *  that wires it.
 *
 *  WHAT WIRING IT LOOKS LIKE (Places API "New", the only one taking new projects):
 *
 *      POST https://places.googleapis.com/v1/places:searchText
 *      X-Goog-Api-Key: <key>
 *      X-Goog-FieldMask: places.displayName,places.websiteUri,places.nationalPhoneNumber,
 *                        places.formattedAddress,places.types,places.id
 *      { "textQuery": "<icp.searchTerms[0]>", "maxResultCount": 20,
 *        "locationBias": { "circle": { "center": {...}, "radius": 20000 } } }
 *
 *  Map `displayName.text` → name, `websiteUri` → website, `nationalPhoneNumber` → phone,
 *  `types` → categories, `id` → sourceRef. Billing is per request and per field mask, so the
 *  mask above is the minimum this pipeline needs — widening it costs money per call.
 *
 *  It stays a seam because a wrong field mask is billable and there is no test account here to
 *  prove one against. `wired: false` is the honest answer, and the run says so out loud. */
export function placesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

// ── source 3 · Apollo (SEAM) ────────────────────────────────────────────────────────────────

/** APOLLO_API_KEY — the B2B half of §17.4: companies rather than shops.
 *
 *  WHAT WIRING IT LOOKS LIKE:
 *
 *      POST https://api.apollo.io/api/v1/mixed_companies/search
 *      X-Api-Key: <key>
 *      { "q_organization_keyword_tags": [industry], "organization_locations": [geo],
 *        "organization_num_employees_ranges": ["11,50"], "per_page": 25 }
 *
 *  Two things must be true before this is switched on, and neither is code:
 *   · credits are checked BEFORE the run and a run that would exhaust them stops with
 *     `code: "quota"` and no retry (plan §20.1 — retrying does not buy credits);
 *   · contact emails from Apollo still go through `compliance.emailIsBusinessContact`. A
 *     database saying an address exists is not the same as a business publishing it, and the
 *     rule in this product is the second one. */
export function apolloConfigured(): boolean {
  return !!process.env.APOLLO_API_KEY;
}

// ── the discovery layer ─────────────────────────────────────────────────────────────────────

export type DiscoverDeps = { fetchImpl?: typeof fetch };

/** Ask every source that can answer, in order of what this ICP needs, and report on the ones
 *  that could not. Never throws: a source that fails is a report line, not a dead run. */
export async function discover(icp: Icp, limit: number, deps: DiscoverDeps = {}): Promise<DiscoverResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const reports: SourceReport[] = [];
  const candidates: Candidate[] = [];

  // Google Places, first choice for local when it is ever wired — reported before OSM runs so
  // the user can see the better source was skipped and why.
  reports.push({
    id: "places",
    label: "Google Places",
    configured: placesConfigured(),
    wired: false,
    envVars: ["GOOGLE_PLACES_API_KEY"],
    used: false,
    found: 0,
    note: placesConfigured()
      ? "key is set but the Places adapter is not wired yet — using OpenStreetMap instead"
      : "no GOOGLE_PLACES_API_KEY — using OpenStreetMap instead",
  });

  reports.push({
    id: "apollo",
    label: "Apollo",
    configured: apolloConfigured(),
    wired: false,
    envVars: ["APOLLO_API_KEY"],
    used: false,
    found: 0,
    note: apolloConfigured()
      ? "key is set but the Apollo adapter is not wired yet"
      : "no APOLLO_API_KEY — B2B contact search is unavailable on this install",
  });

  let osmFound = 0;
  let osmNote = "OpenStreetMap, free and keyless";
  try {
    // Over-fetch: research drops the ones with no website, and the ceiling drops duplicates
    // per domain, so asking for exactly `limit` here reliably returns fewer than `limit`.
    const rows = await osmSearch(icp, Math.min(60, Math.max(limit * 3, 10)), fetchImpl);
    candidates.push(...rows);
    osmFound = rows.length;
    if (!rows.length) {
      osmNote =
        icp.kind === "b2b"
          ? "OpenStreetMap is a map: it knows shops and offices with an address, not software companies. Nothing found."
          : "OpenStreetMap knows nothing here — try a different area or a broader category.";
    }
  } catch (e: any) {
    osmNote = `OpenStreetMap failed: ${String(e?.message ?? e).slice(0, 120)}`;
  }

  reports.push({
    id: "osm",
    label: "OpenStreetMap",
    configured: true,
    wired: true,
    envVars: [],
    used: true,
    found: osmFound,
    note: osmNote,
  });

  return { candidates, reports };
}

/** One line per source for the agent's output and the chat card. */
export function describeSources(reports: readonly SourceReport[]): string[] {
  return reports.map((r) => `${r.label}: ${r.used ? `${r.found} found` : "skipped"} — ${r.note}`);
}
