-- ============================================================================
--  MrLxwa — the whole schema, in order, for a FRESH Supabase project.
--
--  Generated from supabase/migrations/ (001 -> 023). Paste into the new
--  project's SQL Editor and Run. Order matters: 002 sets embeddings to 1024
--  dimensions and 022 moves them to 2048, so running these out of order leaves
--  the vector columns wrong.
--
--  If it stops on an error, run the individual files from 001 one at a time and
--  stop at whichever fails — that error is the real message.
--
--  Nothing to enable by hand first: 001 creates the `vector` and `pgcrypto`
--  extensions itself, and the `media` storage bucket is created by the code
--  (agent-server/src/lib/media/store.ts), not by SQL.
--
--  Regenerate after adding a migration:
--    for f in supabase/migrations/*.sql; do cat "$f" >> supabase/ALL_MIGRATIONS.sql; done
--
--  See docs/NEW_SUPABASE_PROJECT.md for the rest of the move.
-- ============================================================================


-- ============================================================
-- 001_init.sql
-- ============================================================

-- 001_init.sql — GrowthTeam AI multi-tenant schema + RLS
-- Run this in Supabase SQL Editor (or `supabase db push` once the CLI is linked).

create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  website_url  text,
  niche        text,
  tone_profile jsonb not null default '{}',
  icp_profile  jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create table if not exists memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);

create table if not exists integrations (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  type                   text not null, -- 'wordpress' | 'google' | 'meta' | 'linkedin' | ...
  encrypted_credentials  jsonb not null default '{}',
  status                 text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists content_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  type        text not null check (type in ('article', 'social', 'gbp')),
  status      text not null default 'draft' check (status in ('draft', 'awaiting_approval', 'approved', 'published', 'failed')),
  title       text,
  body        text,
  blueprint   jsonb not null default '{}',
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists site_pages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  url           text not null,
  title         text,
  content_text  text,
  embedding     vector(768), -- superseded by 002_embedding_dim.sql (vector(1024), NVIDIA NIM)
  created_at    timestamptz not null default now()
);

create table if not exists jobs_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  agent       text not null,
  action      text not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'success', 'error')),
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text,
  company     text,
  email       text,
  phone       text,
  source      text,
  icp_score   int,
  reason      text,
  stage       text not null default 'new',
  created_at  timestamptz not null default now()
);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  type        text not null,
  payload     jsonb not null default '{}',
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- HELPER: is_tenant_member() — security definer avoids RLS self-recursion on memberships
-- ============================================================

create or replace function public.is_tenant_member(check_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from memberships
    where memberships.tenant_id = check_tenant_id
      and memberships.user_id = auth.uid()
  );
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table tenants        enable row level security;
alter table memberships    enable row level security;
alter table integrations   enable row level security;
alter table content_items  enable row level security;
alter table site_pages     enable row level security;
alter table jobs_log       enable row level security;
alter table leads          enable row level security;
alter table notifications  enable row level security;

-- tenants: members can read/update their own tenant; any signed-in user can create one (onboarding)
create policy "tenants_select_member" on tenants for select
  using (is_tenant_member(id));
create policy "tenants_insert_authenticated" on tenants for insert
  with check (auth.role() = 'authenticated');
create policy "tenants_update_member" on tenants for update
  using (is_tenant_member(id));

-- memberships: a user sees memberships for tenants they belong to; can insert their own row
create policy "memberships_select_own_tenant" on memberships for select
  using (is_tenant_member(tenant_id));
create policy "memberships_insert_self" on memberships for insert
  with check (user_id = auth.uid());

-- every tenant-scoped table: full access gated on tenant membership
create policy "integrations_all_member" on integrations for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "content_items_all_member" on content_items for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "site_pages_all_member" on site_pages for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "jobs_log_all_member" on jobs_log for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "leads_all_member" on leads for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "notifications_all_member" on notifications for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_memberships_user      on memberships(user_id);
create index if not exists idx_memberships_tenant     on memberships(tenant_id);
create index if not exists idx_content_items_tenant   on content_items(tenant_id, status);
create index if not exists idx_site_pages_tenant      on site_pages(tenant_id);
create index if not exists idx_jobs_log_tenant        on jobs_log(tenant_id, created_at desc);
create index if not exists idx_leads_tenant           on leads(tenant_id, stage);
create index if not exists idx_notifications_tenant   on notifications(tenant_id, user_id, read);


-- ============================================================
-- 002_embedding_dim.sql
-- ============================================================

-- 002_embedding_dim.sql — switch embeddings provider from Gemini (768-dim) to
-- NVIDIA NIM nv-embedqa-e5-v5 (1024-dim), so we reuse the same NVIDIA account as
-- Boss AI (Step 7) instead of a separate Google AI Studio key.
-- Safe to run even if site_pages is still empty (it is, until Step 5 is actually used).

alter table site_pages alter column embedding type vector(1024);


-- ============================================================
-- 003_onboarded_flag.sql
-- ============================================================

-- 003_onboarded_flag.sql — onboarding completion must live in the DB, not just
-- browser localStorage, or every new browser/session re-asks the wizard.

alter table tenants add column if not exists onboarded boolean not null default false;


-- ============================================================
-- 004_content_rejected_status.sql
-- ============================================================

-- 004_content_rejected_status.sql — Step 12 (Approvals): a rejected item needs its own
-- status distinct from 'draft'/'failed' so the Approvals page can tell "user said no" apart
-- from "still being written" or "publish attempt errored".
alter table content_items drop constraint if exists content_items_status_check;
alter table content_items add constraint content_items_status_check
  check (status in ('draft', 'awaiting_approval', 'approved', 'published', 'failed', 'rejected'));


-- ============================================================
-- 005_site_pages_unique.sql
-- ============================================================

-- 005_site_pages_unique.sql — deep/full-site crawl (background job, not the old
-- onboarding-request-bound 15-page sample) needs to be safely re-runnable without piling
-- up duplicate rows for the same URL every time it runs.

-- Drop any exact (tenant_id, url) duplicates first, keeping the newest row.
delete from site_pages a using site_pages b
  where a.tenant_id = b.tenant_id and a.url = b.url and a.created_at < b.created_at;

alter table site_pages add constraint site_pages_tenant_url_unique unique (tenant_id, url);


-- ============================================================
-- 006_schedules.sql
-- ============================================================

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


-- ============================================================
-- 007_site_insights.sql
-- ============================================================

-- 007_site_insights.sql — what Google actually knows about this business.
--
-- site_pages (001) holds what the CRAWLER read off the site: titles and copy the business
-- wrote about itself. That says nothing about whether any of it works. This table holds the
-- other half — real Search Console queries/positions, real GA4 traffic, the real Business
-- Profile — so the agents can plan from evidence instead of from the homepage's adjectives.
--
-- Every row is a measurement with a period attached. Nothing in here is ever invented: if
-- Google returns no rows, no rows are stored, and the agents are told the data is absent
-- rather than being handed a guess.

create table if not exists site_insights (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  source       text not null check (source in ('gsc', 'ga4', 'gbp')),
  -- gsc:  'query' (a search someone typed) | 'page' (a landing page)
  -- ga4:  'page'  (a landing page)         | 'summary' (site totals)
  -- gbp:  'location' (a Business Profile)
  kind         text not null,
  key          text not null,                    -- the query text / page path / location id
  metrics      jsonb not null default '{}',      -- {clicks, impressions, ctr, position} etc.
  period_start date,
  period_end   date,
  captured_at  timestamptz not null default now(),
  unique (tenant_id, source, kind, key)
);

alter table site_insights enable row level security;

create policy "site_insights_all_member" on site_insights for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create index if not exists idx_site_insights_lookup on site_insights(tenant_id, source, kind);


-- ============================================================
-- 008_jobs_log_skipped.sql
-- ============================================================

-- 008_jobs_log_skipped.sql — make a refused job visible.
--
-- agent-server enforces a per-tenant daily cap per agent (agent-server/src/config/caps.ts).
-- The check ran BEFORE the job was ever written to jobs_log, so hitting the cap produced
-- absolutely nothing: the chat said "On it", the office stayed asleep, and there was no row,
-- no error and no explanation anywhere. Found live — Mr Lxwa sat on exactly 6/6 planning runs
-- and every further request vanished in silence.
--
-- A refused job is not an error (nothing broke) and not a success (no work happened), so it
-- needs its own state rather than being forced into one of those.

alter table jobs_log drop constraint if exists jobs_log_status_check;

alter table jobs_log add constraint jobs_log_status_check
  check (status in ('queued', 'running', 'success', 'error', 'skipped'));


-- ============================================================
-- 009_tenant_plan.sql
-- ============================================================

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


-- ============================================================
-- 010_tenant_memory.sql
-- ============================================================

-- 010_tenant_memory.sql — the team's memory has to outlive one browser.
--
-- The AI Memory list lived in localStorage under "gt-state", and signing out deletes that
-- key. So logging out wiped everything the team had "learned", and logging back in showed an
-- empty Memory page — even though the facts behind it (niche, tone, audience, pace, topics)
-- were sitting safely in the tenants row the whole time.
--
-- This column holds the list itself: the seeded facts plus anything the user has edited,
-- renamed or added by hand, which is the part that genuinely had nowhere else to live.
-- Shape: [{"k": "Brand tone", "v": "Professional"}, ...]

alter table tenants add column if not exists memory_facts jsonb not null default '[]';


-- ============================================================
-- 011_chat_history.sql
-- ============================================================

-- 011_chat_history.sql — the conversation with Mr Lxwa has to survive a refresh.
--
-- Chat lived entirely in React state. Reloading the page, or navigating between /app pages,
-- threw the whole conversation away — including the part where he told you which job he had
-- just started, which is the one thing you most want to scroll back to. There was also no way
-- to look at anything you asked yesterday.
--
-- Two tables rather than one blob per tenant: a conversation is the thing you reopen from a
-- list (like ChatGPT's sidebar), and messages have to be appendable one at a time while a
-- reply is still streaming.

create table if not exists chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Who started it. Kept so a multi-seat workspace can show "your chats" later; RLS is on
  -- the tenant, because teammates on the same workspace share the same team.
  user_id    uuid references auth.users(id) on delete set null,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  -- Denormalised on purpose: RLS has to check tenant membership without joining back to the
  -- parent row on every single insert.
  tenant_id       uuid not null references tenants(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

alter table chat_conversations enable row level security;
alter table chat_messages      enable row level security;

create policy "chat_conversations_all_member" on chat_conversations for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "chat_messages_all_member" on chat_messages for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- The two reads this powers: the conversation list, and one conversation in order.
create index if not exists idx_chat_conversations_tenant on chat_conversations(tenant_id, updated_at desc);
create index if not exists idx_chat_messages_conversation on chat_messages(conversation_id, created_at);


-- ============================================================
-- 012_keyword_choices.sql
-- ============================================================

-- 012_keyword_choices.sql — let the human pick the keyword before anything gets written.
--
-- Until now "write an article" went straight through: Mr. Keyword researched, picked whatever
-- came back first, and Mr. Writer started. The person who asked never saw the options and
-- never got a say in which one their article was about.
--
-- This row is the pause. Mr. Keyword writes the candidates here and schedules the writer to
-- start after a short window; the dashboard shows the table and a countdown; the writer reads
-- this row when it wakes and writes about whichever keyword won.
--
-- Deliberately server-side: the recommended keyword is chosen and scheduled here, so an
-- article still gets written when nobody is looking at the screen — a scheduled 9am run has
-- no browser open at all. The UI is an opportunity to override, not a requirement.

create table if not exists keyword_choices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  -- The seed the research started from, kept so the chat can say what was asked for.
  topic        text not null,
  -- [{keyword, searchVolume, competition, competitionLevel, cpc, impressions, position,
  --   source, recommended, why}] — exactly what was measured, nothing invented.
  candidates   jsonb not null default '[]',
  -- Everything the keyword agent found, so the writer can rebuild a blueprint for whichever
  -- keyword is chosen rather than only for the one that happened to be recommended.
  research     jsonb not null default '{}',
  recommended  text not null,
  chosen       text,
  chosen_by    text check (chosen_by in ('user', 'auto')),
  status       text not null default 'pending' check (status in ('pending', 'chosen', 'used')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

alter table keyword_choices enable row level security;

create policy "keyword_choices_all_member" on keyword_choices for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- The dashboard asks one question of this table: "is anything waiting on me right now?"
create index if not exists idx_keyword_choices_pending
  on keyword_choices(tenant_id, status, expires_at desc);


-- ============================================================
-- 013_chat_events.sql
-- ============================================================

-- 013_chat_events.sql — keep the team's reports in the transcript.
--
-- The green "Mr. Keyword found these five keywords, here are their volumes" lines lived only
-- in React state. They vanished on refresh and on reopening the thread — which is exactly
-- backwards: the keyword table with its measured numbers is the part you most want to look
-- back at when asking "why is this article about that?".
--
-- They are not turns in the conversation, though. Nobody said them to Mr Lxwa and he didn't
-- say them to anyone; they are the team reporting work. So they get their own kind rather
-- than being disguised as assistant messages, which keeps them out of the model's history
-- (where they would just be noise it already has in its live status block) while keeping
-- them on screen where they belong.

alter table chat_messages add column if not exists kind text not null default 'message';

alter table chat_messages drop constraint if exists chat_messages_kind_check;
alter table chat_messages add constraint chat_messages_kind_check
  check (kind in ('message', 'event'));

-- 'done' | 'error', for how the line is coloured. Null for ordinary messages.
alter table chat_messages add column if not exists tone text;


-- ============================================================
-- 014_schedule_auto_publish.sql
-- ============================================================

-- 014_schedule_auto_publish.sql — let a scheduled run publish without a second approval.
--
-- Every article this product has ever produced ends in Approvals, and that was right while a
-- run only happened because someone pressed a button: the button said "write it", the queue
-- asked "ship it?". A schedule is different. Turning on "har roz 9 baje 2 article" IS the
-- approval — it was given once, in advance, for every run. Making the customer come back each
-- morning to press approve on work they already asked for turns automation into a chore, and
-- an article nobody approves is an article that never ships.
--
-- So: opt-in, per schedule, default OFF. Existing rows keep today's behaviour exactly; nobody
-- wakes up to find their site has been posting on its own. When it is on, the quality gate is
-- still the last check — a draft that fails the gate is never published, and a publish attempt
-- that FAILS falls back to Approvals with the error recorded rather than being lost
-- (agent-server/src/agents/writer.ts).
--
-- Note for whoever applies this: lib/chat-context.ts deliberately reads schedules with
-- select("*") rather than naming columns, so Mr Lxwa keeps answering "kaunsa task schedule pe
-- hai" on a database where this migration has not been run yet. Naming auto_publish there
-- would fail the whole query over one missing column and cost him every other schedule fact.
-- app/api/schedule/route.ts names its columns but retries without this one and reports
-- autoPublishAvailable:false, which is what makes /app/schedule say "run migration 014"
-- instead of breaking.

alter table schedules add column if not exists auto_publish boolean not null default false;


-- ============================================================
-- 015_scheduled_orders.sql
-- ============================================================

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


-- ============================================================
-- 016_scheduled_orders_running.sql
-- ============================================================

-- Adds 'running' to scheduled_orders.status.
--
-- WHY THIS IS A SECOND FILE. 015 shipped and was applied before the claim step existed, so its
-- CHECK lists only pending/done/failed/cancelled. `create table if not exists` does nothing on
-- a database that already has the table — editing 015 in place would fix new installs and
-- leave every existing one broken, which is the worse half of the two.
--
-- What breaks without it, measured rather than assumed: the scheduler claims a row by moving
-- it out of 'pending' before it starts work, so two overlapping ticks cannot both publish the
-- same article. Against the old constraint that UPDATE fails with 23514, claim() returns
-- false, the tick moves on — and the order never fires. No error reaches the customer, the row
-- just sits at 'pending' forever while the countdown they were shown runs to zero and past it.
-- A booking that silently never happens is precisely the failure this table was added to end.

-- Found rather than named. Postgres would normally call this scheduled_orders_status_check,
-- but a constraint created by hand or by a different tool can be called anything, and a DROP
-- that silently matches nothing would leave this file reporting success while changing nothing
-- — the same shape of quiet failure it is here to remove.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.scheduled_orders'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table scheduled_orders drop constraint %I', c.conname);
  end loop;
end $$;

alter table scheduled_orders
  add constraint scheduled_orders_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'cancelled'));


-- ============================================================
-- 017_brain_tasks.sql
-- ============================================================

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


-- ============================================================
-- 018_intent_eval.sql
-- ============================================================

-- 018 · intent_eval: the evaluation set for the chat intent engine (rebuild plan §16).
--
-- One row per real user message in chat_messages. auto_label is what the model said
-- (scripts/label-intents.mjs, service role); human_label is what a person said on /app/eval.
-- The new intent engine is scored against human_label before it is allowed to deploy —
-- lib/eval/README.md has the gate. Label shape: lib/eval/intent-labels.ts.
--
-- Idempotent like 017 (create if not exists / drop policy if exists).

create table if not exists intent_eval (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references chat_messages(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  text            text not null,                  -- the user message, copied so the set is stable
  prior_assistant text,                           -- the assistant turn just before it, for follow-ups
  auto_label      jsonb,
  auto_model      text,
  human_label     jsonb,
  status          text not null default 'auto' check (status in ('auto', 'reviewed', 'skipped')),
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists intent_eval_tenant_status on intent_eval(tenant_id, status, created_at);
create index if not exists intent_eval_auto_intent on intent_eval(tenant_id, (auto_label->>'intent'));

alter table intent_eval enable row level security;

-- Per tenant only. No global read — a reviewer sees their own workspace's messages.
drop policy if exists "intent_eval_member_read" on intent_eval;
create policy "intent_eval_member_read" on intent_eval for select
  using (is_tenant_member(tenant_id));

-- Members may review (human_label / status / reviewed_*) rows of their tenant. No insert/delete
-- policy for members: rows and auto labels are written only by the service role, which bypasses
-- RLS. The trigger below stops a member update from touching the auto columns or the text.
drop policy if exists "intent_eval_member_review" on intent_eval;
create policy "intent_eval_member_review" on intent_eval for update
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create or replace function intent_eval_guard_member_update() returns trigger language plpgsql as $$
begin
  -- Service role (and any other non-authenticated caller, e.g. psql) may change anything.
  if auth.role() = 'authenticated' then
    new.message_id      := old.message_id;
    new.tenant_id       := old.tenant_id;
    new.text            := old.text;
    new.prior_assistant := old.prior_assistant;
    new.auto_label      := old.auto_label;
    new.auto_model      := old.auto_model;
    new.created_at      := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists intent_eval_guard on intent_eval;
create trigger intent_eval_guard before update on intent_eval
  for each row execute function intent_eval_guard_member_update();


-- ============================================================
-- 019_site_brain.sql
-- ============================================================

  -- 019 · Site Brain: the written-down understanding of one tenant's website (rebuild plan §25).
--
-- Today the crawl is STORED but never UNDERSTOOD: site_pages holds text + embeddings, and the
-- only thing anybody does with it is feed 40 page titles to the planner. §25 fixes that with
-- one artefact — a versioned `site_profile` every agent reads first — plus the two tables that
-- make it usable (a chunk index for retrieval) and the columns that make a duplicate article
-- impossible (a slug lock, and the embedding column Phase 2's semantic lock needs).
--
-- Three rules from the plan are enforced here, not just in the agent:
--   · a profile is EVIDENCE, not a guess — `sources` sits beside `profile`, per field, and a
--     row can never be written without a `built_from` saying which pages/period it was read
--     from. What the site does not say does not enter the profile.
--   · an edit is a NEW VERSION — nothing overwrites a profile's jsonb, ever. Rollback is one
--     UPDATE of `active`, and the freshness card (§25.9) diffs version N against N-1.
--   · exactly ONE active profile per tenant, guaranteed by the database rather than by
--     whichever process wrote last (partial unique index below).
--
-- Idempotent like 017/018 (create if not exists / drop policy if exists / add column if not
-- exists), so it can be re-run over a half-applied copy — the 015/016 lesson.
--
-- Nothing here is destructive: no existing table is dropped, no column is retyped, and the two
-- columns added to content_items are nullable with no default, so every row that exists today
-- stays exactly as valid as it was.

-- pgvector is already on (001_init.sql) and the site-wide dimension is 1024 (002, NVIDIA
-- nv-embedqa-e5-v5). Repeated here only so this file can be applied to a fresh database on its
-- own; `if not exists` makes it a no-op on the real one.
create extension if not exists vector;

-- ── site_profiles: the Site Brain itself, one row per version ────────────────────────────────
create table if not exists site_profiles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- 1, 2, 3 … per tenant. Not a timestamp: the freshness card and the rollback button both
  -- talk about "v3 → v4", and two versions written in the same second must still be ordered.
  version    integer not null,
  -- The whole SiteProfile object (agent-server/src/lib/siteProfile.ts): what_they_do,
  -- offerings, audience, buyer_intent, proof, topic_clusters, content_gaps, voice, geo,
  -- language, competitors, goals — plus the per-field `confidence` map.
  profile    jsonb not null default '{}'::jsonb,
  -- Per-field source list, mirrored out of profile.sources so SQL can ask "which pages did
  -- this claim come from" without digging through the whole document. Shape:
  -- {"proof": ["https://site/about"], "offerings": ["https://site/services/iso-9001"]}.
  sources    jsonb not null default '{}'::jsonb,
  -- What this version was built from: {pages: 84, page_urls: [...], gsc_period: {start, end},
  -- gsc_queries: 120}. Without it "the profile is wrong" is undebuggable.
  built_from jsonb not null default '{}'::jsonb,
  -- 'agent:analyst' | 'user:<uuid>' | 'system:recrawl'. A field the USER edited is never
  -- rewritten by the agent (§25.9) — knowing who wrote a version is how that stays true.
  created_by text not null default 'agent:analyst',
  active     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

-- One live profile per tenant, enforced by the database. Two agents finishing at once cannot
-- both leave their row active; the loser's insert/flip fails and is retried.
create unique index if not exists site_profiles_one_active on site_profiles(tenant_id) where active;
-- The version list on Settings → Site Brain, newest first, and the "what is the next version
-- number" read that saveProfile() does before every insert.
create index if not exists site_profiles_tenant_version on site_profiles(tenant_id, version desc);

alter table site_profiles enable row level security;
drop policy if exists "site_profiles_member_all" on site_profiles;
create policy "site_profiles_member_all" on site_profiles for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- ── content_items: the three columns the duplicate locks need (§25.5) ────────────────────────
-- Lock 1 (slug/title exact) and lock 2 (semantic, Phase 2) both live on this table. `cluster`
-- ties a written article back to the topic_cluster it belongs to, so the planner can rotate
-- coverage across clusters instead of writing five articles about the same one.
alter table content_items add column if not exists slug      text;
alter table content_items add column if not exists embedding vector(1024);   -- same model/dim as site_pages (002)
alter table content_items add column if not exists cluster   text;

-- LOCK 1, in the database. Partial: rows written before this migration (and any row whose
-- title cannot produce a slug at all — a title in a non-Latin script, say) keep slug null and
-- are simply not covered, rather than colliding with each other on ''.
create unique index if not exists content_items_tenant_slug
  on content_items(tenant_id, slug) where slug is not null;
-- The planner's "which clusters are already covered" question.
create index if not exists content_items_tenant_cluster
  on content_items(tenant_id, cluster) where cluster is not null;

-- ── knowledge_chunks: one retrieval index for the writer's RAG and (Phase 3) the chatbot ────
-- Deliberately ONE table rather than one per source: a chatbot answer and a writer's research
-- pass ask the same question ("what does this site say about X"), and the answer must not
-- depend on which of the two asked. source_kind + source_id say where a chunk came from so a
-- deleted page's chunks can be removed and never answered from again (§25.9).
create table if not exists knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- 'site_page' | 'content_item' | 'site_profile' | 'faq' | 'upload'
  source_kind text not null,
  source_id   text,                                  -- site_pages.id / content_items.id / free text
  url         text,                                  -- what a citation links to; null for FAQ/upload
  chunk_no    integer not null default 0,            -- 0-based position within the source
  text        text not null,
  embedding   vector(1024),
  -- Set on every re-crawl that still saw this chunk. A chunk whose last_seen stops moving is a
  -- page that disappeared, and stale answers are worse than no answers.
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (tenant_id, source_kind, source_id, chunk_no)
);

-- Retrieval is always tenant-scoped first (RLS and correctness both), so the btree carries
-- the tenant; the vector index below narrows within it.
create index if not exists knowledge_chunks_tenant_source
  on knowledge_chunks(tenant_id, source_kind, source_id);
create index if not exists knowledge_chunks_stale
  on knowledge_chunks(tenant_id, last_seen);

-- Vector indexes are the one thing here that can legitimately fail on a given database: hnsw
-- needs pgvector ≥ 0.5, ivfflat ≥ 0.4, and neither is worth aborting the whole migration for —
-- without an index the same queries still return the same rows, just by sequential scan, which
-- at a few hundred chunks per tenant is milliseconds. So: try the good one, fall back, and if
-- both are unavailable say so and carry on.
do $$
begin
  begin
    create index if not exists knowledge_chunks_embedding
      on knowledge_chunks using hnsw (embedding vector_cosine_ops);
  exception when others then
    begin
      create index if not exists knowledge_chunks_embedding
        on knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
    exception when others then
      raise notice 'knowledge_chunks: no vector index created (pgvector too old?) — exact scan will be used';
    end;
  end;

  -- Phase 2's semantic duplicate lock (§25.5 lock 2) compares a proposed topic against every
  -- draft and published item. Same reasoning as above: helpful, never load-bearing.
  begin
    create index if not exists content_items_embedding
      on content_items using hnsw (embedding vector_cosine_ops);
  exception when others then
    raise notice 'content_items: no vector index created — exact scan will be used';
  end;
end $$;

alter table knowledge_chunks enable row level security;
drop policy if exists "knowledge_chunks_member_all" on knowledge_chunks;
create policy "knowledge_chunks_member_all" on knowledge_chunks for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- ── gsc_opportunities: the quick-win list (§25.4) ────────────────────────────────────────────
-- Position 8–20 with real impressions is the cheapest growth there is: Google already shows
-- this business for that search and real people already see it — it is sitting at the bottom
-- of page one or the top of page two. Nobody in the product looks at this today.
--
-- Written against the REAL shape of site_insights (007): one row per query, numbers inside a
-- `metrics` jsonb, so every read has to survive a key that is missing or not a number. The CTE
-- does that per row with jsonb_typeof before any cast — a bare `(metrics->>'position')::numeric`
-- in the WHERE clause would abort the whole query the first time one row held a string.
--
-- security_invoker: a view is read with its OWNER's rights by default, which would hand every
-- tenant's Search Console data to anyone who selected from it. With this set, site_insights'
-- own RLS policy applies to whoever is asking — the same tenant isolation as the table.
-- It needs PostgreSQL 15 or newer (every Supabase project since 2023 is). If this statement
-- ever fails on an older server, the view must NOT be created without it — an un-invoked view
-- over site_insights is a cross-tenant data leak, so failing here is the correct outcome.
create or replace view gsc_opportunities
with (security_invoker = true) as
with q as (
  select
    tenant_id,
    key as query,
    case when jsonb_typeof(metrics->'clicks')      = 'number' then (metrics->>'clicks')::numeric      end as clicks,
    case when jsonb_typeof(metrics->'impressions') = 'number' then (metrics->>'impressions')::numeric end as impressions,
    case when jsonb_typeof(metrics->'ctr')         = 'number' then (metrics->>'ctr')::numeric         end as ctr,
    case when jsonb_typeof(metrics->'position')    = 'number' then (metrics->>'position')::numeric    end as position,
    period_start,
    period_end,
    captured_at
  from site_insights
  where source = 'gsc' and kind = 'query'
)
select
  tenant_id,
  query,
  coalesce(clicks, 0)      as clicks,
  coalesce(impressions, 0) as impressions,
  ctr,
  position,
  period_start,
  period_end,
  captured_at
from q
where position is not null
  and position >= 8 and position <= 20   -- the plan's quick-win band, inclusive at both ends
  and coalesce(impressions, 0) > 0       -- a position nobody ever saw is not an opportunity
order by impressions desc, position asc;

comment on view gsc_opportunities is
  'Plan §25.4 quick wins: GSC queries ranking 8-20 with impressions, best first. Read by the planner (new article or "expand this page") and by Mr. SEO. RLS follows site_insights.';

grant select on gsc_opportunities to authenticated, service_role;

-- ============================================================
-- 020_site_audits.sql
-- ============================================================

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


-- ============================================================
-- 021_keyword_ranks.sql
-- ============================================================

-- 021_keyword_ranks.sql — MASTER_PLAN §17.1/§17.8's "SerpBear rank tracking" (Phase 4,
-- 2026-08-28 decision: this was an open question in the plan itself — "Phase 2 me jodein ya
-- Phase 4?" — settled as Phase 4, alongside the rest of that phase's build).
--
-- Built as a live SERP check against DataForSEO (lib/dataforseo.ts's checkRank), not the
-- SerpBear app itself (a separate self-hosted service + its own DB) — same "real engine, no
-- bundled dashboard" substitution already made for Mr. Audit's Lighthouse (§17.3's own note).
--
-- WHY primary_keyword IS A NEW COLUMN ON content_items, NOT DERIVED FROM blueprint/title.
-- The article's exact ranking keyword already exists at write time (writer.ts's own `topic`
-- argument) but was never persisted as its own field — only folded into free-text `blueprint`.
-- Extracting it back out of prose or the title would be guesswork; storing it once, at the one
-- place it is already known exactly, is not.
alter table content_items add column if not exists primary_keyword text;

-- One row per rank CHECK, not per keyword — the history is the point (SerpBear's whole value
-- is the trend line, "did last week's change help"), same reasoning site_audits (020) already
-- used for score history.
create table if not exists keyword_ranks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  keyword text not null,
  domain text not null,
  -- null = not found in the top 100 organic results — a real, common outcome, not a failure.
  -- The check that produced null still gets a row: "we looked and it wasn't there yet" is
  -- different from "we never checked", and only a row distinguishes them on a trend graph.
  position int,
  url text,

  content_item_id uuid references content_items(id) on delete set null,

  checked_at timestamptz not null default now()
);

create index if not exists keyword_ranks_tenant_keyword_idx on keyword_ranks (tenant_id, keyword, checked_at desc);

alter table keyword_ranks enable row level security;

drop policy if exists keyword_ranks_tenant on keyword_ranks;
create policy keyword_ranks_tenant on keyword_ranks
  for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));


-- ============================================================
-- 022_embedding_dim_2048.sql
-- ============================================================

-- 022_embedding_dim_2048.sql — NVIDIA retired nv-embedqa-e5-v5 (HTTP 410, 2026-08-25), the
-- 1024-dim model every vector(1024) column here was built for. No 1024-dim replacement exists
-- on this account; the two models that do work (nemotron-3-embed-1b, llama-nemotron-embed-vl-
-- 1b-v2 — both verified live 2026-08-31) are 2048-dim. Code now points at nemotron-3-embed-1b
-- (agent-server/src/lib/embeddings.ts, lib/ai/embeddings.ts) — this migration is the column
-- side of that same fix.
--
-- Found live 2026-08-31 auditing agents/boss.ts's topic planner: every embed() call had been
-- failing since the 25th, which meant agents/crawler.ts indexed zero pages per crawl (each
-- page's embed() throws before its site_pages upsert — visible in the crawl's own `reason`
-- field) and agents/analyst.ts's content_gaps/topic_clusters — the single strongest signal
-- boss.ts's planTopics() reasons from — silently fell back to empty with no error surfaced,
-- because a rate-limited embed inside that scan is caught and skipped by design (one bad
-- query must not kill the whole gap pass).
--
-- A vector column cannot be widened in place while it holds narrower vectors — pgvector
-- rejects the ALTER once it tries to validate existing 1024-dim rows against vector(2048).
-- Every value currently in these columns was produced by the now-dead model anyway (useless
-- at any width), so this NULLs them first rather than attempting a cast. site_pages and
-- content_items need a real re-embed after this runs — see scripts/reembed-embeddings.mjs
-- (docs/MANUAL_STEPS.md). knowledge_chunks has no writer yet (Phase 3, still schema-only) —
-- nothing to lose there.
--
-- Safe to run more than once: nulling and re-typing an already-vector(2048) column is a no-op.

update site_pages set embedding = null where embedding is not null;
alter table site_pages alter column embedding type vector(2048);

update content_items set embedding = null where embedding is not null;

-- The hnsw index is typed to its column's old width and must go before the ALTER touches it,
-- same reasoning 019_site_brain.sql used building it: helpful, never load-bearing, so a
-- missing index degrades to sequential scan rather than aborting anything.
drop index if exists content_items_embedding;
alter table content_items alter column embedding type vector(2048);

update knowledge_chunks set embedding = null where embedding is not null;
drop index if exists knowledge_chunks_embedding;
alter table knowledge_chunks alter column embedding type vector(2048);

do $$
begin
  begin
    create index if not exists knowledge_chunks_embedding
      on knowledge_chunks using hnsw (embedding vector_cosine_ops);
  exception when others then
    begin
      create index if not exists knowledge_chunks_embedding
        on knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
    exception when others then
      raise notice 'knowledge_chunks: no vector index created (pgvector too old?) — exact scan will be used';
    end;
  end;

  begin
    create index if not exists content_items_embedding
      on content_items using hnsw (embedding vector_cosine_ops);
  exception when others then
    raise notice 'content_items: no vector index created — exact scan will be used';
  end;
end $$;


-- ============================================================
-- 023_media_and_review_split.sql
-- ============================================================

-- 023_media_and_review_split.sql — Mr. Image / Mr. Story, the storage half (MASTER_PLAN §19.4).
--
-- TWO THINGS, one migration, because §19.4 leans on both and either alone is useless:
--
-- 1. `media` — one row per image this platform has ever produced, keyed by (article, slot).
--    It is the reuse table. A Web Story does NOT generate its own body images: it reads the
--    article's own images back out of here and re-crops them (§19.4.5), which is what turns a
--    story from "8 AI images" into "2 AI images". It is also the audit trail for spend: the
--    prompt, the seed, which provider and which Cloudflare account answered, and what the
--    provider itself said the image cost. A free account gives ~57 images a day for the whole
--    platform, so "who spent what" has to be a fact, not a guess.
--
-- 2. `content_items.type` gains 'image_set' and 'web_story'. Owner, 2026-09-05: "content pe
--    images ka, web story ka, article ka — sab alag alag karke rakhna ki user usko review kar
--    sake". So one order files three separately reviewable rows tied together by
--    blueprint->>'parent_article_id' — the images can be approved while the story is still
--    being read, or rejected without stopping the article (it publishes with template images).
--
-- Safe to re-run.

-- ── 1 · media ─────────────────────────────────────────────────────────────────────────────
create table if not exists media (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  -- The article these belong to. Null is allowed on purpose: a social or story image that is
  -- not tied to an article still deserves a row (and still counts against the day's spend).
  article_id     uuid references content_items(id) on delete cascade,
  -- 'thumb' | 'hero' | 'inline_1..3' | 'og' | 'story_cover' | 'story_hook' — §19.4.2's slots.
  -- Not an enum: a new slot must never need a migration before an image can be filed.
  slot           text not null,
  url            text not null,
  width          integer,
  height         integer,
  bytes          integer,
  -- The exact H2 this image was made for (§19.4.3). Null for slots that belong to the article
  -- as a whole (thumb, hero) rather than to one section.
  anchor         text,
  alt            text,
  -- Everything needed to make this image AGAIN, byte for byte: the assembled prompt and the
  -- seed. Same article + same slot = same seed = same picture, so a re-run costs nothing new.
  prompt         text,
  seed           bigint,
  -- 'cloudflare' | 'nvidia' | 'unsplash' | 'pexels' | 'template' — the ladder in
  -- lib/media/providers.ts. 'template' means no AI was involved and nothing was spent.
  provider       text not null default 'template',
  -- Which account in the Cloudflare pool answered (1-based), and what it said the image cost.
  provider_account integer,
  neurons        numeric,
  -- Stock licences want the photographer credited; kept with the image, not in code.
  attribution    text,
  created_at     timestamptz not null default now()
);

-- The reuse lookup a story does: "every image this article has, in slot order".
create index if not exists idx_media_article on media(article_id, slot);
-- The daily budget count (§19.4.4): "how many AI images has this tenant made today".
create index if not exists idx_media_tenant_created on media(tenant_id, created_at desc);

alter table media enable row level security;

-- Same policy shape as site_audits (020) and every other tenant table here — the service role
-- (agent-server) bypasses RLS and does the writing; a signed-in user sees only their own.
drop policy if exists media_tenant on media;
create policy media_tenant on media
  for all
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ── 2 · content_items: three reviewable kinds instead of one ──────────────────────────────
alter table content_items drop constraint if exists content_items_type_check;
alter table content_items add constraint content_items_type_check
  check (type in ('article', 'social', 'gbp', 'image_set', 'web_story'));

-- Approvals groups the three rows of one order under their article. Without this index that
-- grouping is a sequential scan of every content item the tenant has ever had.
create index if not exists idx_content_items_parent
  on content_items ((blueprint->>'parent_article_id'))
  where blueprint ? 'parent_article_id';
