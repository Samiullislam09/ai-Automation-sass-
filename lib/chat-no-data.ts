/** lib/chat-no-data.ts — the questions we must refuse to answer, and why refusing is the feature.
 *
 *  MEASURED, 2026-09-18, over all 148 real user turns: the chat answered "kitne agent hain" five
 *  times and gave five different numbers, and reported two different site names for the same
 *  tenant. Some of that was a data bug (lib/website-url.ts), but the rest is the failure mode
 *  every metric question walks straight into: asked for a number it has no source for, a model
 *  does not say "I don't know" — it produces a plausible number. The owner's own instruction was
 *  "real accurate answer de", and the only way to be accurate about a number you cannot see is
 *  to say you cannot see it.
 *
 *  THIS RUNS BEFORE THE MODEL AND INSTEAD OF IT. A system-prompt rule would not do: the same
 *  prompt already carries "never invent" instructions and the five-different-agent-counts
 *  happened anyway. So the check is deterministic, the answer is written in code, and for these
 *  questions the model is never consulted at all. This is the same principle the capabilities
 *  registry already applies to "what can you do" — a question about our own wiring is answered
 *  from our own wiring, never from the model's imagination.
 *
 *  WHAT WE ACTUALLY HAVE, verified against the live database the day this was written:
 *
 *    traffic / active users / sessions   GA4 → site_insights.   Table exists, 0 rows: Google has
 *                                       never been connected (integrations holds one row, and it
 *                                       is WordPress). Chat does not read site_insights either,
 *                                       so connecting Google is necessary but not yet sufficient.
 *    impressions / clicks / ranking      Search Console → site_insights. Same story.
 *    followers / engagement / reach      NOTHING. No table, no API client, no sync. Miss Social
 *                                       drafts post text and never contacts a platform
 *                                       (agents/social.ts NO_AUTOPOST_NOTE), so there is no path
 *                                       by which a follower count could exist.
 *    revenue / conversions               NOTHING, and not planned here.
 *
 *  So the honest answers below differ on purpose: for GA4/GSC the blocker is a connection the
 *  customer can make, and we say so. For social metrics the blocker is that we have not built
 *  it, and pointing them at a Connect page that cannot deliver the number would be a lie with
 *  extra steps.
 *
 *  WHAT THIS MUST NOT SWALLOW. "mere site pe kya issue hai" and "SEO kaisa hai" ARE answerable —
 *  156 crawled pages, Mr. Analyst's profile and Mr. Audit all exist — so those must fall through
 *  untouched. Same for counts we really keep: articles written, tasks scheduled, items awaiting
 *  approval. Every matcher below therefore requires a metric we genuinely cannot see, not merely
 *  a question shaped like "kitne". */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Which measurement sources are live for this tenant. Read once, passed into the pure matcher. */
export type DataSources = {
  /** Google Analytics: connected, a property chosen, AND rows actually synced. */
  ga4: boolean;
  /** Search Console: same three conditions. */
  gsc: boolean;
  /** Connected social integrations. Even when non-empty this yields no metrics today — see the
   *  header — so it exists to make the answer accurate, not to unlock one. */
  social: string[];
};

export type NoDataAnswer = {
  /** What the customer is told, verbatim. */
  answer: string;
  /** Which source was missing — for logging, so this is measurable rather than anecdotal. */
  missing: "ga4" | "gsc" | "social" | "revenue";
};

/* ── The matchers ─────────────────────────────────────────────────────────────────────────── */

/** Named social platforms, so "instagram pe impressions" routes to social rather than to GSC —
 *  "impressions" is the one word both of them legitimately use. */
const NAMES_A_PLATFORM =
  /\b(instagram|insta|facebook|fb|linkedin|twitter|tweet|youtube|yt|tiktok|threads|social\s*media|social)\b/i;

const ASKS_SOCIAL_METRIC =
  /\b(followers?|follwers?|follower|subscribers?|subs|likes?|engagement|reach|impressions?)\b/i;

/** Site traffic. Hinglish forms are first-class here: "kitne user active ha" is the owner's own
 *  phrasing and never matches an English-shaped pattern like "active users". */
