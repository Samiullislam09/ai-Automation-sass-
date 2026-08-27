/** Compliance by design — the rules that keep outreach legal and keep us out of spam filters.
 *
 *  Rebuild plan §17.4 step 7 and §21.3. Everything in here is CODE, not a prompt: a model can
 *  be talked out of a rule by the next thing it reads, and one of the things this pipeline
 *  reads is a stranger's website. So every rule below is a function with a test, and the
 *  pipeline cannot produce a draft without passing through `screenDraft`.
 *
 *  THE RULES
 *
 *   1. No personal-email scraping. An address is usable only if the page we read PUBLISHES it
 *      for business contact — it appears in the page's own text, on a contact-shaped page or
 *      as a role address (info@, sales@), and it is not somebody's personal mailbox on a free
 *      consumer provider. `emailIsBusinessContact`.
 *   2. Ceilings. At most one draft per domain per run, at most `MAX_PER_RUN` drafts in a run,
 *      and a hard ceiling no caller can raise. `RunLedger`.
 *   3. Suppression. Anything on the tenant's do-not-contact list is dropped before it is
 *      researched, matched on domain, email and phone. `isSuppressed`.
 *   4. Identification + opt-out. Every draft carries who is writing (a name, the business, and
 *      its website) and a working opt-out — one built by `buildSignature`, in code, so the
 *      model cannot forget it and cannot paraphrase it away. `checkIdentification`, `checkOptOut`.
 *   5. No unproven claims. A draft may state a credential, a number or a superlative only if
 *      the tenant's Site Brain `proof` contains it. `checkClaims` — same spirit as the article
 *      quality gate (lib/qualityGate.ts): a deterministic check a human can take apart.
 *   6. Drafting is not sending. See below.
 *
 *  WHY THERE IS NO `send()` IN THIS FILE
 *
 *  Sending is irreversible: a message that went to a stranger cannot be recalled, and the plan
 *  is explicit that the first version drafts only, with per-message human approval afterwards
 *  (§17.4 step 6, §21.3). "We just haven't written it yet" is not a safeguard — the next person
 *  in this file would write it. So the safeguard is structural:
 *
 *   · this module exports no transport of any kind, and imports none;
 *   · `sealDraft` returns a FROZEN object whose `status` is "draft" — in an ES module (always
 *     strict mode) `draft.status = "sent"` throws a TypeError rather than quietly succeeding;
 *   · `assertDraftOnly` is called immediately before anything is persisted, and throws
 *     `SendAttemptError` if a record ever arrives claiming to have been delivered.
 *
 *  When sending is built it will be a separate, human-approved action in its own module, and
 *  it will have to construct its own record — it cannot mutate one of these.
 */

import type { Offering, Proof } from "../siteProfile.js";

// ── policy numbers, in one place, each with the reason it is that number ────────────────────

export const POLICY = {
  /** One message per business per run. Two mails to the same company in one morning is how a
   *  domain gets blocked, and the second one never says anything new. */
  MAX_PER_DOMAIN: 1,
  /** A run's ceiling. 25 is what a free NIM tier can draft inside its rate limit, and it is
   *  small enough that a human can actually read every draft before approving it. */
  MAX_PER_RUN: 25,
  /** No caller may raise the run ceiling past this. The argument for "just this once" is
   *  exactly the argument that ends in a bulk blast. */
  HARD_MAX_PER_RUN: 50,
  /** Below this the draft is not shown at all (plan §17.4: "< 50 → archive, dikhao mat"). */
  MIN_SCORE: 50,
} as const;

/** Free consumer mail providers. An address here is a person's own mailbox — a business that
 *  wants mail publishes a business address. Contacting a personal one is the exact thing
 *  §21.3 forbids, whatever it says on the page. */
const CONSUMER_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de",
  "mail.com", "yandex.com", "yandex.ru", "zoho.com", "rediffmail.com", "qq.com", "163.com",
]);

/** Mailboxes a business publishes in order to be contacted. A role address is, by definition,
 *  not a named person's inbox. */
const ROLE_LOCALPARTS = new Set([
  "info", "contact", "hello", "hi", "enquiries", "enquiry", "inquiries", "inquiry", "sales",
  "office", "admin", "reception", "bookings", "booking", "reservations", "support", "help",
  "team", "mail", "email", "shop", "orders", "service", "customerservice", "marketing",
  "business", "partnerships", "press", "hr", "jobs", "careers", "accounts", "billing",
]);

