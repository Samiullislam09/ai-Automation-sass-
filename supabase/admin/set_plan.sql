-- Admin snippets — run these by hand in the Supabase SQL editor.
--
-- Nothing in here is a migration; it is the day-to-day "give this account the paid plan"
-- work that has no UI yet, because the billing page is still a mock. When real billing
-- lands, the payment webhook does this and these snippets become the manual override for
-- support cases and testing.
--
-- Plans and what they allow live in agent-server/src/config/caps.ts.
--   free    — 3 articles/day. A trial: enough to watch the pipeline work once or twice.
--   starter — 30 articles/day.
--   growth  — no daily cap at all. Only the per-hour runaway guard still applies.


-- ── See who is on what ────────────────────────────────────────────────────────────────
select t.id, t.name, t.plan, t.daily_cap_overrides, u.email
from tenants t
left join memberships m on m.tenant_id = t.id
left join auth.users  u on u.id = m.user_id
order by t.created_at desc;


-- ── Give an account the growth plan, by email ─────────────────────────────────────────
-- The usual one. Works for your own account and for a client you're onboarding by hand.
update tenants
set plan = 'growth'
where id in (
  select m.tenant_id
  from memberships m
  join auth.users u on u.id = m.user_id
  where u.email = 'you@example.com'      -- <-- change this
);


-- ── Or by tenant name, if you already know it ─────────────────────────────────────────
-- update tenants set plan = 'growth' where name = 'acme-co';


-- ── Back to free ──────────────────────────────────────────────────────────────────────
-- update tenants set plan = 'free' where name = 'acme-co';


-- ── One client, one agent, no limit ever ──────────────────────────────────────────────
-- Sits ON TOP of the plan, for a custom contract. null = never cap that agent for them;
-- a number raises just that one. Everything not listed keeps the plan's own value.
-- update tenants
-- set daily_cap_overrides = '{"writer": null, "boss": 100}'::jsonb
-- where name = 'acme-co';

-- Remove the override again (back to whatever the plan says):
-- update tenants set daily_cap_overrides = '{}'::jsonb where name = 'acme-co';


-- ── Today's usage, per agent ──────────────────────────────────────────────────────────
-- What the cap check actually counts: first attempts only, retries excluded — matching
-- countSince() in agent-server/src/jobsLog.ts. Rows written before `attempt` existed have
-- no such field and still count, which is why the coalesce is there.
select agent, count(*) as used_today
from jobs_log
where tenant_id = (select id from tenants where name = 'acme-co')   -- <-- change this
  and created_at >= date_trunc('day', now())
  and coalesce(detail->>'attempt', '1') = '1'
group by agent
order by used_today desc;
