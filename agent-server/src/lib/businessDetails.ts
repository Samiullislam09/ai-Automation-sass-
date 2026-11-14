/** The business's own contact details, read off its own website — and only what the site actually prints.
 *
 *  Address, phone, email, WhatsApp, opening hours and licence/registration number are the things a customer
 *  asks for on WhatsApp ("where is your office?", "what's your number?", "are you licensed?"). They are
 *  printed on every business site — in the footer, on /contact, in the privacy policy — yet the Site Brain
 *  held none of them, so the assistant could only answer by luck (a paragraph of a legal page happening to be
 *  retrieved) or had to hand the customer to a person.
 *
 *  THE RULE IS THE SAME AS FOR PRICE (lib/pricing.ts): nothing is accepted unless the site prints it.
 *   · email and phone are found by pattern, never by a model: a model can write a plausible number, a pattern
 *     can only find one that is there. Phones are validated as real numbers (libphonenumber).
 *   · address, hours and registration need reading ("Company: WCA GLOBAL, B21-057, SRTI Park, Sharjah, UAE" is
 *     an address; "9-6 Sun-Thu" is hours), so a model reads short excerpts — and then EVERY word of what it
 *     returns must be found inside a single page's text. Whatever fails that is discarded.
 *
 *  The crawled text has no spaces between page elements ("Call+971 4 123 4567Email info@x.comPrivacy"), which
 *  is why email domains are trimmed back to a known top-level domain and why the grounding check works on
 *  words, not on exact strings.
 *
 *  Pure apart from `detectBusinessDetails`, which takes the model call as a parameter. */
import { findPhoneNumbersInText } from "libphonenumber-js";
import type { BusinessDetails } from "./siteProfile.js";

export type DetailPage = { url: string; title?: string | null; text: string };
export type DetailsFinding = { details: BusinessDetails; sources: string[] };

export const emptyDetails = (): BusinessDetails => ({ address: null, phone: null, email: null, whatsapp: null, hours: null, registration: null });
export const hasAnyDetail = (d: BusinessDetails | null | undefined) => !!d && Object.values(d).some((v) => typeof v === "string" && v.trim());

/* ── email ───────────────────────────────────────────────────────────────────────────────── */

const TLDS = new Set((
  "com net org info biz co io ai app dev me tv cc shop store online site tech cloud agency solutions services global " +
  "ae sa qa kw bh om eg jo lb iq ir tr il pk in bd lk np af uk ie fr de es it nl be ch at se no dk fi pl pt gr ru ua " +
  "us ca mx br ar cl co za ng ke gh tz ug et ma tn dz au nz sg my ph id th vn hk cn jp kr tw edu gov mil int eu asia"
).split(/\s+/));

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const BAD_LOCAL = new Set(["noreply", "no-reply", "donotreply", "do-not-reply", "example", "test", "name", "email", "your", "user", "username", "yourname", "youremail", "john", "jane", "someone", "mail"]);
const BAD_DOMAIN = /(^|\.)(example|email|domain|test|yourdomain|sentry|wixpress|sentry-next\.wixpress|godaddy|squarespace|wordpress|gravatar)\.(com|io|net|org)$/;
const PREFERRED_LOCAL = /^(info|contact|hello|sales|support|enquir(y|ies)|admin|office|care|team|mail)$/;
// crawled text glues labels to the address: "Emailinfo@x.com" — strip a label that is never part of one
const GLUED_LABEL = /^(e-?mail(us)?|mailto|mail|contactus|writeto|sendto)(?=[a-z0-9])/;

/** One raw regex hit -> a clean address, or null if it is not one. */
export function cleanEmail(raw: string): string | null {
  const lower = String(raw).toLowerCase();
  const at = lower.indexOf("@");
  if (at < 1) return null;
  let local = lower.slice(0, at).replace(/^[._%+-]+|[._%+-]+$/g, "").replace(GLUED_LABEL, "");
  const labels = lower.slice(at + 1).split(".").filter(Boolean);
  if (labels.length < 2) return null;
  // The text after the address runs straight on ("info@wca-global.comPrivacy"): cut the last label back to the
  // longest known top-level domain it begins with. A label that begins with none is not an address (logo@2x.png).
  const last = labels[labels.length - 1];
  let tld = TLDS.has(last) ? last : null;
  if (!tld) for (const t of TLDS) if (last.startsWith(t) && t.length > (tld?.length ?? 0)) tld = t;
  if (!tld) return null;
  labels[labels.length - 1] = tld;
  const domain = labels.join(".");
  if (!local || BAD_LOCAL.has(local) || BAD_DOMAIN.test(domain) || /\.(png|jpe?g|gif|svg|webp|css|js)$/.test(domain)) return null;
  if (local.length > 40 || !/[a-z]/.test(local)) return null;
  return `${local}@${domain}`;
}

