/** Hard per-tenant daily caps, per agent type. Prevents one tenant from burning
 *  a whole day's AI budget (or a runaway loop) in one go. Read at job-time in worker.ts —
 *  edit these numbers directly for now; move to a DB-driven per-plan config later. */
export const DAILY_CAPS: Record<string, number> = {
  keyword: 50,
  writer: 10,
  social: 20,
  seo: 10,
  leads: 20,
  crawler: 2, // expensive (up to ~300 embed calls each) — a full re-crawl rarely needs to run more than once or twice a day
};

export function capFor(agentType: string): number {
  return DAILY_CAPS[agentType] ?? 10;
}
