import { supabase } from "../supabase.js";

/** The agents' read side of `site_insights` (supabase/migrations/007_site_insights.sql).
 *
 *  Everything here is a MEASUREMENT of this specific business — what Google Search Console
 *  says people actually type to reach them, where those pages sit, what GA4 says gets
 *  traffic. It is the difference between "write about ISO certification" and "you are on
 *  page 2 for 'iso 9001 cost dubai' with 340 impressions and no article — write that one".
 *
 *  Nothing in here fabricates. If Google isn't connected the readers return empty and the
 *  callers fall back to what they did before, saying so out loud in the prompt. */

export type InsightRow = { source: string; kind: string; key: string; metrics: any; period_start: string | null; period_end: string | null };

export type SiteInsights = {
  connected: boolean;
  period: { start: string | null; end: string | null };
  /** Queries already earning clicks — proof of what this business is known for. */
  winning: { query: string; clicks: number; impressions: number; position: number }[];
  /** Seen by real searchers, ranked just off the money — the highest-value thing to write. */
  strikingDistance: { query: string; clicks: number; impressions: number; position: number }[];
  /** Lots of impressions, almost no clicks: the intent is there, the page isn't answering it. */
  missed: { query: string; clicks: number; impressions: number; position: number }[];
  topPages: { url: string; clicks: number; sessions: number | null }[];
  traffic: { sessions: number; users: number; pageViews: number } | null;
  location: { title: string; address: string | null } | null;
};

const EMPTY: SiteInsights = {
  connected: false,
  period: { start: null, end: null },
  winning: [], strikingDistance: [], missed: [], topPages: [],
  traffic: null, location: null,
};

export async function loadInsights(tenantId: string): Promise<SiteInsights> {
  const { data, error } = await supabase
    .from("site_insights")
    .select("source, kind, key, metrics, period_start, period_end")
    .eq("tenant_id", tenantId);

  // Migration 007 not applied, or nothing synced — either way there is simply no evidence,
  // which is a valid state, not an error the caller should die on.
  if (error || !data?.length) {
    if (error) console.error("[insights] read failed:", error.message);
    return EMPTY;
  }

  const rows = data as InsightRow[];
  const queries = rows
    .filter((r) => r.source === "gsc" && r.kind === "query")
    .map((r) => ({
      query: r.key,
      clicks: num(r.metrics?.clicks),
      impressions: num(r.metrics?.impressions),
      position: num(r.metrics?.position),
    }));

  const gscPages = rows.filter((r) => r.source === "gsc" && r.kind === "page");
  const ga4Pages = new Map(rows.filter((r) => r.source === "ga4" && r.kind === "page").map((r) => [r.key, num(r.metrics?.sessions)]));
  const summary = rows.find((r) => r.source === "ga4" && r.kind === "summary");
  const loc = rows.find((r) => r.source === "gbp" && r.kind === "location");
  const anyRow = rows[0];

  return {
    connected: true,
    period: { start: anyRow?.period_start ?? null, end: anyRow?.period_end ?? null },

    winning: [...queries].filter((q) => q.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 15),

    // Position 5-25 = seen by real people, but below the fold or on page 2/3. A modest
    // impression floor keeps one-off long-tail noise out of the plan.
    strikingDistance: queries
      .filter((q) => q.position >= 5 && q.position <= 25 && q.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20),

    missed: queries
      .filter((q) => q.impressions >= 100 && q.clicks / Math.max(q.impressions, 1) < 0.01)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10),

    topPages: gscPages
      .map((p) => ({ url: p.key, clicks: num(p.metrics?.clicks), sessions: ga4Pages.get(pathOf(p.key)) ?? null }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 15),

    traffic: summary
      ? { sessions: num(summary.metrics?.sessions), users: num(summary.metrics?.users), pageViews: num(summary.metrics?.pageViews) }
      : null,

    location: loc ? { title: String(loc.metrics?.title ?? ""), address: loc.metrics?.address ?? null } : null,
  };
}

/** Prompt block for the topic planner (agents/boss.ts). Evidence first, adjectives never. */
export function planningBlock(ins: SiteInsights): string {
  if (!ins.connected) return "";
  const lines: string[] = [
    "",
    `REAL SEARCH DATA for this business (Google Search Console, ${ins.period.start} to ${ins.period.end}).`,
    "These are measured numbers, not estimates. Prefer topics grounded in them.",
  ];

  if (ins.strikingDistance.length) {
    lines.push(
      "",
      "Already ranking 5-25 (people see them, almost nobody clicks) — the best topics to write next:",
      ...ins.strikingDistance.slice(0, 12).map((q) => `- "${q.query}" — position ${q.position.toFixed(1)}, ${q.impressions} impressions, ${q.clicks} clicks`)
    );
  }
  if (ins.missed.length) {
    lines.push(
      "",
      "High impressions, near-zero clicks — the page they land on is not answering the question:",
      ...ins.missed.slice(0, 6).map((q) => `- "${q.query}" — ${q.impressions} impressions, ${q.clicks} clicks`)
    );
  }
  if (ins.winning.length) {
    lines.push(
      "",
      "Already winning (do NOT write a competing article on these — they work):",
      ...ins.winning.slice(0, 8).map((q) => `- "${q.query}" (${q.clicks} clicks, position ${q.position.toFixed(1)})`)
    );
  }
  return lines.join("\n");
}

/** Prompt block for Mr. Writer — what the article can safely link to and build on. */
export function writerBlock(ins: SiteInsights): string {
  if (!ins.connected) return "";
  const lines: string[] = [];

  if (ins.topPages.length) {
    lines.push(
      "",
      "Pages on this site that already earn search traffic (link to the relevant ones by URL):",
      ...ins.topPages.slice(0, 8).map((p) => `- ${p.url} (${p.clicks} clicks from search)`)
    );
  }
  if (ins.winning.length) {
    lines.push(
      "",
      "Search terms this business already ranks for — stay consistent with this vocabulary:",
      ...ins.winning.slice(0, 8).map((q) => `- ${q.query}`)
    );
  }
  if (ins.location) {
    lines.push("", `Google Business Profile: ${ins.location.title}${ins.location.address ? ` — ${ins.location.address}` : ""}`);
  }
  return lines.join("\n");
}

/** Queries from THIS site's own Search Console that overlap a topic. Real impressions for
 *  real searches — better evidence than any keyword estimate, when it exists. */
export function relatedFromSearchConsole(ins: SiteInsights, topic: string, max = 10) {
  if (!ins.connected) return [];
  const words = tokens(topic);
  if (!words.length) return [];

  const all = [...ins.strikingDistance, ...ins.winning, ...ins.missed];
  const seen = new Set<string>();

  return all
    .filter((q) => {
      if (seen.has(q.query)) return false;
      seen.add(q.query);
      const qt = tokens(q.query);
      // At least one meaningful word in common — deliberately loose, because the caller
      // only ever presents these as "related", never as the topic itself.
      return words.some((w) => qt.includes(w));
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, max);
}

const STOP = new Set(["the", "and", "for", "with", "you", "your", "our", "how", "what", "why", "are", "is", "in", "of", "to", "a", "an", "best", "top"]);

function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** GSC page keys are absolute URLs; GA4 pagePath keys are paths. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