const ASKS_TRAFFIC =
  /\b(traffic|visitors?|pageviews?|page\s*views?|sessions?|bounce\s*rate|dwell\s*time|users?\s*(?:active|online)|active\s*users?|unique\s*users?|kitne\s*(?:users?|user|log|logo|visitors?|banda|bande)|kitna\s*traffic|traffic\s*kitna|live\s*users?)\b/i;

/** Search performance — Search Console's numbers. */
/** Present tense only, deliberately. "kaunsa keyword rank KAR RAHA hai" asks for a position we
 *  cannot see; "kaunsa keyword rank KAREGA" asks which one to target, which is Mr. Keyword's
 *  ordinary job and must not be refused. A bare "rank kar" matched both. */
const ASKS_SEARCH_METRIC =
  /\b(impressions?|clicks?|ctr|clickthrough|clickthrough\s*rate|ranking?s?|rank\s*(?:kar|ho)\s*raha|position|serp|search\s*console|gsc|keyword\s*rank(?!\s*kar(?:ega|enge|e|na)\b))\b/i;

const ASKS_MONEY_METRIC = /\b(revenue|sales|conversions?|conversion\s*rate|roi|earnings?|kamai|kitna\s*kama)\b/i;

/** "traffic kaise badhaun" is ADVICE, not a measurement, and refusing it would break the one
 *  thing this product is for.
 *
 *  Caught by testing this module's own first draft against real questions: 9 of 10 advice-shaped
 *  messages were being refused, including the owner's own live message "kya optimize karna hoga
 *  taki mujhe jyada traffic mile". Naming a metric is not the same as asking for its value — a
 *  question about how to CHANGE a number needs no access to the number.
 *
 *  Note what is NOT in here: bare "badha" ("kitna traffic badha" — how much did it grow) asks
 *  for a value and must stay refused, so only the suffixed advice forms (badhaun / badhane /
 *  badhana / badhaiye) are listed. */
const ASKS_FOR_ADVICE =
  /\b(kaise|kaisay|kese|kaisi|how\s+(?:to|do|can|should|would)|kya\s*kar(?:un|na|u|e)|improve|increase|badha(?:un|na|ne|iye|o|ao)|optimi[sz]e|tips?|suggest|salah|behtar|better|grow|boost|help\s+me)\b/i;

/** An explicit request for a quantity. When BOTH this and an advice marker are present
 *  ("kitna traffic hai aur kaise badhaun"), the number still has to be refused rather than
 *  invented — accuracy about the figure outranks answering the advice half. */
const ASKS_FOR_A_QUANTITY = /\b(kitna|kitne|kitni|how\s+(?:many|much)|kaunsa\s*number)\b/i;

/* ── The answers ──────────────────────────────────────────────────────────────────────────── */

const CONNECT_GOOGLE =
  "Iske liye Google connect karna padega — Connect page pe Google Analytics aur Search Console jodo, phir ye number main seedha wahan se padhke bataunga.";

const ANSWERS: Record<NoDataAnswer["missing"], string> = {
  ga4: `Ye mere paas nahi hai — aapka Google Analytics connected nahi hai, to site pe kitne log aa rahe hain ye main dekh hi nahi sakta. ${CONNECT_GOOGLE} Andaaza lagake number bata dena aapke kisi kaam ka nahi hoga.`,
  gsc: `Ye mere paas nahi hai — Search Console connected nahi hai, to impressions, clicks aur ranking ka asli data main nahi dekh sakta. ${CONNECT_GOOGLE}`,
  social:
    "Ye main abhi bata hi nahi sakta — social accounts ka koi data mere paas aata hi nahi hai. Miss Social sirf post ka text likhti hai, kisi platform pe post ya read nahi karti, to followers ya engagement ka number kahin store hi nahi hota. Ye feature abhi banaya nahi gaya hai — jhoota number dene se behtar hai saaf bol dena.",
  revenue:
    "Ye mere paas nahi hai — revenue aur conversions track karne ka koi setup is system mein abhi nahi hai. Main sirf wahi bata sakta hoon jo aapki site, content aur search data mein hai.",
};

/* ── The decision ─────────────────────────────────────────────────────────────────────────── */