const hostOf = (url: string | null | undefined) => {
  try { return new URL(/^https?:\/\//i.test(String(url)) ? String(url) : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

/** The best contact email on the site: the one printed on the most pages, preferring one at the site's own
 *  domain and a generic mailbox (info@, contact@) over a person's. */
export function pickEmail(pages: DetailPage[], siteUrl: string | null): { email: string; urls: string[] } | null {
  const host = hostOf(siteUrl);
  const seen = new Map<string, Set<string>>();
  for (const p of pages) {
    const t = String(p.text ?? "");
    // addresses live in headers, footers and contact blocks: the ends of a page, not its middle
    for (const chunk of [t.slice(0, 5000), t.length > 10000 ? t.slice(-5000) : ""]) {
      for (const m of chunk.matchAll(EMAIL_RE)) {
        const e = cleanEmail(m[0]);
        if (!e) continue;
        if (!seen.has(e)) seen.set(e, new Set());
        seen.get(e)!.add(p.url);
      }
    }
  }
  const ranked = [...seen.entries()].map(([email, urls]) => {
    const domain = email.split("@")[1];
    const own = host && (domain === host || domain.endsWith("." + host) || host.endsWith("." + domain)) ? 3 : 0;
    const generic = PREFERRED_LOCAL.test(email.split("@")[0]) ? 1 : 0;
    return { email, urls: [...urls], score: urls.size + own + generic };
  }).sort((a, b) => b.score - a.score || a.email.length - b.email.length);
  return ranked[0] ? { email: ranked[0].email, urls: ranked[0].urls.slice(0, 3) } : null;
}

/* ── phone ───────────────────────────────────────────────────────────────────────────────── */

export type PhoneHit = { display: string; e164: string; urls: string[]; whatsapp: boolean };

/** Real, international-format phone numbers printed on the site, each with the pages it appears on and whether it
 *  is labelled WhatsApp. Only "+"-prefixed numbers are read — without a country there is no honest way to say
 *  what "050 123 4567" is — and every one must be a valid number for its country. */
export function extractPhones(pages: DetailPage[]): PhoneHit[] {
  const byNumber = new Map<string, PhoneHit>();
  for (const p of pages) {
    const t = String(p.text ?? "");
    for (const chunk of [t.slice(0, 5000), t.length > 10000 ? t.slice(-5000) : ""]) {
      if (!chunk) continue;
      let found: ReturnType<typeof findPhoneNumbersInText> = [];
      // Crawled text runs elements together ("Call+971 4 345 6789Email"): the library wants a boundary on each side
      // of a number, so one is put between a letter and the "+" before it, and between the last digit and a letter.
      const spaced = chunk.replace(/([A-Za-z])(\+\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
      try { found = findPhoneNumbersInText(spaced); } catch { continue; }
      for (const f of found) {
        const n = f.number;
        if (!n.isValid()) continue;
        const around = spaced.slice(Math.max(0, f.startsAt - 40), f.endsAt + 20);
        const wa = /whats\s?app/i.test(around);
        const key = n.number;
        const hit = byNumber.get(key) ?? { display: n.formatInternational(), e164: key, urls: [], whatsapp: false };
        if (!hit.urls.includes(p.url)) hit.urls.push(p.url);
        hit.whatsapp = hit.whatsapp || wa;
        byNumber.set(key, hit);
      }
    }
  }
  return [...byNumber.values()].sort((a, b) => b.urls.length - a.urls.length);
}

/** The main phone (most pages, not labelled WhatsApp) and the WhatsApp number, if the site gives one. */
export function pickPhones(pages: DetailPage[]): { phone: PhoneHit | null; whatsapp: PhoneHit | null } {
  const all = extractPhones(pages);
  return { phone: all.find((h) => !h.whatsapp) ?? null, whatsapp: all.find((h) => h.whatsapp) ?? null };
}

/* ── address, hours, registration: read by a model, then checked ─────────────────────────── */

type Kind = "address" | "hours" | "registration";
// No word boundaries: crawled text runs elements together ("UAEOpening hours"), and a boundary would miss them.
const KEYS: Record<Kind, RegExp> = {
  address: /(address|located|location|office|visit us|find us|head ?quarters?|registered office|p\.?\s?o\.?\s?box|street|road|tower|building|floor|suite|plot|park)/i,
  hours: /(opening hours|working hours|office hours|business hours|timings?|open (daily|on|from|monday)|mon(day)?\s*(-|–|to)\s*(fri|sat|sun|thu)|closed on|sun(day)?\s*(-|–|to)\s*(thu|fri))/i,
  registration: /(licen[cs]e|trade licen|trn|vat (no|number|reg)|registration (no|number)|reg\.? ?no|company (no|number|registration)|cr ?(no|number)|registered (in|with|under)|accredited by)/i,
};
const PAGE_HINT = /contact|about|location|visit|find-?us|reach|privacy|terms|legal|imprint|disclaimer|footer|company|who-we-are|team/i;

/** The few places on the site where each kind of detail is likely to be written, most likely first. */
export function detailSnippets(pages: DetailPage[], kind: Kind, opts: { max?: number; radius?: number } = {}): { url: string; text: string }[] {
  const max = opts.max ?? 5, radius = opts.radius ?? 170;
  const scored: { url: string; text: string; score: number }[] = [];
  for (const p of pages) {
    const t = String(p.text ?? "");
    const base = (PAGE_HINT.test(p.url) ? 2 : 0) + (p.title && PAGE_HINT.test(p.title) ? 1 : 0);
    const m = KEYS[kind].exec(t);
    if (!m) continue;
    const from = Math.max(0, m.index - radius);
    scored.push({ url: p.url, text: t.slice(from, m.index + m[0].length + radius).replace(/\s+/g, " ").trim(), score: base });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: { url: string; text: string }[] = [];
  for (const s of scored) {
    const key = s.text.slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: s.url, text: s.text });
    if (out.length >= max) break;
  }
  return out;
}

const words = (s: string) => (String(s ?? "").toLowerCase().match(/[a-z0-9؀-ۿऀ-ॿ]+/g) ?? []).filter((w) => w.length >= 2 || /\d/.test(w));

/** Is every word of `value` printed on ONE page? Words, not the exact string, because the page text is unspaced
 *  and a model tidies punctuation — but across pages would let it stitch a sentence from unrelated places. */
export function groundedOn(value: string | null | undefined, pages: DetailPage[]): string | null {
  const ws = words(String(value ?? ""));
  if (!ws.length) return null;
  for (const p of pages) {
    const t = String(p.text ?? "").toLowerCase();
    if (ws.every((w) => t.includes(w))) return p.url;
  }
  return null;
}

const cleanText = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "none" ? s.slice(0, max) : null;
};

export type CompleteFn = (prompt: string) => Promise<any>;

/** Everything the site prints about how to find and verify the business. Returns null when it prints none. */
export async function detectBusinessDetails(pages: DetailPage[], siteUrl: string | null, complete: CompleteFn): Promise<DetailsFinding | null> {
  const details = emptyDetails();
  const sources = new Set<string>();

  const email = pickEmail(pages, siteUrl);
  if (email) { details.email = email.email; email.urls.forEach((u) => sources.add(u)); }

  const { phone, whatsapp } = pickPhones(pages);
  if (phone) { details.phone = phone.display; phone.urls.slice(0, 2).forEach((u) => sources.add(u)); }
  if (whatsapp) { details.whatsapp = whatsapp.display; whatsapp.urls.slice(0, 2).forEach((u) => sources.add(u)); }

  // The parts that need reading. One model call over short excerpts; nothing it says is trusted until checked.
  const snips: Record<Kind, { url: string; text: string }[]> = {
    address: detailSnippets(pages, "address"),
    hours: detailSnippets(pages, "hours"),
    registration: detailSnippets(pages, "registration"),
  };
  if (snips.address.length || snips.hours.length || snips.registration.length) {
    let answer: any = null;
    try {
      const block = (k: Kind, title: string) => (snips[k].length ? `${title}:\n${snips[k].map((s, i) => `[${i + 1}] ${s.url}\n${s.text}`).join("\n\n")}` : "");
      answer = await complete(
        [
          "Below are short excerpts from one business's own website. Extract its contact details.",
          "",
          block("address", "EXCERPTS THAT MAY CONTAIN THE OFFICE ADDRESS"),
          block("hours", "EXCERPTS THAT MAY CONTAIN OPENING HOURS"),
          block("registration", "EXCERPTS THAT MAY CONTAIN A LICENCE / REGISTRATION NUMBER"),
          "",
          "Rules:",
          "- Copy each value EXACTLY as the excerpt prints it. Never complete, tidy, translate or guess a part that is not there.",
          "- address: the business's OWN physical office address (street/building/area/city/country as printed). Not a client's, not a partner's, not a map link. null if not clearly printed.",
          "- hours: the business's opening or working hours as printed. null if not printed.",
          "- registration: a licence, trade licence, registration, tax or accreditation NUMBER or named registration the business holds, as printed. null if none.",
          "- Each value at most 160 characters. When unsure, null.",
          "",
          'Reply with ONLY JSON: {"address":"...","hours":"...","registration":"..."}',
        ].filter(Boolean).join("\n"),
      );
    } catch {
      answer = null;
    }
    for (const kind of ["address", "hours", "registration"] as const) {
      const value = cleanText(answer?.[kind], 160);
      const url = value ? groundedOn(value, pages) : null; // THE CHECK: every word must be printed on one page
      if (value && url) { details[kind] = value; sources.add(url); }
    }
  }

  return hasAnyDetail(details) ? { details, sources: [...sources].slice(0, 6) } : null;
}
