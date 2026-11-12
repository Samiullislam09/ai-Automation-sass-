import { getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/** Turn a lead's phone number into something WhatsApp can be asked about.
 *
 *  A scraped or Maps number is usually written locally ("0501234567", "(800) 259-1264"), without a
 *  country code. The lead's COUNTRY (a name, e.g. "United Arab Emirates") is what turns that into an
 *  international number. We never guess a country: no country and no "+" means "cannot tell", and the
 *  caller then leaves the WhatsApp button alone.
 *
 *  Number TYPE matters too. A toll-free (800 / 1800), premium-rate or shared-cost line can never have
 *  a WhatsApp account, so those are a firm "no" without asking anyone. A normal landline is NOT decided
 *  here: some businesses do run WhatsApp Business on a landline, so only WhatsApp itself can say. */

// Names people (and Google Maps) use that Intl's own English region names do not.
const ALIASES: Record<string, string> = {
  uae: "AE", "u.a.e": "AE", emirates: "AE",
  usa: "US", "u.s.a": "US", "u.s": "US", "united states of america": "US", america: "US",
  uk: "GB", "u.k": "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  "south korea": "KR", korea: "KR", "republic of korea": "KR", russia: "RU", vietnam: "VN", "viet nam": "VN",
  turkey: "TR", turkiye: "TR", "türkiye": "TR", "czech republic": "CZ", czechia: "CZ", "ivory coast": "CI",
  palestine: "PS", "hong kong": "HK", macau: "MO", macao: "MO", taiwan: "TW", iran: "IR", syria: "SY", laos: "LA",
  brunei: "BN", myanmar: "MM", burma: "MM", eswatini: "SZ", swaziland: "SZ", "cape verde": "CV",
  "north macedonia": "MK", macedonia: "MK", "dr congo": "CD", "democratic republic of the congo": "CD",
  "republic of the congo": "CG", "the netherlands": "NL", holland: "NL", "the philippines": "PH",
};

let byName: Map<string, CountryCode> | null = null;
function names(): Map<string, CountryCode> {
  if (byName) return byName;
  const m = new Map<string, CountryCode>();
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* old runtime: aliases only */ }
  for (const c of getCountries()) {
    const n = dn?.of(c);
    if (n && n !== c) m.set(n.toLowerCase(), c);
  }
  for (const [k, v] of Object.entries(ALIASES)) m.set(k, v as CountryCode);
  byName = m;
  return m;
}

/** "United Arab Emirates" / "UAE" / "ae" -> "AE". undefined when we do not know. */
export function countryIso(name: string | null | undefined): CountryCode | undefined {
  const n = String(name ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!n) return undefined;
  const hit = names().get(n);                                  // names and aliases first ("uk" is GB, not a code)
  if (hit) return hit;
  if (/^[a-z]{2}$/.test(n)) return getCountries().includes(n.toUpperCase() as CountryCode) ? (n.toUpperCase() as CountryCode) : undefined;
  return undefined;
}

// Line types that cannot carry a WhatsApp account.
const NEVER_ON_WHATSAPP = new Set(["TOLL_FREE", "PREMIUM_RATE", "SHARED_COST", "UAN", "PAGER", "VOICEMAIL"]);

export type NumberInfo = {
  /** Full international digits, no "+" (what WhatsApp is asked about), or null when the number cannot be
   *  read safely (no country, not a valid number). */
  digits: string | null;
  /** The line type libphonenumber reports ("MOBILE", "FIXED_LINE", "TOLL_FREE", ...), when known. */
  type: string | null;
  /** True for line types that can never be on WhatsApp (toll-free, premium-rate, ...). */
  neverOnWhatsApp: boolean;
};

export function analyseNumber(raw: string | null | undefined, countryName?: string | null): NumberInfo {
  const none: NumberInfo = { digits: null, type: null, neverOnWhatsApp: false };
  let s = String(raw ?? "").trim();
  if (!s) return none;
  if (/^00\d/.test(s)) s = "+" + s.slice(2); // 00971... is the international prefix written out
  const p = parsePhoneNumberFromString(s, s.startsWith("+") ? undefined : countryIso(countryName));
  if (!p || !p.isValid()) return none;
  const type = p.getType() ?? null;
  return { digits: p.number.replace(/^\+/, ""), type, neverOnWhatsApp: type != null && NEVER_ON_WHATSAPP.has(type) };
}

