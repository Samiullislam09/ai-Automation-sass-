-- 020_site_audits.sql — Mr. Audit's results (MASTER_PLAN §7.4, Phase 3).
--
-- One row per audit run. The row is the whole report: the score, what was checked, and every
-- issue found, so a report from six months ago still renders exactly as it did on the day —
-- rather than being re-derived by whatever version of the checks happens to be deployed.
--
-- WHY THE SCORE IS A COLUMN AND THE ISSUES ARE JSONB. The score and the counts are queried:
-- "show me the trend", "is it better than last week". The issues are only ever read whole,
-- for one report, and their shape belongs to the check catalogue, which will grow. A table of
-- issues would mean a migration every time a check is added, and joins for a list nobody
-- filters. §7.4's own words: "JSON → site_audits table".

create table if not exists site_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- 0-100, the house formula: 100 - 25*block - 5*warn, clamped. Same shape as the quality gate
  -- and Mr. SEO, so a customer never has to learn a second scale.
  score int not null,
  -- The previous run's score, copied in at write time. Denormalised on purpose: the trend
  -- arrow is shown on every report card, and a window function over a per-tenant history is a
  -- lot of machinery for "+6 since last week".
  previous_score int,

  pages_checked int not null default 0,
  blocks int not null default 0,
  warns int not null default 0,

  -- [{ id, severity, what, fix, pages: [url], count }]
  issues jsonb not null default '[]'::jsonb,
  -- What the run itself did: { started_at, finished_at, seconds, limit, skipped: [...] }.
  run jsonb not null default '{}'::jsonb,
  -- The five sentences the customer actually reads.
  summary text,

  created_at timestamptz not null default now()
);

create index if not exists site_audits_tenant_created_idx on site_audits (tenant_id, created_at desc);

alter table site_audits enable row level security;

-- Same policy shape as every other tenant table (see 001_init.sql): membership, not ownership.
drop policy if exists site_audits_tenant on site_audits;
create policy site_audits_tenant on site_audits
  for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
