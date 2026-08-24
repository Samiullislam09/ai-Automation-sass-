/** Hard per-tenant daily caps, per agent type. Prevents one tenant from burning
 *  a whole day's AI budget (or a runaway loop) in one go.
 *
 *  Checked twice: at POST /jobs/:type, so the caller is TOLD the cap was hit instead of
 *  getting a job id for work that will never run, and again in workers.ts as a backstop for
 *  anything already sitting in the queue.
 *
 *  Retries do not count. A job that fails three times used to consume three of the day's
 *  allowance, so a handful of failures could quietly lock an agent out for the rest of the
 *  day — see isOverDailyCap() in jobsLog.ts.
 *
 *  Every cap can be raised without a code change: DAILY_CAP_BOSS=12 etc. in the environment. */
// Raised from the originals (boss 6 / writer 10 / keyword 50), which were set for a quiet
// production day and turned out to be far too tight for anyone actually using the product:
// six planning runs is an afternoon of testing, and one bad afternoon of retries could burn
// the writer's whole allowance without producing a single article.
//
// The writer is the only genuinely expensive agent here — every run is ~90s of a 30B model —
// so it stays the tightest of the useful ones, and the crawler (up to ~300 embedding calls a
// run) stays low on purpose.
const DEFAULTS: Record<string, number> = {
  boss: 25, // each run fans out into keyword+writer jobs, so it stays capped below them
  keyword: 150,
  writer: 40,
  social: 60,
  seo: 40,
  leads: 60,
  crawler: 5, // expensive (up to ~300 embed calls each) — a full re-crawl rarely needs to run more than a few times a day
};

export const DAILY_CAPS: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULTS).map(([agent, fallback]) => {
    const override = Number(process.env[`DAILY_CAP_${agent.toUpperCase()}`]);
    return [agent, Number.isFinite(override) && override > 0 ? override : fallback];
  })
);

export function capFor(agentType: string): number {
  return DAILY_CAPS[agentType] ?? 10;
}
