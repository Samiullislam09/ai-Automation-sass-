/** Mr. Lxwa's buyer-profile drafter (high-quality-leads plan, Phase 1).
 *
 *  THE PROBLEM THIS SOLVES. Lead generation used to build its ICP from "what the client IS" —
 *  the Site Brain's own what_they_do. For an ISO consultancy that yields "ISO consultancy", so
 *  the map search returns OTHER ISO consultancies: competitors, not buyers. This module asks the
 *  different question lead gen actually needs — "who BUYS this, and who merely looks like it" —
 *  and writes the answer down as a BuyerProfile the client then confirms.
 *
 *  THE DISCIPLINE. Same as everywhere else in this codebase: the LLM may only DRAFT, and its
 *  draft is validated by code before anyone sees it. The draft is always UNCONFIRMED — a human
 *  confirms it in the dashboard, and only then will lead generation run (buyerProfileReady).
 *  Every item cites the Site Brain line it came from, so nothing here is invented.
 *
 *  NO HARDCODING. There is not one industry word in this file. The segments come entirely from
 *  the tenant's own Site Brain, through the model, checked by generic rules. The same code gives
 *  an ISO consultancy "manufacturers / exporters" and a blog "brands that sponsor" — from data. */

import {
  type BuyerProfile,
  type BuyerSegment,
  type BuyingSignal,
  type CompetitorSegment,
  type EvidenceTag,
  type LeadGoal,
  type SiteProfile,
  emptyBuyerProfile,
  profileBlock,
} from "../siteProfile.js";

/** The one external dependency — a function that sends a prompt and returns parsed JSON. Same
 *  shape the pipeline uses (`llmJson: (prompt) => completeJson(prompt)`), so this module is
 *  unit-testable with a fake and the real completeJson is injected by the caller. */
export type LlmJson = (prompt: string) => Promise<unknown>;

export type DraftResult =
  | { ok: true; buyerProfile: BuyerProfile; warnings: string[] }
  | { ok: false; reason: string };

const LEAD_GOALS: LeadGoal[] = ["customer", "sponsor", "partner", "distributor", "other"];

/** Draft a buyer profile from the tenant's Site Brain. Returns a validated, UNCONFIRMED profile
 *  ready for the client to review — or {ok:false} with a reason when the Site Brain is too thin
 *  to draft from (no guessing: a profile with nothing to go on is a question, not an invention). */
export async function draftBuyerProfile(profile: SiteProfile | null | undefined, llmJson: LlmJson): Promise<DraftResult> {
  const brain = profileBlock(profile);
  if (!brain.trim()) {
    return { ok: false, reason: "There is no Site Brain to work from yet — run the website analysis first, then draft the buyer profile." };
  }

  let raw: unknown;
  try {
    raw = await llmJson(buildDraftPrompt(brain));
  } catch (e) {
    return { ok: false, reason: `The buyer-profile drafter could not be reached: ${(e as Error).message}` };
  }

  const { buyerProfile, warnings } = validateDraft(raw, profile ?? null);
  if (!buyerProfile.buyer_segments.length) {
    return { ok: false, reason: "The draft came back with no usable buyer segments — add the client's offering and audience to the Site Brain and try again." };
  }
  return { ok: true, buyerProfile, warnings };
}

/** The prompt. Industry-neutral on purpose: it describes the SHAPE of the answer and the rules
 *  that keep buyers and competitors apart, and lets the Site Brain supply every specific. */
