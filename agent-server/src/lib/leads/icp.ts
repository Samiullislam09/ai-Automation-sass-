/** The Ideal Customer Profile — who Mr. Lead is allowed to go looking for.
 *
 *  Rebuild plan §17.4 step 1 and §20.3: every other node in the pipeline reads this and
 *  nothing else. Discovery searches for it, qualification scores against it, and the draft may
 *  only claim what the `offering` + `proof` fields say we can honestly claim.
 *
 *  ONE RULE, the same one the Site Brain lives under (lib/siteProfile.ts):
 *
 *      An ICP field is EVIDENCE or it is absent.
 *
 *  It comes from the Site Brain (built by Mr. Analyst from the tenant's own pages) or from
 *  what the user typed, and every field records which. Nothing is guessed. With neither
 *  source, `buildIcp` returns `{ ok: false }` with the question that has to be asked — not a
 *  plausible-looking profile. Guessing here is the expensive kind of wrong: it would send a
 *  stranger a message about a business we invented.
 *
 *  The query parser below is deliberately dumb and deterministic (regexes, word lists, no
 *  model). A model in this position would happily read "Dubai ke restaurant" as
 *  "hospitality sector, UAE, mid-market" and we would never know which half it made up.
 */

import type { Offering, Proof, SiteProfile } from "../siteProfile.js";

// ── the shape ───────────────────────────────────────────────────────────────────────────────

/** Local businesses (Google Places / OpenStreetMap territory) vs companies (Apollo territory).
 *  It decides which source can answer, and how a message may open. */
export type IcpKind = "local" | "b2b";

/** Where a field came from. Printed in `evidence` so a user can see why we searched for what
 *  we searched for, and correct the one field that is wrong instead of the whole thing. */
export type IcpSource = "user-query" | "site-brain" | "default";

export type IcpEvidence = { field: string; value: string; from: IcpSource };

export type Icp = {
  kind: IcpKind;
  /** The vertical we are hunting — "restaurant", "dental clinic", "logistics company". */
  industry: string;
  /** Town, city or region. Null means "no geographic constraint", which is a real answer for
   *  B2B and is scored as such (see pipeline.qualify) — it is never filled in with a guess. */
  geo: string | null;
  /** "10+ staff", "3 branches" — parsed out of the query, never inferred from the vertical. */
  sizeSignals: SizeSignal[];
  /** What the TENANT sells. The draft's one sales line has to come from this list. */
  offering: Offering[];
  /** The only facts about the tenant a draft is allowed to state (compliance.checkClaims). */
  proof: Proof[];
  /** The tenant's own audience line from the Site Brain, kept for the draft's tone. */
  audience: string | null;
  language: string | null;
  /** How many leads were asked for, clamped to something a free tier can actually pay for. */
  count: number;
  /** What discovery types into a search box. Ordered: most specific first. */
  searchTerms: string[];
  evidence: IcpEvidence[];
};

export type SizeSignal = {
  /** The words as the user typed them: "10+ staff". */
  text: string;
  /** Parsed so qualification can compare rather than string-match. */
  min: number;
  unit: string;
};

/** What is missing when we cannot build one. Each maps to exactly one question. */
export type IcpGap = "industry" | "geo" | "offering";

export type IcpResult =
  | { ok: true; icp: Icp; warnings: string[] }
  | { ok: false; missing: IcpGap[]; question: string };

export type BuildIcpInput = {
  profile?: SiteProfile | null;
  /** Whatever the user typed, verbatim. */
  query?: string | null;
  count?: number | null;
};

// ── tuning, all in one place ────────────────────────────────────────────────────────────────

/** A free NIM tier does ~60 LLM calls for 20 leads (plan §20.3 "cost per run"). 25 is the most
 *  a single run may ask for; the compliance ceiling (compliance.ts POLICY) is the harder stop. */
export const MAX_COUNT = 25;
export const DEFAULT_COUNT = 15;