// ── deciding which leads are on WhatsApp ──────────────────────────────────────────────────────

export type WaStatus = "yes" | "no" | null;
export type LeadWaRow = { id: string; phone: string | null; whatsapp?: string | null; country?: string | null; wa_status?: WaStatus; wa_checked_at?: string | null; stage?: string | null; replied_at?: string | null };

/** Stages a lead only reaches after WhatsApp actually delivered something to it, or it wrote back. */
const PROVEN_ON_WHATSAPP = new Set(["delivered", "read", "replied", "in_conversation", "interested", "meeting_requested", "won"]);
export const RECHECK_NO_AFTER_MS = 30 * 86_400_000;

export type WaPlan = {
  /** What we already know about each lead (null = still unknown, possibly because it is in `ask`). */
  statuses: Record<string, WaStatus>;
  /** Definite answers reached without asking WhatsApp (toll-free ...), to be stored on the lead. */
  toStore: Record<string, "yes" | "no">;
  /** international digits -> the leads that have that number, to be asked of WhatsApp in one batch. */
  ask: Map<string, string[]>;
};

/** Evidence order, strongest first: the lead's own site published a wa.me number; an answer already stored
 *  (a "no" is looked at again after 30 days, a "yes" is kept); a toll-free / premium line (never on WhatsApp);
 *  otherwise the number made international with the lead's country, to be asked of WhatsApp. `stored` says
 *  whether wa_status exists in the database (migration 038); when it does not, nothing is reused. */
export function planWaCheck(rows: LeadWaRow[], opts: { stored: boolean; now?: number }): WaPlan {
  const now = opts.now ?? Date.now();
  const plan: WaPlan = { statuses: {}, toStore: {}, ask: new Map() };
  for (const l of rows) {
    if (l.whatsapp) { plan.statuses[l.id] = "yes"; continue; }
    // Proof beats any lookup: a message was delivered or read, or they wrote to us. (Looking the raw number up
    // again would only risk a false "no" for a number written without its country code.)
    if (l.replied_at || (l.stage && PROVEN_ON_WHATSAPP.has(l.stage))) { plan.statuses[l.id] = "yes"; if (opts.stored && l.wa_status !== "yes") plan.toStore[l.id] = "yes"; continue; }
    if (opts.stored && l.wa_status === "yes") { plan.statuses[l.id] = "yes"; continue; }
    if (opts.stored && l.wa_status === "no" && l.wa_checked_at && now - new Date(l.wa_checked_at).getTime() < RECHECK_NO_AFTER_MS) { plan.statuses[l.id] = "no"; continue; }
    if (!l.phone) { plan.statuses[l.id] = null; continue; }
    const n = analyseNumber(l.phone, l.country);
    if (n.neverOnWhatsApp) { plan.statuses[l.id] = "no"; plan.toStore[l.id] = "no"; continue; }
    plan.statuses[l.id] = null;
    if (n.digits) plan.ask.set(n.digits, [...(plan.ask.get(n.digits) ?? []), l.id]);
  }
  return plan;
}

/** Fold WhatsApp's answers (digits -> true / false / null) into the plan. null means "could not tell"
 *  (not connected, the check failed): the lead stays unknown and nothing is stored for it. */
export function applyWaResults(plan: WaPlan, results: Record<string, boolean | null | undefined>): WaPlan {
  const statuses = { ...plan.statuses };
  const toStore = { ...plan.toStore };
  plan.ask.forEach((leadIds, digits) => {
    const v = results[digits];
    if (typeof v !== "boolean") return;
    for (const id of leadIds) { statuses[id] = v ? "yes" : "no"; toStore[id] = v ? "yes" : "no"; }
  });
  return { statuses, toStore, ask: plan.ask };
}
