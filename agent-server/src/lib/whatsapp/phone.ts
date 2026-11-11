import { getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/** The number to dial on WhatsApp for a lead.
 *
 *  Leads from Maps / the web carry LOCAL numbers ("0501234567", "(402) 371-8100"). WhatsApp wants the full
 *  international digits, and the old code sent the local digits as they were, so the number looked up was
 *  wrong, WhatsApp said "not on WhatsApp", and a perfectly good lead was marked invalid. The lead's country
 *  turns a local number into an international one. We never guess a country: no country and no "+" means
 *  "cannot tell", and the lead is left alone rather than sent to the wrong person.
 *
 *  (The web app has the same logic in lib/phone-wa.ts; the two deploy separately, so each keeps its copy.) */

const ALIASES: Record<string, string> = {
  uae: "AE", "u.a.e": "AE", emirates: "AE",
  usa: "US", "u.s.a": "US", "u.s": "US", "united states of america": "US", america: "US",
  uk: "GB", "u.k": "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  "south korea": "KR", korea: "KR", russia: "RU", vietnam: "VN", "viet nam": "VN", turkey: "TR", turkiye: "TR",
  "czech republic": "CZ", czechia: "CZ", "ivory coast": "CI", palestine: "PS", "hong kong": "HK", taiwan: "TW", iran: "IR",
};

let byName: Map<string, CountryCode> | null = null;
function names(): Map<string, CountryCode> {
  if (byName) return byName;
  const m = new Map<string, CountryCode>();
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* aliases only */ }
  for (const c of getCountries()) { const n = dn?.of(c); if (n && n !== c) m.set(n.toLowerCase(), c); }
  for (const [k, v] of Object.entries(ALIASES)) m.set(k, v as CountryCode);
  byName = m;
  return m;
}

export function countryIso(name: string | null | undefined): CountryCode | undefined {
  const n = String(name ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!n) return undefined;
  const hit = names().get(n);
  if (hit) return hit;
  if (/^[a-z]{2}$/.test(n)) return getCountries().includes(n.toUpperCase() as CountryCode) ? (n.toUpperCase() as CountryCode) : undefined;
  return undefined;
}

const NEVER_ON_WHATSAPP = new Set(["TOLL_FREE", "PREMIUM_RATE", "SHARED_COST", "UAN", "PAGER", "VOICEMAIL"]);

export type Dial =
  | { ok: true; digits: string }
  | { ok: false; reason: "no number" | "unknown country or invalid number" | "toll-free or premium line" };

/** `whatsapp` is a number the lead's own site published on a wa.me link: already international digits,
 *  trusted first. `phone` is the listing number, made international with `country`. */
export function leadDialDigits(lead: { whatsapp?: string | null; phone?: string | null; country?: string | null }): Dial {
  const wa = String(lead.whatsapp ?? "").replace(/[^\d]/g, "");
  if (wa.length >= 8) return { ok: true, digits: wa };
  let s = String(lead.phone ?? "").trim();
  if (!s) return { ok: false, reason: "no number" };
  if (/^00\d/.test(s)) s = "+" + s.slice(2);
  const p = parsePhoneNumberFromString(s, s.startsWith("+") ? undefined : countryIso(lead.country));
  if (!p || !p.isValid()) return { ok: false, reason: "unknown country or invalid number" };
  const type = p.getType();
  if (type && NEVER_ON_WHATSAPP.has(type)) return { ok: false, reason: "toll-free or premium line" };
  return { ok: true, digits: p.number.replace(/^\+/, "") };
}