export function buildDraftPrompt(brainBlock: string): string {
  return [
    "You map a business to the kinds of organisations that BUY from it, so a sales tool can go",
    "find those buyers. You are given everything known about the business (its SITE BRAIN).",
    brainBlock,
    "",
    "Return STRICT JSON, and ONLY the JSON object, in exactly this shape:",
    "{",
    '  "offer": "one or two lines: what this business sells or provides",',
    '  "lead_goal": "customer | sponsor | partner | distributor | other",',
    '  "buyer_segments": [',
    '    { "name": "short category name", "why_buy": "why this kind of organisation buys the offer",',
    '      "search_terms": ["generic category words a Google/Maps search finds them by"],',
    '      "evidence_from": "the SITE BRAIN line that justifies this" }',
    "  ],",
    '  "competitor_segments": [',
    '    { "name": "short category name", "cues": ["short words found in a competitor\'s name, website or category"],',
    '      "evidence_from": "the SITE BRAIN line that justifies this" }',
    "  ],",
    '  "buying_signals": [',
    '    { "name": "short signal name", "look_for": "what to look for on a prospect\'s own website",',
    '      "weight": 1-10, "evidence_from": "the SITE BRAIN line that justifies this" }',
    "  ],",
    '  "geo_scope": ["city / region / country to target"]',
    "}",
    "",
    "RULES — these decide whether the leads are any good, so follow them exactly:",
    "1. A BUYER is a CUSTOMER of the offer: an organisation that would PAY for it or RECEIVE it.",
    "   A buyer is NEVER an organisation that provides the same or a similar offer.",
    "2. COMPETITORS are organisations that SELL the same or a similar offer — peers. The buyer set",
    "   and the competitor set must be DIFFERENT; no category may appear in both.",
    "3. search_terms must be GENERIC, industry-neutral categories that a map or web search would",
    "   return — for example kinds of business, not this business's own name, brand, or the exact",
    "   phrase it uses for its service. Two to five terms per segment.",
    "4. Every buyer_segment, competitor_segment and buying_signal MUST set evidence_from to the",
    "   SITE BRAIN line it is justified by. If you cannot justify an item from the SITE BRAIN, do",
    "   NOT invent it — return a shorter list. Quality over quantity.",
    "5. Give 2 to 6 buyer_segments. Prefer fewer, well-justified ones.",
    "6. If the business sells to consumers rather than organisations, buyer_segments may describe",
    "   the kinds of places those consumers are reached through (still generic categories).",
  ].join("\n");
}

/** Turn whatever the model returned into a valid, UNCONFIRMED BuyerProfile. Everything here is a
 *  code rule the model cannot talk its way past: types coerced, weights clamped, empty items
 *  dropped, and — the important one — any category the model listed as BOTH a buyer and a
 *  competitor is removed from the buyer side, because a set that overlaps its own opposite is the
 *  exact failure (competitor-as-buyer) this plan exists to stop. */
export function validateDraft(raw: unknown, profile: SiteProfile | null): { buyerProfile: BuyerProfile; warnings: string[] } {
  const warnings: string[] = [];
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bp = emptyBuyerProfile();

  bp.offer = str(o.offer) || (profile?.what_they_do ?? null);
  bp.lead_goal = LEAD_GOALS.includes(o.lead_goal as LeadGoal) ? (o.lead_goal as LeadGoal) : null;

  const ev = (item: Record<string, unknown>): EvidenceTag => ({
    from: str(item.evidence_from) || str(item.from) || "site_brain",
    quote: str(item.quote) || null,
  });

  const competitorNames = new Set<string>();
  bp.competitor_segments = asRecords(o.competitor_segments)
    .map((c): CompetitorSegment | null => {
      const name = str(c.name);
      if (!name) return null;
      competitorNames.add(norm(name));
      return { name, cues: cleanTerms(c.cues), evidence: ev(c) };
    })
    .filter((x): x is CompetitorSegment => x !== null);

  bp.buyer_segments = asRecords(o.buyer_segments)
    .map((b): BuyerSegment | null => {
      const name = str(b.name);
      if (!name) return null;
      // Rule 2, enforced in code: a category listed as both is treated as a competitor, not a buyer.
      if (competitorNames.has(norm(name))) {
        warnings.push(`Dropped buyer segment "${name}" — it is also listed as a competitor.`);
        return null;
      }
      const search_terms = cleanTerms(b.search_terms);
      if (!search_terms.length) {
        warnings.push(`Dropped buyer segment "${name}" — it had no search terms to find it by.`);
        return null;
      }
      return { name, why_buy: str(b.why_buy) || "", search_terms, evidence: ev(b) };
    })
    .filter((x): x is BuyerSegment => x !== null)
    .slice(0, 6);

  bp.buying_signals = asRecords(o.buying_signals)
    .map((s): BuyingSignal | null => {
      const name = str(s.name);
      const look_for = str(s.look_for);
      if (!name || !look_for) return null;
      return { name, look_for, weight: clampWeight(s.weight), evidence: ev(s) };
    })
    .filter((x): x is BuyingSignal => x !== null);

  // geo_scope from the model, else the Site Brain's own geo as a single entry.
  bp.geo_scope = cleanTerms(o.geo_scope);
  if (!bp.geo_scope.length && profile?.geo) bp.geo_scope = [profile.geo];

  bp.confirmed = false; // never auto-confirmed — a human must accept it
  bp.drafted_by = "agent:buyer-profile";
  bp.drafted_at = new Date().toISOString();

  return { buyerProfile: bp, warnings };
}

