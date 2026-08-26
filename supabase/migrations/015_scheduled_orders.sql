-- One-off orders placed in the chat: "30 min baad ek article publish kar do".
--
-- `schedules` (006) is a RECURRING timetable — one row per tenant, "every weekday at 09:00".
-- It cannot express "this one thing, once, at 16:32 today", and bending it to would break the
-- daily run the customer already depends on. So this is its own table.
--
-- Why it exists at all: the chat could start work now and it could answer questions, but a
-- message with a time in it had nowhere to go. "mujhe 30 min baad publish karna hai" started
-- the writer immediately, and when the user objected, the model replied "Mr. Publish — queued
-- for immediate publish (30 minutes from now)". Nothing was queued. There was no row, no job,
-- and no publish agent had ever run. A confirmation with no row behind it is a lie the
-- customer plans their week around, and the only durable fix is somewhere real to write it.

create table if not exists scheduled_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Who asked. Kept so "who scheduled this?" is answerable on a shared account.
  created_by uuid references auth.users(id) on delete set null,

  -- What to do when the moment arrives.
  --   write    -> keyword -> writer chain, on `topic` (or the tenant's niche when null)
  --   research -> keyword only, nothing written
  --   plan     -> the boss picks the topics, like the daily run
  --   publish  -> push `content_item_id` live; no new writing at all
  kind text not null check (kind in ('write', 'research', 'plan', 'publish')),
  topic text,
  content_item_id uuid references content_items(id) on delete cascade,
  -- For 'write': skip the approval queue when it lands. Only ever true because the customer
  -- said so in the same sentence that scheduled it.
  auto_publish boolean not null default false,

  -- The instant, in UTC. Absolute on purpose: "30 minutes from now" is only meaningful at the
  -- moment it was said, and a row that stores the phrase would drift every time it was read.
  run_at timestamptz not null,

  -- 'running' is the claim. The scheduler moves a row out of 'pending' BEFORE it starts the
  -- work, and only the writer whose update matched a still-pending row proceeds — so two
  -- overlapping ticks cannot both publish the same article to the customer's live site.
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  -- The agent job this turned into, once it fires. Null until then — which is what makes
  -- "was this actually started?" a question the database can answer.
  job_id text,
  error text,

  -- The customer's own sentence. The Schedule page shows this rather than a reconstruction,
  -- so what they see is what they typed.
  request text,

  created_at timestamptz not null default now(),
  fired_at timestamptz
);

-- The scheduler's only query: pending rows that are due. Partial, because the table is mostly
-- history after a week and history is never what the 60-second tick is looking for.
create index if not exists scheduled_orders_due_idx
  on scheduled_orders (run_at)
  where status = 'pending';

create index if not exists scheduled_orders_tenant_idx
  on scheduled_orders (tenant_id, run_at desc);

alter table scheduled_orders enable row level security;

-- Same rule as every other tenant-scoped table: members of the tenant, and nobody else. The
-- agent-server reads this with the service role, which bypasses RLS by design.
drop policy if exists "scheduled_orders_all_member" on scheduled_orders;
create policy "scheduled_orders_all_member" on scheduled_orders for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
