/** The crawler→analyst phase table, in one place so Site Brain's refresh bar and onboarding's
 *  "learning your business" screen show the exact same real progress instead of two hand-kept
 *  copies drifting apart. Pure data/logic only — no React, no JSX, safe to import from a server
 *  or client component either way.
 *
 *  Filling the brain is two jobs in a row — the crawler reads the pages and then enqueues the
 *  analyst (agent-server/src/agents/crawler.ts) — so the bar runs across both. The phase ids are
 *  the ones those two agents actually report to `ctx.onProgress`; the fractions are how much of
 *  the bar each stage owns, and inside a phase with done/total the bar moves with the real
 *  count. Nothing here is a timer pretending to be progress. */

export type BrainJob = {
  id: string;
  status: "queued" | "running" | "success" | "error" | "skipped" | string;
  action: string;
  createdAt: string;
  stalled: boolean;
  progress: { phase: string | null; label: string | null; done: number | null; total: number | null; current: string | null; at: string | null };
  error: { message: string; cause: string | null; hint: string | null; attempt: number | null; attempts: number | null; durationMs: number | null } | null;
};
export type BrainJobs = { crawler: BrainJob | null; analyst: BrainJob | null };

export const BRAIN_PHASES: { id: string; agent: "crawler" | "analyst"; label: string; from: number; to: number }[] = [
  { id: "discovering", agent: "crawler", label: "Finding your pages", from: 0, to: 0.06 },
  { id: "reading", agent: "crawler", label: "Reading them", from: 0.06, to: 0.3 },
  { id: "summarising", agent: "crawler", label: "Working out the business", from: 0.3, to: 0.36 },
  { id: "loading", agent: "analyst", label: "Opening what we know", from: 0.36, to: 0.4 },
  { id: "reading", agent: "analyst", label: "What they do", from: 0.4, to: 0.46 },
  { id: "offerings", agent: "analyst", label: "What they sell", from: 0.46, to: 0.54 },
  { id: "proof", agent: "analyst", label: "What they can prove", from: 0.54, to: 0.62 },
  { id: "voice", agent: "analyst", label: "How they write", from: 0.62, to: 0.7 },
  { id: "commerce", agent: "analyst", label: "How they sell and charge", from: 0.7, to: 0.78 },
  { id: "place", agent: "analyst", label: "Where they work", from: 0.78, to: 0.84 },
  { id: "clustering", agent: "analyst", label: "Grouping the topics", from: 0.84, to: 0.9 },
  { id: "gaps", agent: "analyst", label: "Checking Search Console", from: 0.9, to: 0.97 },
  { id: "saving", agent: "analyst", label: "Writing the profile", from: 0.97, to: 1 },
];

// "reading" is a phase id both agents use, so a phase is only ever looked up together with
// the agent whose row it came from.
export function phaseIndex(agent: "crawler" | "analyst", phase: string | null): number {
  if (!phase) return -1;
  return BRAIN_PHASES.findIndex((p) => p.agent === agent && p.id === phase);
}

/** The live stage: the analyst's row wins once it exists and is running, because by then the
 *  crawler is finished and its row is only history. */
export function liveStage(jobs: BrainJobs | null, sinceCrawler: string | null, sinceAnalyst: string | null):
  { agent: "crawler" | "analyst"; job: BrainJob } | null {
  const a = jobs?.analyst;
  if (a && a.id !== sinceAnalyst && (a.status === "running" || a.status === "queued")) return { agent: "analyst", job: a };
  const c = jobs?.crawler;
  if (c && c.id !== sinceCrawler && (c.status === "running" || c.status === "queued")) return { agent: "crawler", job: c };
  if (a && a.id !== sinceAnalyst) return { agent: "analyst", job: a };
  if (c && c.id !== sinceCrawler) return { agent: "crawler", job: c };
  return null;
}

/** The bar's percentage for the given stage, 1–100. Never 0 while something is running — a bar
 *  glued to 0% reads as "stuck" long before the first real progress event arrives. */
export function pctFor(stage: { agent: "crawler" | "analyst"; job: BrainJob } | null): number {
  const p = stage?.job.progress ?? null;
  const idx = stage ? phaseIndex(stage.agent, p?.phase ?? null) : -1;
  const ph = idx >= 0 ? BRAIN_PHASES[idx] : null;
  const inner = ph && p?.total && p.done != null ? Math.min(1, p.done / p.total) : 0;
  return Math.max(1, Math.round((ph ? ph.from + (ph.to - ph.from) * inner : 0.01) * 100));
}