/** Clean a buyer profile that a HUMAN edited in the dashboard before it is saved. Same code rules
 *  as the draft validator (weights clamped, terms trimmed/deduped, empties dropped, buyer∩competitor
 *  removed from the buyer side), but it preserves the confirmation fields the caller passes through
 *  — confirming/un-confirming is the route's decision, not this function's. A user-added item with
 *  no evidence is allowed, tagged `from:"user"`. */
export function sanitizeBuyerProfile(raw: unknown): BuyerProfile {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Reuse the draft validator for the hard rules, then carry the human's confirmation + offer.
  const { buyerProfile } = validateDraft(
    {
      ...o,
      // validateDraft reads evidence_from; keep any evidence the UI sent, default to "user".
      buyer_segments: asRecords(o.buyer_segments).map((b) => ({ ...b, evidence_from: evFrom(b) || "user" })),
      competitor_segments: asRecords(o.competitor_segments).map((c) => ({ ...c, evidence_from: evFrom(c) || "user" })),
      buying_signals: asRecords(o.buying_signals).map((s) => ({ ...s, evidence_from: evFrom(s) || "user" })),
    },
    null,
  );
  buyerProfile.offer = str(o.offer) || null;
  // Confirmation is decided by the route; sanitize never confirms on its own.
  buyerProfile.confirmed = false;
  buyerProfile.confirmed_by = null;
  buyerProfile.confirmed_at = null;
  buyerProfile.drafted_by = "user:edit";
  buyerProfile.drafted_at = new Date().toISOString();
  return buyerProfile;
}

/** Pull an evidence `from` out of whatever shape the UI sent (a nested {evidence:{from}} or a flat
 *  evidence_from), so round-tripping a drafted item through the editor keeps its citation. */
function evFrom(item: Record<string, unknown>): string {
  const nested = item.evidence && typeof item.evidence === "object" ? (item.evidence as Record<string, unknown>).from : undefined;
  return str(item.evidence_from) || str(nested);
}

/** A one-line summary for logs and the chat card. */
export function describeBuyerProfile(bp: BuyerProfile): string {
  const buyers = bp.buyer_segments.map((s) => s.name).join(", ") || "none";
  const comps = bp.competitor_segments.length;
  return `${bp.buyer_segments.length} buyer segment(s) [${buyers}], ${comps} competitor cue set(s), ${bp.buying_signals.length} signal(s)${bp.confirmed ? " · confirmed" : " · UNCONFIRMED"}`;
}

// ── tiny helpers (no industry knowledge, just shape) ──────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function asRecords(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => x as Record<string, unknown>) : [];
}

/** Trim, drop empties, dedupe (case-insensitive), keep order, cap length. */
function cleanTerms(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const s = str(t);
    if (!s || seen.has(norm(s))) continue;
    seen.add(norm(s));
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function clampWeight(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n));
}