/** Verticals that are, by their nature, a shop on a street. Matching one means a map source
 *  (OSM/Places) can answer and a B2B contact database mostly cannot. */
const LOCAL_VERTICALS =
  /\b(restaurant|cafe|caf[eé]|coffee|bakery|bar|pub|hotel|hostel|resort|salon|barber|spa|gym|fitness|yoga|clinic|dental|dentist|doctor|physio|vet|veterinary|pharmacy|plumber|plumbing|electrician|builder|contractor|garage|mechanic|car wash|laundry|cleaner|cleaning|florist|grocer|grocery|supermarket|boutique|shop|store|studio|photographer|school|nursery|daycare|driving school|tutor|realtor|estate agent|travel agency|tour operator|catering|caterer|food truck|nail|tattoo|optician)s?\b/i;

/** Verticals that are a company with a website and no front door. */
const B2B_VERTICALS =
  /\b(saas|software|agency|agencies|startup|manufacturer|manufacturing|distributor|wholesaler|consultancy|consulting|enterprise|b2b|fintech|logistics|freight|supplier|vendor|firm|company|companies|corporate)s?\b/i;

/** Words that are grammar or instruction, never the vertical. Hinglish included because that
 *  is what this product's users type (see the manifest's `phrases`). */
const NOISE = new Set([
  "find", "get", "give", "show", "search", "look", "lookup", "fetch", "need", "want", "please",
  "me", "us", "my", "our", "the", "a", "an", "some", "any", "more", "top", "best", "good",
  "lead", "leads", "prospect", "prospects", "client", "clients", "customer", "customers",
  "list", "banao", "bana", "do", "dhundo", "dhundho", "dhoondo", "nikalo", "nikal", "karo",
  "chahiye", "ke", "ki", "ka", "ko", "me", "mein", "wale", "walon", "wali", "aur", "hai",
  "for", "of", "with", "who", "that", "and", "in", "near", "around", "from", "across", "at",
  "business", "businesses",
]);

/** "10+ staff", "over 20 employees", "3 branches". */
const SIZE_RE =
  /\b(?:(?:more than|over|at least|minimum|min)\s+)?(\d{1,5})\s*\+?\s*(staff|employees|employee|people|seats|rooms|beds|branches|branch|locations|location|outlets|outlet|vehicles|trucks|years)\b/gi;

/** "in Manchester", "near Bandra", "around Austin TX" — up to three words, English word order. */
const GEO_EN_RE = /\b(?:in|near|around|from|across|based in)\s+([A-Za-zÀ-ÿ][\w'’.-]*(?:\s+[A-Za-zÀ-ÿ][\w'’.-]*){0,2})/i;

/** "Dubai ke", "Mumbai me", "Karachi ki" — Hindi/Roman-Urdu postposition, which is how half of
 *  this product's users write a place. */
const GEO_HI_RE = /\b([A-Za-zÀ-ÿ][\w'’.-]*(?:\s+[A-Za-zÀ-ÿ][\w'’.-]*)?)\s+(?:ke|ki|ka|me|mein)\b/i;

// ── the builder ─────────────────────────────────────────────────────────────────────────────

/** Build the ICP, or say what is missing.
 *
 *  Precedence is always: what the user typed NOW beats what the Site Brain knows. The user is
 *  looking at their own screen and we are reading a crawl from last week.
 *
 *  The one thing that can stop us is not knowing WHO to look for. Everything else degrades:
 *  no geography is a valid B2B search, and no offering on file simply means the draft has
 *  nothing to sell in it — which compliance enforces rather than the model improvising. */
