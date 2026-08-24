/** How much work a tenant may start in a day, and the guard that stops a bug bankrupting us.
 *
 *  These are two different things and they were previously one number, which is why a paying
 *  customer got rationed like a trial:
 *
 *  1. PLAN CAPS — commercial. What the customer bought. A free trial is deliberately small;
 *     a paid plan is generous; the top plan has NO daily cap at all (null). This is a product
 *     decision, not an engineering one, and it lives here so it can be changed like one.
 *
 *  2. RUNAWAY GUARD — technical, and it applies to everyone including the top plan and
 *     including custom overrides. It exists for one scenario: a loop or a bad retry policy
 *     enqueuing thousands of jobs in an hour. No human hits it. If it ever fires, something
 *     is broken and the bill would otherwise be enormous. Removing it would mean a single
 *     bug could spend real money without limit, so "unlimited" stops here and nowhere else.
 *
 *  Overrides, most specific wins:
 *      tenants.daily_cap_overrides  ->  DAILY_CAP_* env  ->  the tenant's plan
 *  A cap of `null` at any level means no daily cap for that agent.
 */

export type Plan = "free" | "starter" | "growth";
export const PLANS: Plan[] = ["free", "starter", "growth"];

/** null = no daily cap on that agent for that plan. */
type PlanCaps = Record<string, number | null>;

const PLAN_CAPS: Record<Plan, PlanCaps> = {
  // A trial should be enough to see the whole product work end to end, once or twice.
  free: { boss: 5, keyword: 30, writer: 3, social: 10, seo: 10, leads: 10, crawler: 2 },

  // Paid. Comfortably above what anyone runs by hand in a day, so the cap is never the thing
  // a customer notices — their monthly allowance is what they actually bought.
  starter: { boss: 40, keyword: 300, writer: 30, social: 100, seo: 60, leads: 100, crawler: 5 },

  // Top plan: no daily rationing at all. Only the runaway guard below still applies.
  growth: { boss: null, keyword: null, writer: null, social: null, seo: null, leads: null, crawler: 10 },
};

/** Per hour, every plan, no exceptions. Sized so that a human being cannot reach it and a
 *  runaway loop hits it within a minute or two. The writer is the expensive one — roughly 90s
 *  of a 30B model per article — so it is the tightest. */
const RUNAWAY_PER_HOUR: Record<string, number> = {
  boss: 60,
  keyword: 400,
  writer: 60,
  social: 200,
  seo: 200,
  leads: 200,
  crawler: 12,
};

export function runawayLimit(agentType: string): number {
  return RUNAWAY_PER_HOUR[agentType] ?? 200;
}

function envOverride(agentType: string): number | null | undefined {
  const raw = process.env[`DAILY_CAP_${agentType.toUpperCase()}`];
  if (raw === undefined || raw === "") return undefined;
  // DAILY_CAP_WRITER=off / unlimited / 0 -> no daily cap for that agent, everywhere.
  if (/^(off|none|unlimited|0)$/i.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The daily cap in force for one tenant + agent. `null` means no daily cap. */
export function capFor(agentType: string, plan?: string | null, overrides?: Record<string, unknown> | null): number | null {
  // 1. Per-tenant override — the custom-contract escape hatch. `null` here is meaningful
  //    ("this client is never capped"), so check for the KEY, not for a truthy value.
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, agentType)) {
    const v = overrides[agentType];
    if (v === null) return null;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 2. Deployment-wide env override.
  const env = envOverride(agentType);
  if (env !== undefined) return env;

  // 3. The plan. An unknown plan value is treated as free rather than as unlimited — the
  //    safe direction when the data is wrong.
  const caps = PLAN_CAPS[(plan as Plan) ?? "free"] ?? PLAN_CAPS.free;
  return caps[agentType] ?? PLAN_CAPS.free[agentType] ?? 10;
}

/** What /version reports, so the dashboard can show a tenant their real allowance.
 *  EFFECTIVE, not declared: any DAILY_CAP_* env override is folded in here too, otherwise the
 *  panel would happily show 30 while the server enforced 5. Per-tenant overrides can't be
 *  folded in (they're per row) — the dashboard applies those itself, from the same tenant row.
 */
export const CAP_TABLE = {
  plans: Object.fromEntries(
    Object.entries(PLAN_CAPS).map(([plan, caps]) => [
      plan,
      Object.fromEntries(
        Object.entries(caps).map(([agent, declared]) => {
          const env = envOverride(agent);
          return [agent, env === undefined ? declared : env];
        })
      ),
    ])
  ) as Record<Plan, PlanCaps>,
  runawayPerHour: RUNAWAY_PER_HOUR,
};