/** A free pre-filter, so the common message never pays for the "what is connected" read.
 *
 *  Deliberately the union of the matchers and nothing cleverer: it may say yes to a question
 *  that `answerWhatWeCannotKnow` then lets through (because the source IS connected), but it
 *  must never say no to one that would have been refused. */
export function looksLikeMetricQuestion(message: string): boolean {
  const q = String(message ?? "");
  if (!q.trim()) return false;
  return (
    ASKS_TRAFFIC.test(q) ||
    ASKS_SEARCH_METRIC.test(q) ||
    ASKS_MONEY_METRIC.test(q) ||
    ASKS_SOCIAL_METRIC.test(q)
  );
}

/** Should this question be answered from our own wiring instead of from the model?
 *
 *  Pure on purpose — same reason `resolveFollowUp` in lib/chat-conversation.ts is pure: the rule
 *  about what we refuse to guess at is worth arguing with in a test, not only in production.
 *
 *  Returns null for everything we CAN answer, which is the common case and must stay cheap. */
export function answerWhatWeCannotKnow(message: string, sources: DataSources): NoDataAnswer | null {
  const q = String(message ?? "");
  if (!q.trim()) return null;

  // Advice about a metric is not a request for the metric. Checked before anything else,
  // because "traffic kaise badhaun" names a metric in every pattern below and is nonetheless a
  // question we can and must answer.
  if (ASKS_FOR_ADVICE.test(q) && !ASKS_FOR_A_QUANTITY.test(q)) return null;

  // Social first: a named platform makes "impressions" a social question, not a Search Console
  // one. Connected or not, we cannot produce the number either way.
  if (NAMES_A_PLATFORM.test(q) && ASKS_SOCIAL_METRIC.test(q)) {
    return { answer: ANSWERS.social, missing: "social" };
  }
  // "kitne followers badhe" names no platform but can only be about social.
  if (/\b(followers?|follwers?|subscribers?)\b/i.test(q)) {
    return { answer: ANSWERS.social, missing: "social" };
  }

  if (ASKS_TRAFFIC.test(q) && !sources.ga4) return { answer: ANSWERS.ga4, missing: "ga4" };
  if (ASKS_SEARCH_METRIC.test(q) && !sources.gsc) return { answer: ANSWERS.gsc, missing: "gsc" };
  if (ASKS_MONEY_METRIC.test(q)) return { answer: ANSWERS.revenue, missing: "revenue" };

  return null;
}

/* ── Reading what is actually connected ───────────────────────────────────────────────────── */

/** Three conditions per source, because two of them fail silently in exactly the way that
 *  produces a confident wrong answer: Google can be connected with no property chosen, and a
 *  property can be chosen with the sync never having run. Only rows on file count as "we can
 *  see this".
 *
 *  Any failure resolves to "not connected", which is the safe direction — it makes us say we
 *  cannot see something, never makes us claim we can. */
export async function loadDataSources(supabase: SupabaseClient, tenantId: string | null): Promise<DataSources> {
  const none: DataSources = { ga4: false, gsc: false, social: [] };
  if (!tenantId) return none;
  try {
    const [{ data: rows }, { data: insightSources }] = await Promise.all([
      supabase.from("integrations").select("type, encrypted_credentials").eq("tenant_id", tenantId).eq("status", "connected"),
      supabase.from("site_insights").select("source").eq("tenant_id", tenantId).limit(500),
    ]);

    const google = (rows ?? []).find((r) => r.type === "google")?.encrypted_credentials as
      | { ga4PropertyId?: string | null; gscSiteUrl?: string | null }
      | undefined;
    const synced = (insightSources ?? []).map((r: any) => String(r.source));

    return {
      ga4: !!google?.ga4PropertyId && synced.some((s) => /ga4|analytics/i.test(s)),
      gsc: !!google?.gscSiteUrl && synced.some((s) => /gsc|search|query|page/i.test(s)),
      social: (rows ?? []).map((r) => String(r.type)).filter((t) => t.startsWith("social_")),
    };
  } catch (e: any) {
    console.error("[chat-no-data] could not read which sources are connected:", e?.message);
    return none;
  }
}