export function buildIcp(input: BuildIcpInput): IcpResult {
  const profile = input.profile ?? null;
  const parsed = parseQuery(input.query);
  const evidence: IcpEvidence[] = [];
  const warnings: string[] = [];

  // ── industry: the only field we cannot proceed without ──────────────────────────────────
  let industry = parsed.industry;
  if (industry) {
    evidence.push({ field: "industry", value: industry, from: "user-query" });
  } else if (profile?.audience) {
    // The Site Brain's `audience` is "who this business sells to" — read off the tenant's own
    // pages by Mr. Analyst. That is the ICP's vertical, stated by the customer themselves.
    industry = clip(profile.audience, 120);
    evidence.push({ field: "industry", value: industry, from: "site-brain" });
  }

  if (!industry) {
    const missing: IcpGap[] = ["industry"];
    if (!parsed.geo && !profile?.geo) missing.push("geo");
    if (!profile?.offerings?.length) missing.push("offering");
    return {
      ok: false,
      missing,
      question:
        "I need to know who you are looking for. Tell me the kind of business (for example " +
        '"dental clinics" or "restaurants") and, if it matters, the town or city — or run the ' +
        "site crawler first so I can read it off your own website.",
    };
  }

  // ── geography ───────────────────────────────────────────────────────────────────────────
  let geo: string | null = parsed.geo;
  if (geo) {
    evidence.push({ field: "geo", value: geo, from: "user-query" });
  } else if (profile?.geo) {
    geo = clip(profile.geo, 80);
    evidence.push({ field: "geo", value: geo, from: "site-brain" });
  }

  // ── size ────────────────────────────────────────────────────────────────────────────────
  for (const s of parsed.sizeSignals) evidence.push({ field: "sizeSignals", value: s.text, from: "user-query" });

  // ── what we sell, and what we may claim while selling it ────────────────────────────────
  const offering = profile?.offerings ?? [];
  const proof = profile?.proof ?? [];
  if (offering.length) {
    evidence.push({ field: "offering", value: offering.map((o) => o.name).slice(0, 5).join(", "), from: "site-brain" });
  } else {
    // Not fatal, and deliberately not filled in: a draft with no offering is a draft that asks
    // a question instead of pitching. compliance.checkClaims is what makes that stick.
    warnings.push(
      "No offering on file from the Site Brain — the drafts will ask a question rather than pitch anything. " +
        "Run the site crawler and Mr. Analyst to fix that."
    );
  }
  if (!proof.length) {
    warnings.push(
      "No proven facts on file — the drafts may not state any credential, number or award about you, " +
        "because there is nothing here to check one against."
    );
  }

  // ── kind: which source can even answer this ─────────────────────────────────────────────
  const kind = decideKind(industry, geo);
  evidence.push({ field: "kind", value: kind, from: kindEvidence(industry, geo) });

  // ── how many ────────────────────────────────────────────────────────────────────────────
  const asked = Number(input.count ?? parsed.count ?? DEFAULT_COUNT);
  const count = Math.max(1, Math.min(MAX_COUNT, Number.isFinite(asked) ? Math.round(asked) : DEFAULT_COUNT));
  if (Number.isFinite(asked) && asked > MAX_COUNT) {
    warnings.push(`Asked for ${Math.round(asked)}; ${MAX_COUNT} is the most one run will do (rate limits and the send ceiling).`);
  }

  return {
    ok: true,
    warnings,
    icp: {
      kind,
      industry,
      geo,
      sizeSignals: parsed.sizeSignals,
      offering,
      proof,
      audience: profile?.audience ?? null,
      language: profile?.language ?? null,
      count,
      searchTerms: searchTermsFor(industry, geo),
      evidence,
    },
  };
}

/** The words a discovery source is given. Most specific first, so a source that can only
 *  afford one query still asks the right one. */