/** Paths where a business publishes contact details on purpose. */
const CONTACT_PAGE = /(^|\/)(contact|contact-us|contactus|about|about-us|team|imprint|impressum|legal|reach-us|get-in-touch|enquiry|enquiries|book|booking)(\/|$|\.)/i;

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// ── rule ids, so a violation is a value and not a sentence ──────────────────────────────────

export type RuleId =
  | "personal-email"
  | "suppressed"
  | "domain-ceiling"
  | "run-ceiling"
  | "identification"
  | "opt-out"
  | "unproven-claim"
  | "region"
  | "send-attempt";

export type Violation = { rule: RuleId; detail: string };

// ── 1 · no personal-email scraping ──────────────────────────────────────────────────────────

export type EmailContext = {
  /** The URL of the page the address was read from. */
  pageUrl: string;
  /** That page's text, exactly as we read it — the address has to be IN here. */
  pageText: string;
  /** The business's own domain, so an address on it counts as published-by-them. */
  businessDomain?: string | null;
};

export type EmailVerdict = { ok: true; email: string; why: string } | { ok: false; why: string };

/** Is this address published for business contact — or did we just find a person's mailbox?
 *
 *  Four conditions, all required:
 *   a. it parses as an address;
 *   b. it appears verbatim in the text of the page we actually read (we do not accept an
 *      address a model produced, or one guessed from a name);
 *   c. it is a role address OR it sits on a contact-shaped page OR it is on the business's own
 *      domain — i.e. the business put it there to be written to;
 *   d. it is not on a free consumer mail provider, which means it is somebody's own inbox. */
export function emailIsBusinessContact(rawEmail: string | null | undefined, ctx: EmailContext): EmailVerdict {
  const email = String(rawEmail ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, why: "not an email address" };

  const [localPart, domain] = email.split("@");

  if (CONSUMER_MAIL_DOMAINS.has(domain)) {
    return { ok: false, why: `${domain} is a personal mailbox provider — we do not write to those` };
  }

  const published = String(ctx.pageText ?? "").toLowerCase().includes(email);
  if (!published) {
    return { ok: false, why: "not published on the page we read — we never assemble an address we were not given" };
  }

  const isRole = ROLE_LOCALPARTS.has(localPart.replace(/[.+_-].*$/, "")) || ROLE_LOCALPARTS.has(localPart);
  const onContactPage = CONTACT_PAGE.test(safePath(ctx.pageUrl));
  const ownDomain = !!ctx.businessDomain && domain === stripWww(ctx.businessDomain);

  if (!isRole && !onContactPage && !ownDomain) {
    return {
      ok: false,
      why: "a named person's address found somewhere other than a contact page — not published for business contact",
    };
  }

  return {
    ok: true,
    email,
    why: isRole ? "role address published on the site" : onContactPage ? "published on their contact page" : "published on their own domain",
  };
}

/** Every address a page publishes for business contact, in the order they appear. */
export function businessEmailsOnPage(ctx: EmailContext): string[] {
  const found = String(ctx.pageText ?? "").match(EMAIL_RE) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const verdict = emailIsBusinessContact(raw, ctx);
    if (verdict.ok && !out.includes(verdict.email)) out.push(verdict.email);
  }
  return out;
}

// ── 2 · ceilings ────────────────────────────────────────────────────────────────────────────

export type LedgerLimits = { maxPerDomain?: number; maxPerRun?: number };

/** Counts what this run has already drafted, and refuses the one that would cross a line.
 *
 *  It is a class rather than a pure function because the count is the state: the per-domain
 *  rule cannot be checked by looking at one lead. Ask `admit()` BEFORE drafting — the ceiling
 *  is there to stop the work, not to discard it afterwards. */
export class RunLedger {
  readonly maxPerDomain: number;
  readonly maxPerRun: number;
  private perDomain = new Map<string, number>();
  private total = 0;

  constructor(limits: LedgerLimits = {}) {
    this.maxPerDomain = clampInt(limits.maxPerDomain ?? POLICY.MAX_PER_DOMAIN, 1, POLICY.MAX_PER_DOMAIN);
    // A caller may lower the run ceiling (a free plan does), never raise it past the hard max.
    this.maxPerRun = clampInt(limits.maxPerRun ?? POLICY.MAX_PER_RUN, 1, POLICY.HARD_MAX_PER_RUN);
  }

  get drafted(): number {
    return this.total;
  }

