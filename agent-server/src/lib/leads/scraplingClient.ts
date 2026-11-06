/** The Node side of the Leads page reader (scrapling-service/, a separate Python service).
 *
 *  WHY A SEPARATE SERVICE, NOT A LIBRARY IMPORT. Scrapling is Python; this agent is Node. Running
 *  it as its own Railway service means a crash or a memory spike there cannot take this agent (or
 *  any other agent on the same process) down with it, and it can be scaled or redeployed on its
 *  own schedule.
 *
 *  OPT-IN, WITH A FALLBACK. `SCRAPLING_SERVICE_URL` unset ⇒ `readPage` is never called and the
 *  pipeline keeps using sources.fetchPageForResearch (cheerio) exactly as before — this file adds
 *  a capability, it does not replace the default until the service is actually deployed. On a
 *  real failure (timeout, 5xx, network error) the caller falls back to cheerio for that one page
 *  rather than losing the lead to an infrastructure hiccup.
 *
 *  WHAT THE SERVICE WILL NOT DO (see its own app.py header): no browser automation, no anti-bot
 *  evasion, no reading of robots.txt-disallowed pages, no social/directory/job-board sources.
 *  Those rules live there so there is exactly one place honouring them, not two that could drift.
 */
import type { Candidate, FetchOutcome } from "./sources.js";

export type ScraplingFacts = {
  name: string | null;
  emails: string[];
  phones: string[];
  whatsapp: string | null;
};

export type ScraplingReadResult =
  | { ok: true; page: { url: string; title: string; text: string }; facts: ScraplingFacts }
  // `transport: true` = the SERVICE could not be reached at all (down, network error, bad HTTP
  // status) — the caller falls back to cheerio for this one page. `transport: false` = the
  // service reached the site and gave a real, final answer (robots.txt disallows it, the site
  // is down, no readable text) — that answer stands; a different reader asking does not change
  // what the stranger's server or robots.txt said.
  | { ok: false; reason: string; transport: boolean };

function serviceUrl(): string | null {
  const u = (process.env.SCRAPLING_SERVICE_URL ?? "").trim().replace(/\/+$/, "");
  return u || null;
}

export function scraplingConfigured(): boolean {
  return !!serviceUrl();
}

/** Country hint for phone parsing (ISO 3166-1 alpha-2) — best-effort from the candidate's own
 *  country field; a wrong or absent hint only affects which number formats are tried, it never
 *  invents a number that was not on the page. */
function countryHint(candidate: Candidate | undefined): string | undefined {
  const c = (candidate?.country ?? "").toLowerCase();
  const map: [RegExp, string][] = [
    [/united arab emirates/, "AE"], [/saudi arabia/, "SA"], [/qatar/, "QA"], [/kuwait/, "KW"],
    [/oman/, "OM"], [/bahrain/, "BH"], [/india/, "IN"], [/pakistan/, "PK"],
    [/united kingdom/, "GB"], [/united states/, "US"], [/singapore/, "SG"], [/canada/, "CA"],
    [/australia/, "AU"],
  ];
  for (const [re, code] of map) if (re.test(c)) return code;
  return undefined;
}

const TIMEOUT_MS = 15_000;

/** Reads one page through the Scrapling service. Returns the same `FetchOutcome` shape as
 *  `fetchPageForResearch` so the pipeline's `research()` node does not need to know which reader
 *  answered, plus the extra `facts` (email/phone/WhatsApp/name) the service already parsed out —
 *  reusing its extraction instead of re-deriving the same facts from the returned text. */
export async function readPageViaScrapling(
  url: string,
  candidate: Candidate | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ScraplingReadResult | null> {
  const base = serviceUrl();
  if (!base) return null; // not configured: caller falls back to the default reader

  const token = (process.env.SCRAPLING_SERVICE_TOKEN ?? "").trim();
  try {
    const res = await fetchImpl(`${base}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, country_hint: countryHint(candidate) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, reason: `the page reader answered HTTP ${res.status}`, transport: true };
    }
    const data: any = await res.json();
    if (!data?.ok) {
      return { ok: false, reason: String(data?.reason ?? "the page reader could not read this site"), transport: false };
    }
    return {
      ok: true,
      page: { url: String(data.url ?? url), title: String(data.title ?? ""), text: String(data.text ?? "") },
      facts: {
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
        emails: Array.isArray(data.emails) ? data.emails.map((e: unknown) => String(e)) : [],
        phones: Array.isArray(data.phones) ? data.phones.map((p: unknown) => String(p)) : [],
        whatsapp: typeof data.whatsapp === "string" && data.whatsapp.trim() ? data.whatsapp.trim() : null,
      },
    };
  } catch (e: any) {
    return { ok: false, reason: `could not reach the page reader (${String(e?.message ?? e).slice(0, 100)})`, transport: true };
  }
}

/** `fetchPageForResearch`-compatible wrapper: tries the Scrapling service first (when configured),
 *  falls back to `fallback` (sources.fetchPageForResearch) on misconfiguration or failure — so a
 *  deploy with the service down degrades to the old behaviour instead of losing every lead. */
export function makeScraplingAwareFetcher(
  fallback: (url: string) => Promise<FetchOutcome>,
  candidateFor: (url: string) => Candidate | undefined,
  fetchImpl: typeof fetch = fetch,
): (url: string) => Promise<FetchOutcome> {
  return async (url: string): Promise<FetchOutcome> => {
    const viaScrapling = await readPageViaScrapling(url, candidateFor(url), fetchImpl);
    if (viaScrapling === null) return fallback(url); // service not configured
    if (viaScrapling.ok) return { ok: true, page: viaScrapling.page };
    if (viaScrapling.transport) return fallback(url); // the service itself is unreachable
    // The service reached the site and gave a real, final answer about THIS page (robots.txt
    // disallows it, the site is down, no readable text) — stands, whichever reader asked it.
    return { ok: false, reason: viaScrapling.reason };
  };
}
