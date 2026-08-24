-- 009_tenant_plan.sql — the plan has to live in the database.
--
-- Until now `plan` existed only in the browser (lib/store.tsx -> localStorage), so the server
-- had no idea whether it was serving a free trial or a paying customer, and the daily caps in
-- agent-server were one flat number for everyone. That is the wrong shape: a customer who has
-- paid should not be rationed like a trial, and a trial should not get a paying customer's
-- budget.

alter table tenants add column if not exists plan text not null default 'free';

-- Kept as a plain check rather than an enum so adding a tier later is one migration, not a
-- type rewrite. Matches PLANS in lib/store.tsx.
alter table tenants drop constraint if exists tenants_plan_check;
alter table tenants add constraint tenants_plan_check
  check (plan in ('free', 'starter', 'growth'));

-- Per-tenant escape hatch, on top of the plan: {"writer": 200} raises just that agent for
-- just this tenant, and {"writer": null} removes its daily cap entirely. For the big client
-- on a custom contract who should never see a limit — no code change, no redeploy.
alter table tenants add column if not exists daily_cap_overrides jsonb not null default '{}';