export function searchTermsFor(industry: string, geo: string | null): string[] {
  const i = industry.trim();
  const terms = geo ? [`${i} in ${geo}`, `${i} ${geo}`, i] : [i, `${i} companies`];
  return [...new Set(terms.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function decideKind(industry: string, geo: string | null): IcpKind {
  if (LOCAL_VERTICALS.test(industry)) return "local";
  if (B2B_VERTICALS.test(industry)) return "b2b";
  // Falls through to geography: someone who named a town is looking at a map, someone who did
  // not is looking at a company list. Written down here rather than felt somewhere else.
  return geo ? "local" : "b2b";
}

function kindEvidence(industry: string, geo: string | null): IcpSource {
  if (LOCAL_VERTICALS.test(industry) || B2B_VERTICALS.test(industry)) return "user-query";
  return geo ? "user-query" : "default";
}

// ── the parser ──────────────────────────────────────────────────────────────────────────────

export type ParsedQuery = {
  industry: string | null;
  geo: string | null;
  sizeSignals: SizeSignal[];
  count: number | null;
};

/** Pull the four things a lead search needs out of one line of text.
 *
 *  Order matters and is the whole trick: size phrases carry numbers ("10+ staff") and would
 *  otherwise be read as the count, and the place carries words that would otherwise be read as
 *  the vertical. So each is extracted AND REMOVED, and whatever survives is the vertical. */
export function parseQuery(raw: string | null | undefined): ParsedQuery {
  const original = String(raw ?? "").trim();
  if (!original) return { industry: null, geo: null, sizeSignals: [], count: null };

  let rest = ` ${original} `;

  // 1 · size signals, with their numbers, before anything else looks at a digit.
  const sizeSignals: SizeSignal[] = [];
  for (const m of original.matchAll(SIZE_RE)) {
    const min = Number(m[1]);
    if (!Number.isFinite(min)) continue;
    sizeSignals.push({ text: m[0].trim(), min, unit: m[2].toLowerCase().replace(/s$/, "") });
    rest = rest.replace(m[0], " ");
  }

  // 2 · geography. English preposition first (unambiguous), then the Hindi postposition.
  let geo: string | null = null;
  const en = rest.match(GEO_EN_RE);
  if (en) {
    geo = trimPlace(en[1]);
    if (geo) rest = rest.replace(en[0], " ");
  }
  if (!geo) {
    const hi = rest.match(GEO_HI_RE);
    if (hi) {
      const place = trimPlace(hi[1]);
      // "leads ke" / "restaurant ke" is grammar, not a place.
      if (place && !NOISE.has(place.toLowerCase()) && !place.split(/\s+/).every((w) => NOISE.has(w.toLowerCase()))) {
        geo = place;
        rest = rest.replace(hi[0], " ");
      }
    }
  }

  // 3 · the count: any remaining standalone number, once sizes are gone.
  let count: number | null = null;
  const num = rest.match(/\b(\d{1,3})\b/);
  if (num) {
    count = Number(num[1]);
    rest = rest.replace(num[0], " ");
  }

  // 4 · whatever is left, minus the instruction words, is the vertical.
  const words = rest
    .replace(/[^\p{L}\p{N}\s'’-]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => !NOISE.has(w.toLowerCase()));

  const industry = words.length ? clip(words.join(" "), 120) : null;

  return { industry, geo, sizeSignals, count };
}

/** A place name is at most three words and never ends on a noise word ("in Dubai ke 20" →
 *  "Dubai"). Also drops a trailing "ke/ki/ka/me" that the English regex may have swallowed. */
function trimPlace(raw: string): string | null {
  const words = String(raw ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'’.-]/gu, "").trim())
    .filter(Boolean);
  while (words.length && NOISE.has(words[words.length - 1].toLowerCase())) words.pop();
  while (words.length && NOISE.has(words[0].toLowerCase())) words.shift();
  if (!words.length) return null;
  return words.slice(0, 3).join(" ");
}

/** One line describing the ICP, for a log or a chat card. Never invents a field it does not
 *  have — an absent geography simply does not appear. */
export function describeIcp(icp: Icp): string {
  const bits = [icp.industry];
  if (icp.geo) bits.push(`in ${icp.geo}`);
  if (icp.sizeSignals.length) bits.push(`(${icp.sizeSignals.map((s) => s.text).join(", ")})`);
  return `${icp.count} × ${bits.join(" ")} [${icp.kind}]`;
}

function clip(s: string, max: number): string {
  const v = String(s ?? "").trim().replace(/\s+/g, " ");
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}