  /** May we draft one more for this domain? Records it when the answer is yes. */
  admit(domainRaw: string | null | undefined): { ok: true } | { ok: false; violation: Violation } {
    const domain = stripWww(String(domainRaw ?? "").toLowerCase()) || "(no domain)";
    if (this.total >= this.maxPerRun) {
      return { ok: false, violation: { rule: "run-ceiling", detail: `run ceiling reached (${this.maxPerRun} drafts)` } };
    }
    const used = this.perDomain.get(domain) ?? 0;
    if (used >= this.maxPerDomain) {
      return {
        ok: false,
        violation: { rule: "domain-ceiling", detail: `${domain} already has ${used} draft in this run (max ${this.maxPerDomain})` },
      };
    }
    this.perDomain.set(domain, used + 1);
    this.total += 1;
    return { ok: true };
  }
}

// ── 3 · suppression ─────────────────────────────────────────────────────────────────────────

export type SuppressionEntry = { domain?: string | null; email?: string | null; phone?: string | null };
export type SuppressionTarget = { domain?: string | null; email?: string | null; phone?: string | null };

/** The do-not-contact check. Matched on any of the three identifiers, because a business that
 *  said no by phone did not consent to being emailed instead. */
export function isSuppressed(target: SuppressionTarget, list: readonly SuppressionEntry[]): Violation | null {
  const domain = stripWww(String(target.domain ?? "").toLowerCase());
  const email = String(target.email ?? "").trim().toLowerCase();
  const phone = digits(target.phone);

  for (const entry of list ?? []) {
    const d = stripWww(String(entry.domain ?? "").toLowerCase());
    const e = String(entry.email ?? "").trim().toLowerCase();
    const p = digits(entry.phone);
    if (d && domain && d === domain) return { rule: "suppressed", detail: `${domain} is on the do-not-contact list` };
    if (e && email && e === email) return { rule: "suppressed", detail: `${email} is on the do-not-contact list` };
    // Phone numbers are written a dozen ways; compare the last 9 digits, which survives
    // country-code and spacing differences without colliding across real numbers.
    if (p && phone && p.length >= 9 && phone.length >= 9 && p.slice(-9) === phone.slice(-9)) {
      return { rule: "suppressed", detail: `${target.phone} is on the do-not-contact list` };
    }
  }
  return null;
}

// ── 4 · identification and opt-out ──────────────────────────────────────────────────────────

export type SenderIdentity = {
  /** The human sending it. Falls back to the business name when the tenant has no contact name. */
  personName: string | null;
  businessName: string;
  website: string | null;
  /** Where a reply goes — the same address the opt-out instruction names. */
  replyTo: string | null;
};

/** The marker every signature carries, so the check below is exact rather than a guess at
 *  what "unsubscribe-ish" text looks like. */
export const OPT_OUT_PHRASE = "reply with the word STOP";

/** Identification + opt-out, built in code and appended after the model has written the body.
 *
 *  Built rather than requested: a model asked to "include an unsubscribe line" includes one
 *  most of the time, and the times it does not are the times that matter. */
export function buildSignature(identity: SenderIdentity): string {
  const who = identity.personName ? `${identity.personName}, ${identity.businessName}` : identity.businessName;
  const lines = [`— ${who}`];
  if (identity.website) lines.push(identity.website);
  const optOut = identity.replyTo
    ? `If you would rather not hear from me, ${OPT_OUT_PHRASE} to ${identity.replyTo} and I will not write again.`
    : `If you would rather not hear from me, ${OPT_OUT_PHRASE} and I will not write again.`;
  lines.push(optOut);
  return lines.join("\n");
}

/** Does the finished message say who is writing? Name AND business, both present. */
export function checkIdentification(text: string, identity: SenderIdentity): Violation | null {
  const body = String(text ?? "").toLowerCase();
  const business = identity.businessName.trim().toLowerCase();
  if (!business || !body.includes(business)) {
    return { rule: "identification", detail: `the message never names the sender's business ("${identity.businessName}")` };
  }
  if (identity.personName && !body.includes(identity.personName.trim().toLowerCase())) {
    return { rule: "identification", detail: `the message never names the sender ("${identity.personName}")` };
  }
  return null;
}

/** Is there an opt-out, and does it actually work?
 *
 *  "Working" means the reader is told what to do and has something to do it with: our exact
 *  opt-out phrase, plus either a reply address or the instruction to reply to this message.
 *  A line that says "unsubscribe" with nothing to click is not an opt-out. */
export function checkOptOut(text: string, identity: SenderIdentity): Violation | null {
  const body = String(text ?? "");
  if (!body.toLowerCase().includes(OPT_OUT_PHRASE.toLowerCase())) {
    return { rule: "opt-out", detail: "no opt-out line in the message" };
  }
  if (identity.replyTo) {
    if (!body.toLowerCase().includes(identity.replyTo.trim().toLowerCase())) {
      return { rule: "opt-out", detail: "the opt-out does not name the address a reply goes to" };
    }
  }
  return null;
}

