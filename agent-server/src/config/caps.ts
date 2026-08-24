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
const DEFAULTS: Record<string, number> = {
  boss: 6, // each run fans out into keyword+writer jobs, so it is capped well below them
  keyword: 50,
  writer: 10,
  social: 20,
  seo: 10,
  leads: 20,
  crawler: 2, // expensive (up to ~300 embed calls each) — a full re-crawl rarely needs to run more than once or twice a day
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
