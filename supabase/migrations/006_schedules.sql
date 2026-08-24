-- 006_schedules.sql — recurring automation.
--
-- Until now NOTHING in this product ran on its own: every article existed because a human
-- pressed "Run the team" or asked Mr Lxwa in chat. This table is what the agent-server's
-- minute tick (agent-server/src/scheduler.ts) reads to start the boss -> keyword -> writer
-- chain by itself.
--
-- Time is stored as the tenant's LOCAL wall-clock ("09:00") plus their IANA timezone,
-- not as UTC: "har roz subah 9 baje" has to survive daylight saving, and a UTC instant
-- doesn't.

create table if not exists schedules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null default 'article' check (kind in ('article', 'social')),
  enabled      boolean not null default false,
  frequency    text not null default 'daily' check (frequency in ('daily', 'weekdays', 'weekly')),
  day_of_week  int not null default 1 check (day_of_week between 0 and 6), -- 0=Sunday, weekly only
  time_of_day  text not null default '09:00',                             -- HH:MM, tenant local
  timezone     text not null default 'UTC',                               -- IANA, e.g. Asia/Dubai
  count        int not null default 2 check (count between 1 and 5),      -- topics planned per run
  last_run_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, kind)
);

alter table schedules enable row level security;

create policy "schedules_all_member" on schedules for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- The scheduler scans every enabled row once a minute across all tenants.
create index if not exists idx_schedules_enabled on schedules(enabled) where enabled;
