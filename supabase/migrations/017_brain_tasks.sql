-- 017 · The brain's own tables: agents, tasks, steps, runs, events, conversation state, prompts.
--
-- Rebuild plan §9. Nothing here replaces an existing table: content_items, schedules,
-- scheduled_orders and jobs_log stay exactly as they are and keep being read by the
-- dashboard. New work is written here; the old tables become read-only over Phase 1
-- (plan §22 con #10) with no data migration script at all.
--
-- Idempotent on purpose (create if not exists / drop policy if exists) so it can be re-run
-- on a database that already has a half-applied copy — the 015/016 lesson.

-- ── agents: the registry (one row per agent service, filled from its /manifest) ──────────
create table if not exists agents (
  id           text primary key,                 -- "keyword", "writer", …
  name         text not null,
  version      text not null default '0.0.0',
  manifest     jsonb not null,                    -- the full manifest as served
  base_url     text,                              -- null = in-process adapter
  enabled      boolean not null default true,
  healthy_at   timestamptz,
  updated_at   timestamptz not null default now()
);
-- Registry is global, not per tenant. Only the service role writes it; members may read it
-- so the office can draw rooms from manifests.
alter table agents enable row level security;
drop policy if exists "agents_read_all_members" on agents;
create policy "agents_read_all_members" on agents for select using (auth.role() = 'authenticated');

-- ── tasks: one user-meaningful order ("write an article about X, publish it at 5pm") ──────
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  user_id         uuid,
  kind            text not null,                  -- manifest action id: write_article, find_keywords, …
  params          jsonb not null default '{}'::jsonb,
  status          text not null default 'queued'
                  check (status in ('awaiting_confirm','queued','scheduled','running','choosing',
                                    'awaiting_approval','done','published','failed','needs_attention','cancelled')),
  delivery        text not null default 'approvals' check (delivery in ('approvals','publish','chat')),
  source          text not null default 'chat' check (source in ('chat','schedule','ui','api')),
  conversation_id uuid,
  run_at          timestamptz,                    -- null = now
  echo            text,                           -- the one line the user was shown / confirmed
  confirmed_at    timestamptz,
  idempotency_key text,                           -- hash(tenant, conversation, intent, minute)
  cost_units      integer not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists tasks_idem on tasks(tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists tasks_tenant_status on tasks(tenant_id, status, created_at desc);
create index if not exists tasks_due on tasks(run_at) where status = 'scheduled';
alter table tasks enable row level security;
drop policy if exists "tasks_member_all" on tasks;
create policy "tasks_member_all" on tasks for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- ── task_steps: the plan, one row per agent action, in order ──────────────────────────────
create table if not exists task_steps (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  tenant_id   uuid not null,                      -- denormalised so RLS needs no join
  no          integer not null,                   -- 1-based order; equal numbers run in parallel
  agent_id    text not null,
  action      text not null,
  needs       text[] not null default '{}',       -- names of outputs this step waits for
  provides    text not null,                      -- the output name this step produces ("keywords", "article", …)
  optional    boolean not null default false,     -- may fail without failing the task (images)
  status      text not null default 'pending'
              check (status in ('pending','running','done','failed','skipped','cancelled')),
  input       jsonb,
  output      jsonb,
  error       text,
  attempts    integer not null default 0,
  started_at  timestamptz,
  finished_at timestamptz,
  unique (task_id, no, agent_id)
);
create index if not exists task_steps_task on task_steps(task_id, no);
alter table task_steps enable row level security;
drop policy if exists "task_steps_member_all" on task_steps;
create policy "task_steps_member_all" on task_steps for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- ── agent_runs: every call to an agent, including retries; run_id is the idempotency key ──
create table if not exists agent_runs (
  id          uuid primary key default gen_random_uuid(),
  run_id      text not null unique,               -- sent to the agent; a duplicate callback is ignored
  step_id     uuid not null references task_steps(id) on delete cascade,
  tenant_id   uuid not null,
  agent_id    text not null,
  status      text not null default 'sent' check (status in ('sent','accepted','done','failed','timeout')),
  ms          integer,
  cost_units  integer not null default 0,
  llm_calls   integer not null default 0,
  tokens_in   integer not null default 0,
  tokens_out  integer not null default 0,
  raw         jsonb,                              -- the callback body, for debugging
  created_at  timestamptz not null default now(),
  callback_at timestamptz
);
create index if not exists agent_runs_step on agent_runs(step_id);
create index if not exists agent_runs_tenant_day on agent_runs(tenant_id, created_at desc);
alter table agent_runs enable row level security;
drop policy if exists "agent_runs_member_read" on agent_runs;
create policy "agent_runs_member_read" on agent_runs for select using (is_tenant_member(tenant_id));

-- ── task_events: the timeline. message_user is what people see; message_dev is for us ────
create table if not exists task_events (
  id           bigserial primary key,
  task_id      uuid not null references tasks(id) on delete cascade,
  tenant_id    uuid not null,
  step_id      uuid,
  agent_id     text,
  at           timestamptz not null default now(),
  kind         text not null,                     -- AG-UI style: run_started, step_started, progress, data, step_finished, run_error, …
  message_user text,
  message_dev  text,
  payload      jsonb                              -- for kind='data': the item that appeared (a keyword, a section, an image)
);
create index if not exists task_events_task on task_events(task_id, id);
create index if not exists task_events_tenant_recent on task_events(tenant_id, at desc);
alter table task_events enable row level security;
drop policy if exists "task_events_member_read" on task_events;
create policy "task_events_member_read" on task_events for select using (is_tenant_member(tenant_id));

-- ── conversation_state: the pending order a follow-up ("haan", "tum chuno") resolves against
create table if not exists conversation_state (
  conversation_id uuid primary key,
  tenant_id       uuid not null,
  pending_intent  jsonb,                          -- the structured intent waiting on a slot or a yes
  asked_slot      text,                           -- "topic" | "confirm" | "delivery" | null
  expires_at      timestamptz,
  turn_no         integer not null default 0,
  updated_at      timestamptz not null default now()
);
alter table conversation_state enable row level security;
drop policy if exists "conversation_state_member_all" on conversation_state;
create policy "conversation_state_member_all" on conversation_state for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- ── prompts: versioned prompt text, so a prompt change is a row, not a deploy ─────────────
create table if not exists prompts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                       -- "writer.section", "intent.system", …
  version    integer not null,
  body       text not null,
  model      text,
  params     jsonb not null default '{}'::jsonb,
  active     boolean not null default false,
  note       text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (name, version)
);
create unique index if not exists prompts_one_active on prompts(name) where active;
alter table prompts enable row level security;   -- service role only; no member policy on purpose

-- ── tenant_style: what Approvals taught us about this tenant's voice ─────────────────────
create table if not exists tenant_style (
  tenant_id      uuid primary key references tenants(id) on delete cascade,
  liked_examples jsonb not null default '[]'::jsonb,   -- [{excerpt, from_item}]
  avoid          jsonb not null default '[]'::jsonb,   -- [{reason, pattern?, from_item}]
  tone_notes     text,
  updated_at     timestamptz not null default now()
);
alter table tenant_style enable row level security;
drop policy if exists "tenant_style_member_all" on tenant_style;
create policy "tenant_style_member_all" on tenant_style for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- updated_at maintenance for the two tables that are edited in place
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks for each row execute function touch_updated_at();
drop trigger if exists conversation_state_touch on conversation_state;
create trigger conversation_state_touch before update on conversation_state for each row execute function touch_updated_at();