// ── 5 · no claim that is not in `proof` ─────────────────────────────────────────────────────

/** Sentence shapes that assert something checkable about the sender. Anything matching has to
 *  be backed by a Site Brain proof entry; everything else is ordinary prose and passes. */
const CLAIM_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(?:iso|gdpr|hipaa|soc\s?2|pci|ce)\b[\s-]?\d*/i, label: "a certification" },
  { re: /\b(?:certified|accredited|licensed|award[- ]winning|award winning|patented|insured)\b/i, label: "a credential" },
  { re: /\b(?:the )?(?:#\s?1|number one|leading|largest|biggest|best|top[- ]rated|fastest[- ]growing|market leader)\b/i, label: "a superlative" },
  { re: /\b\d+(?:[.,]\d+)?\s?%/, label: "a percentage" },
  { re: /[$€£₹¥]\s?\d[\d,]*(?:\.\d+)?/, label: "a money figure" },
  { re: /\b\d[\d,]*\+?\s+(?:clients|customers|businesses|companies|projects|installs|users|reviews|years)\b/i, label: "a count" },
  { re: /\b(?:guarantee|guaranteed|risk[- ]free|money[- ]back)\b/i, label: "a guarantee" },
];

/** Every claim in the draft that the tenant cannot prove.
 *
 *  A claim is supported when the sentence's checkable part appears in a `proof` entry (its
 *  claim text or its verbatim quote) or names an offering the Site Brain lists. The comparison
 *  is on normalised text — whitespace and case only — exactly like the analyst's verbatim
 *  check, because "loosely similar" is how an invented number gets through. */
export function checkClaims(text: string, proof: readonly Proof[], offerings: readonly Offering[] = []): Violation[] {
  const violations: Violation[] = [];
  const haystack = norm(
    [
      ...(proof ?? []).map((p) => `${p.claim ?? ""} ${p.quote ?? ""}`),
      ...(offerings ?? []).map((o) => o.name ?? ""),
    ].join(" \n ")
  );

  for (const sentence of sentences(String(text ?? ""))) {
    for (const pattern of CLAIM_PATTERNS) {
      const m = sentence.match(pattern.re);
      if (!m) continue;
      const fragment = norm(m[0]);
      if (fragment && haystack.includes(fragment)) continue; // provable: it is in `proof`
      violations.push({
        rule: "unproven-claim",
        detail: `${pattern.label} we cannot prove: "${clip(sentence, 120)}" — nothing in the Site Brain's proof says this`,
      });
      break; // one violation per sentence is enough to send it back
    }
  }
  return violations;
}

// ── region: who may be written to at all ────────────────────────────────────────────────────

/** Places where unsolicited B2C outreach is not defensible and B2B is only defensible on
 *  legitimate interest, with the identification + opt-out this file already enforces
 *  (GDPR/PECR, plan §21.3). Matched loosely against the ICP's geography string, which is all
 *  we have — a false positive here costs a note, a false negative costs a fine. */
const STRICT_REGIONS =
  /\b(eu|europe|european union|uk|united kingdom|england|scotland|wales|ireland|germany|deutschland|france|spain|italy|netherlands|belgium|austria|sweden|denmark|norway|finland|poland|portugal|greece|czech|hungary|romania|london|manchester|birmingham|dublin|berlin|munich|hamburg|paris|madrid|barcelona|rome|milan|amsterdam|brussels|vienna|stockholm|copenhagen)\b/i;

export type RegionRule = { strict: boolean; basis: string; note: string };

/** What the law where these leads live requires of us. Returned as a note carried on every
 *  lead rather than a silent flag, so the human approving the draft sees it. */
export function regionRule(geo: string | null | undefined): RegionRule {
  const strict = STRICT_REGIONS.test(String(geo ?? ""));
  if (strict) {
    return {
      strict: true,
      basis: "legitimate-interest-b2b",
      note:
        "GDPR/PECR territory: business-to-business only, on legitimate interest, with the sender identified " +
        "and a working opt-out in every message. No consumer contacts.",
    };
  }
  return { strict: false, basis: "b2b-outreach", note: "Business-to-business outreach with sender identification and opt-out." };
}

/** In a strict region a target has to be a business we can see is a business: a website on its
 *  own domain, or a published business address. A personal mailbox never qualifies. */
export function regionAllows(target: { domain?: string | null; email?: string | null }, rule: RegionRule): Violation | null {
  if (!rule.strict) return null;
  const domain = stripWww(String(target.domain ?? "").toLowerCase());
  const emailDomain = String(target.email ?? "").split("@")[1]?.toLowerCase() ?? "";
  const looksLikeBusiness = !!domain || (!!emailDomain && !CONSUMER_MAIL_DOMAINS.has(emailDomain));
  if (!looksLikeBusiness) {
    return { rule: "region", detail: "GDPR territory and nothing shows this is a business rather than a person" };
  }
  return null;
}

// ── 6 · drafting is not sending ─────────────────────────────────────────────────────────────

export type OutreachChannel = "email" | "contact-form" | "phone";

export type DraftInput = {
  /** The message body, without the signature — this module appends that. */
  body: string;
  channel: OutreachChannel;
  identity: SenderIdentity;
};

/** A finished draft. Frozen, and permanently `status: "draft"`.
 *
 *  There is no field here that a transport could use as an instruction — no `to`, no `send_at`,
 *  no `approved`. The recipient's address lives on the lead row a human reads; putting it on
 *  the message object would be the first half of a sender. */
export type OutreachDraft = Readonly<{
  status: "draft";
  /** Always false. Present so a reader of the JSON sees the answer without knowing this file. */
  sent: false;
  channel: OutreachChannel;
  text: string;
  words: number;
  /** What the compliance screen found. A draft with entries here is not shown to the user. */
  violations: readonly Violation[];
}>;

export class SendAttemptError extends Error {
  constructor(detail: string) {
    super(`Mr. Lead drafts, it never sends: ${detail}`);
    this.name = "SendAttemptError";
  }
}

/** Assemble the body + the signature into a frozen draft, and screen it.
 *
 *  The signature is appended HERE rather than asked for in the prompt, so identification and
 *  opt-out are properties of the code path, not of the model's mood. */
export function sealDraft(input: DraftInput, screen: ScreenContext): OutreachDraft {
  const body = String(input.body ?? "").trim();
  const text = `${body}\n\n${buildSignature(input.identity)}`;
  const violations = screenDraft(text, input.identity, screen);

  // Object.freeze + ES module strict mode: `draft.status = "sent"` throws a TypeError. That is
  // the difference between "we have not written a sender" and "a sender cannot start here".
  return Object.freeze({
    status: "draft" as const,
    sent: false as const,
    channel: input.channel,
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    violations: Object.freeze(violations),
  });
}

export type ScreenContext = {
  proof: readonly Proof[];
  offerings?: readonly Offering[];
  /** The one specific, true observation the draft is built on. Its absence is a violation of
   *  the "no template smell" rule, checked by the pipeline, not here. */
  region?: RegionRule;
};

/** Every compliance rule that applies to a finished message, in one call. */
export function screenDraft(text: string, identity: SenderIdentity, ctx: ScreenContext): Violation[] {
  const violations: Violation[] = [];
  const id = checkIdentification(text, identity);
  if (id) violations.push(id);
  const opt = checkOptOut(text, identity);
  if (opt) violations.push(opt);
  violations.push(...checkClaims(text, ctx.proof ?? [], ctx.offerings ?? []));
  return violations;
}

/** The last gate before anything is written down or handed back.
 *
 *  Throws rather than returning false: a record claiming to have been sent is not a validation
 *  failure to be logged and skipped, it is a bug in something that should not exist yet, and it
 *  must stop the run loudly enough that somebody reads the stack trace. */
export function assertDraftOnly(record: unknown): void {
  if (!record || typeof record !== "object") return;
  const r = record as Record<string, unknown>;

  if ("status" in r && r.status !== "draft") {
    throw new SendAttemptError(`a lead arrived with status "${String(r.status)}"`);
  }
  if (r.sent === true) throw new SendAttemptError("a lead arrived marked sent");
  for (const key of ["sent_at", "sentAt", "delivered_at", "deliveredAt", "message_id", "messageId"]) {
    if (r[key] != null) throw new SendAttemptError(`a lead arrived carrying "${key}" — nothing in this product can have sent it`);
  }
  const draft = r.draft as Record<string, unknown> | undefined;
  if (draft && typeof draft === "object") assertDraftOnly(draft);
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────

export function stripWww(domain: string): string {
  return String(domain ?? "").trim().toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
}

/** The registrable-ish host of a URL, or null. Used everywhere a lead is identified. */
export function domainOf(url: string | null | undefined): string | null {
  const v = String(url ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return stripWww(u.hostname) || null;
  } catch {
    return null;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url ?? "");
  }
}

function digits(v: unknown): string {
  return String(v ?? "").replace(/\D+/g, "");
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return max;
  return Math.max(min, Math.min(max, n));
}

function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return String(text ?? "")
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(s: string, max: number): string {
  const v = String(s ?? "").trim().replace(/\s+/g, " ");
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}
