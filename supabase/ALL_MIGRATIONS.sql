-- ============================================================================
--  MrLxwa — the whole schema, in order, for a FRESH Supabase project.
--
--  Generated from supabase/migrations/ (001 -> 028). Paste into the new
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


-- ============================================================
-- 024_jobs_log_slim_detail.sql
-- ============================================================

-- Strips the dead weight out of jobs_log.detail (2026-09-05 egress audit).
--
-- workers.ts filed each agent's ENTIRE return value as the job's receipt, so Mr. Writer stored
-- a second copy of every article in here (~15 KB) and Mr. Audit stored the whole report — every
-- issue plus a per-page row with LCP/CLS/TBT for up to 200 pages (100 KB+). All of it already
-- lives where it belongs: content_items.body, site_audits.
--
-- Nothing reads these keys. lib/dashboard-data.ts's describeJob(), the only thing that turns a
-- detail into a sentence, uses counts, titles, reasons and the quality gate — never `body`,
-- `blueprint`, `issues`, `meta` or `run.pages`.
--
-- What they cost: the dashboard's live poll re-read 61 of these rows every four seconds and the
-- schedule history reads 150 of the fattest at a time, which is how a 36 MB database with one
-- active user burned Supabase's 5 GB monthly egress allowance in four days and got the whole
-- organisation restricted.
--
-- New rows are trimmed at the source (agent-server/src/jobsLog.ts, trimJobDetail). This is the
-- one-time clean-up for rows already on file. Safe to run more than once: a row that no longer
-- holds any of these keys is not matched.

update jobs_log
set detail = detail - 'body' - 'blueprint' - 'issues' - 'meta' - 'pages' - 'pageSummary' - 'html' - 'markdown'
where jsonb_typeof(detail) = 'object'
  and detail ?| array['body', 'blueprint', 'issues', 'meta', 'pages', 'pageSummary', 'html', 'markdown'];

-- The audit's per-page table, one level down.
update jobs_log
set detail = jsonb_set(detail, '{run}', (detail -> 'run') - 'pages')
where jsonb_typeof(detail) = 'object'
  and jsonb_typeof(detail -> 'run') = 'object'
  and (detail -> 'run') ? 'pages';

-- A `cause` is whatever the failing library said, which can be an entire API error body.
update jobs_log
set detail = jsonb_set(detail, '{cause}', to_jsonb(left(detail ->> 'cause', 2000) || ' …[truncated]'))
where jsonb_typeof(detail) = 'object'
  and jsonb_typeof(detail -> 'cause') = 'string'
  and length(detail ->> 'cause') > 2000;

-- 025_site_pages_full_text.sql — the crawl stops being a sample.
--
-- MEASURED ON THE LIVE DATABASE, 2026-09-19, and every number here is from that workspace:
--
--  1. EVERY SERVICE PAGE WAS MISSING. The site's sitemap lists 135 URLs. 28 of them were not in
--     site_pages, and they were the ones that earn the money: all 15 /iso/iso-XXXXX
--     service pages (9001, 14001, 27001, 45001, 22000, 13485, 22301, 50001, 37001, 41001,
--     42001, 27701, 21001, 20121, 17298), plus /iso, /pricing, /services and /gap-analysis.
--     The other 13 were category and tag pages. `select ... where url like '%/iso/%'` returned zero rows.
--     What was stored instead: /cart, /checkout, /my-account, /payment-failed, and 13-character
--     empty ElementsKit mega-menu fragments. Those URLs appear in no sitemap, which is how we
--     know the homepage-link FALLBACK produced this set and the sitemap path never ran — and
--     because the crawler upserts and never prunes, that one bad run has been the permanent
--     truth ever since.
--
--  2. EVERY PAGE WAS TRUNCATED AT 4000 CHARACTERS. Across 156 rows: median 4000, max 4000. The
--     longest page ended mid-word ("…ISO 9001 Lead Audi"). Everything past 4000 chars of every
--     page on the site has never existed as far as this product is concerned.
--
--  3. NOTHING WAS RE-CRAWLED. All 156 rows were written in one eight-minute window on
--     2026-09-07 and never touched again. Twelve days stale on the day this was written, with
--     no record of when a page was last confirmed to exist.
--
--  4. META DESCRIPTIONS AND HEADINGS WERE NEVER CAPTURED AT ALL — not truncated, absent. A
--     page's own summary of itself is the single most useful sentence on it, and Mr. SEO's
--     audit complains about missing meta descriptions on pages this table cannot describe.
--
-- This migration is the storage half of the fix. The crawler half (union discovery instead of
-- sitemap-or-fallback, full text, headings, pruning) is in agent-server/src/lib/crawl.ts and
-- agent-server/src/agents/crawler.ts.
--
-- Safe to re-run.

-- ── What a page actually says about itself ───────────────────────────────────────────────
-- The <meta name="description">. Null is meaningful and stays meaningful: it means the page
-- does not have one, which is a real SEO finding, not missing data.
alter table site_pages add column if not exists meta_description text;

-- The page's own outline: [{"level": 1, "text": "ISO 9001 Certification"}, {"level": 2, ...}].
-- Stored structured rather than flattened into content_text because "what is this page about"
-- is answered by its H1 and H2s far better than by its first 400 words, and a retrieval layer
-- wants to chunk ON these boundaries rather than every N characters.
alter table site_pages add column if not exists headings jsonb not null default '[]'::jsonb;

-- The <link rel="canonical">. Two URLs that canonicalise to one page are one page; without
-- this the same content is indexed twice and both copies look equally authoritative.
alter table site_pages add column if not exists canonical text;

-- Words in content_text after extraction. Cheap to compute once, and it is the honest way to
-- tell a real page from a 13-character mega-menu fragment without re-reading the text.
alter table site_pages add column if not exists word_count integer;

-- ── Freshness, so "the brain is stale" is a fact rather than a suspicion ─────────────────
-- Set on every crawl that saw this page. created_at answers "when did we first meet this
-- page"; it cannot answer "is this still what the page says", and that was the question.
alter table site_pages add column if not exists last_seen timestamptz not null default now();
alter table site_pages add column if not exists fetched_at timestamptz;

-- The HTTP status the last fetch got. A page that started returning 404 must stop being quoted
-- as the customer's own copy; storing the code makes that a query instead of a guess.
alter table site_pages add column if not exists status_code integer;

-- How many links from the homepage this page was found at (0 = the site root / sitemap).
-- Discovery bugs are depth bugs: /iso/iso-9001 was never reached because nothing followed the
-- links on /iso, and without a depth column that was invisible.
alter table site_pages add column if not exists depth integer;

-- ── Indexes for the two questions the crawler and the chat actually ask ──────────────────
-- "which of this tenant's pages did the current crawl not see" — the prune step.
create index if not exists idx_site_pages_last_seen on site_pages(tenant_id, last_seen);
-- "give me this tenant's real pages, biggest first" — what a lookup wants, so an empty
-- mega-menu fragment never outranks a service page.
create index if not exists idx_site_pages_words on site_pages(tenant_id, word_count desc);

-- Existing rows have never had any of this measured. Backfilling word_count from the text we
-- do hold is honest (it is a count of what is there); backfilling the rest would be invention,
-- so they stay null until a real crawl fills them.
update site_pages
   set word_count = array_length(regexp_split_to_array(trim(content_text), '\s+'), 1)
 where word_count is null
   and content_text is not null
   and trim(content_text) <> '';

-- 026_analyst_vector_rpcs.sql — the analyst stops shipping vectors over the wire.
--
-- MEASURED ON THE LIVE DATABASE, 2026-09-27, inside a rolled-back transaction against the
-- wca-global.com workspace (134 crawled pages, all 134 carrying a vector). Per analyst run:
--
--     page vectors, as PostgREST sends them ....... 3366 KB   (25.1 KB per page)
--     page vectors, rounded to 5 decimals ......... 2246 KB   (16.8 KB per page)
--     page text (content_text) ....................  810 KB   ( 6.0 KB per page)
--
-- agent-server/src/agents/analyst.ts read every run as:
--
--     .select("id, url, title, content_text, embedding").limit(300)
--
-- so four fifths of the ~4.2 MB it pulled down was float characters: `embedding` is vector(2048)
-- since 022 and PostgREST renders a vector as its text form. At the 300-page ceiling that is
-- ~7.4 MB of vectors per run. The analyst runs after every crawl, on every "run the team", and on
-- the weekly audit sweep, so three tenants doing that a few times a day is hundreds of MB a day
-- against a 5 GB/month free egress allowance. That is what has been exhausting the quota every
-- five days with three users and a database small enough to fit in a phone's photo album.
--
-- A FIRST DRAFT OF THIS COMMENT GUESSED 40 KB per page and 12 MB per run, from "roughly 20
-- characters per component". Both were wrong: pgvector prints float4 in its shortest
-- round-trip form, so a component is nearer 12 characters, and this tenant has 134 pages
-- rather than 300. The numbers above are the measured ones.
--
-- Those vectors were fetched for exactly two calculations, and both belong in the database:
--
--   · content gaps  — "which Search Console query has no page near it": one nearest-neighbour
--                     lookup per query. analyst_nearest_page() below. Zero vectors on the wire.
--   · topic clusters — spherical k-means, which genuinely needs every vector. That stays in
--                     TypeScript (it is deterministic and tested), but analyst_page_vectors()
--                     rounds each component to 5 decimals first, and analyst.ts now calls it
--                     only when the crawl has actually changed since the last profile.
--
-- NO VECTOR INDEX HERE, ON PURPOSE. pgvector's hnsw and ivfflat both cap at 2000 dimensions and
-- our vectors are 2048, so neither can be built on site_pages.embedding at all — the index
-- statements in 019/022 are wrapped in exception handlers and have been silently skipping for
-- this reason since 022 landed. A sequential scan over one tenant's few hundred rows is
-- sub-millisecond work; the cost this migration removes was never CPU, it was bandwidth.
--
-- search_path IS public, extensions ON ALL THREE, not just public. Which schema pgvector lives
-- in depends on how the project was set up: 001's bare `create extension if not exists vector`
-- puts it in public, but a project where the extension had already been enabled from the
-- Supabase dashboard has it in `extensions` and that `if not exists` is a silent no-op. The
-- tables survive either way because Supabase's roles carry both schemas in their own
-- search_path; a function that pins search_path does not inherit that, so pinning it to public
-- alone would make `::vector(2048)` below fail with "type vector does not exist" on exactly half
-- the possible projects. Measured 2026-09-27: on the workspace this is being deployed to it is in
-- `public`, so pinning to public alone would have worked there — and would have broken silently
-- on the next project created from ALL_MIGRATIONS.sql with the extension enabled from the
-- dashboard first.
--
-- SECURITY INVOKER on all three, deliberately: RLS on site_pages then does the tenant check
-- exactly as it does for a direct select (policy "site_pages_all_member", 001). The agent-server
-- calls these with the service-role key and bypasses RLS the same way its selects already do.
-- A security-definer function here would hand any holder of the anon key every tenant's pages.
--
-- Safe to re-run.

-- ── The pool: the same 300 pages the analyst itself reads ────────────────────────────────
-- Both functions below start from this exact set, because the gap check and the clustering have
-- to agree on which pages "the site" means.
--
-- The ordering is new and it fixes a real bug: analyst.ts had .limit(300) with no order by, so
-- on a site with more than 300 pages Postgres was free to return a different arbitrary 300
-- every run, and the profile diff the user is shown ("3 topics renamed") would move for no
-- reason. `word_count desc nulls last` is migration 025's own answer to "give me this tenant's
-- real pages, biggest first" (it added idx_site_pages_words for precisely this query), so an
-- empty mega-menu fragment can no longer displace a service page. `url` breaks ties, which is
-- what makes it fully deterministic.

-- ── 1 · content gaps: the nearest page to one query vector ───────────────────────────────
-- p_query is text, not vector(2048), on purpose: PostgREST has no mapping for the vector type
-- in an argument position, so the caller sends the literal "[0.1,-0.2,...]" and the cast
-- happens here. A malformed literal raises a cast error rather than silently matching nothing.
--
-- `<=>` is cosine DISTANCE, so similarity is 1 - distance. That is the same number the old
-- TypeScript computed as dot(normalize(query), normalize(page)) — cosine similarity either way,
-- and GAP_MAX_SIMILARITY in analyst.ts keeps its meaning unchanged.
create or replace function public.analyst_nearest_page(
  p_tenant uuid,
  p_query  text,
  p_limit  integer default 300
)
returns table (url text, similarity double precision)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  with pool as (
    select sp.url, sp.embedding
      from site_pages sp
     where sp.tenant_id = p_tenant
     order by sp.word_count desc nulls last, sp.url
     limit p_limit
  )
  select pool.url,
         1 - (pool.embedding <=> p_query::vector(2048)) as similarity
    from pool
   where pool.embedding is not null
   order by pool.embedding <=> p_query::vector(2048)
   limit 1;
$$;

-- ── 2 · topic clusters: every vector, a third fewer bytes ────────────────────────────────
-- Rounding to 5 decimals is free accuracy-wise and not free bandwidth-wise. The vectors are
-- unit length over 2048 dimensions, so a typical component is around 1/sqrt(2048) ~= 0.022 and a
-- 1e-5 quantisation step is a relative error of about 0.05% per component.
--
-- MEASURED, not argued (agent-server/src/agents/analyst.test.ts): the worst drift it puts on a
-- cosine similarity across 40 seeded 2048-dimension corpora is 1.5e-5. The product compares
-- similarities at four decimals (analyst.ts stores nearest_similarity as toFixed(4)), so the
-- drift sits an order of magnitude below the last digit anything looks at, and the tests assert
-- that it never moves a page into a different cluster. What it buys, measured on the same
-- workspace: 25.1 KB per page becomes 16.8 KB — "0.02235" instead of "0.022346592". A third off,
-- not the 4x an earlier draft of this comment claimed.
--
-- The big saving is not here, it is in not calling this function at all: analyst.ts reuses the
-- stored clusters whenever analyst_page_stats() says the crawl has not moved, which takes the
-- typical run from ~4.2 MB to ~810 KB (the page text, which is still genuinely needed for quote
-- verification). A run that DOES have to recluster pays ~3.1 MB instead of ~4.2 MB.
--
-- Returns real[] rather than vector so PostgREST emits a JSON array of numbers; analyst.ts's
-- parseEmbedding() already accepts both that and the old vector string.
create or replace function public.analyst_page_vectors(
  p_tenant uuid,
  p_limit  integer default 300
)
returns table (url text, title text, embedding real[])
language sql
security invoker
set search_path = public, extensions
stable
as $$
  with pool as (
    select sp.url, sp.title, sp.embedding
      from site_pages sp
     where sp.tenant_id = p_tenant
     order by sp.word_count desc nulls last, sp.url
     limit p_limit
  )
  select pool.url,
         pool.title,
         array(select round(v::numeric, 5)::real
                 from unnest(pool.embedding::real[]) as v) as embedding
    from pool
   where pool.embedding is not null;
$$;

-- ── 3 · is the crawl newer than the profile? ─────────────────────────────────────────────
-- Three integers instead of 12 MB of floats. analyst.ts stores the fingerprint built from these
-- in site_profiles.built_from and, when it has not moved, reuses the topic_clusters from the
-- active profile rather than re-fetching every vector to recompute them.
--
-- Reuse is exact, not an approximation: buildClusters() is deterministic by design (see its own
-- comment — "two runs over an unchanged site must produce the same clusters, or every weekly
-- re-crawl would show the user a diff full of renamed topics that did not change"). Same pages,
-- same vectors, same output. It also skips the cluster-labelling LLM call, which was re-asking
-- the model to name groups it had already named.
--
-- `last_seen` (025) is stamped on every crawl that saw a page, so it moves whenever the crawler
-- has run, and the crawler re-embeds as it goes — which is the only way a vector changes.
-- Counting rows as well catches a prune that removed pages without touching anything's last_seen.
create or replace function public.analyst_page_stats(p_tenant uuid)
returns table (pages integer, embedded integer, newest timestamptz)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  select count(*)::integer                                            as pages,
         count(*) filter (where sp.embedding is not null)::integer    as embedded,
         max(sp.last_seen)                                            as newest
    from site_pages sp
   where sp.tenant_id = p_tenant;
$$;

-- 027_schedule_audit_kind.sql — a timetable can be about the audit, not only about articles.
--
-- WHY. Reported live 2026-09-28. The customer asked, in chat:
--
--     "ispe ek new task add karo ok mujhe har roz mere site ka audit rport batana"
--
-- and was told "Saved — every day at 09:00 Asia/Calcutta · 2 articles per run". Nothing about an
-- audit was saved. What happened instead: their existing WEEKLY article schedule was rewritten to
-- DAILY, because the only thing reading that sentence was a regular expression that understands
-- WHEN ("har roz") and has no concept of WHAT ("audit"), and the only row it can write is
-- kind='article'. So a request for a report they were not getting turned into seven times the
-- article spend they did not ask for, and reported itself as a success.
--
-- Two things were wrong and this migration is the smaller one: `audit` was not a kind a schedule
-- could have, so even a perfectly understood request had nowhere to go. The larger fix is that
-- the chat now writes schedules through a tool that must name the kind (lib/chat-schedule-tools.ts)
-- rather than through a regex that cannot.
--
-- 006 wrote `check (kind in ('article', 'social'))` inline, so the constraint carries a generated
-- name. It is looked up rather than guessed at, which is also what makes this safe to re-run.
--
-- `unique (tenant_id, kind)` is deliberately KEPT. One article timetable and one audit timetable
-- per tenant is the whole requirement; it is also what makes "change my audit schedule" a single
-- unambiguous row rather than a question about which of several the customer meant.

do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.schedules'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';

  if con_name is not null then
    execute format('alter table public.schedules drop constraint %I', con_name);
  end if;

  alter table public.schedules
    add constraint schedules_kind_check
    check (kind in ('article', 'social', 'audit'));
end $$;

comment on column public.schedules.kind is
  'What recurring work this row books. article = the boss chain writes N posts. audit = Mr. Audit '
  'runs a site audit and files a report. social = reserved; the social agent is still a stub and '
  'agent-server''s scheduler skips it. `count` and `auto_publish` mean nothing for audit rows.';

-- 028_outreach_crm.sql — the leads table becomes a CRM, and WhatsApp outreach gets its tables.
--
-- THE PRODUCT DECISION THIS IMPLEMENTS (owner, 2026-09-30). Leads are found per tenant, pass a
-- quality gate, and WAIT FOR A HUMAN: an admin approves or rejects each one before anything is
-- sent. Approved leads go to Mr. WhatsApp, which sends from THAT TENANT'S OWN WhatsApp number
-- (paired by QR, session below) at randomised intervals with a daily cap. Every message, both
-- directions, is a row in outreach_messages; a reply moves the lead's stage and can be answered
-- by the brain. The chat's lookup tools read all of it, so "kisko msg gaya, kon reply diya" is a
-- database answer, not a guess.
--
-- WHY OUR OWN TABLES AND NOT TWENTY CRM. Twenty is in the plan as the admin console, but it is
-- a separate AGPL service needing ~2 GB of RAM that this project has nowhere to run until the
-- Oracle box exists — and the approval gate, the sender, the brain and the chat tools all need
-- tenant-isolated reads/writes TODAY. So the source of truth is here; Twenty mirrors it later
-- over its API and can be dropped without losing anything.
--
-- Safe to re-run: every ALTER is IF NOT EXISTS / drops-then-adds its own constraint.

-- ── 1 · leads grows the columns a CRM row needs ───────────────────────────────────────────
alter table leads add column if not exists designation     text;
alter table leads add column if not exists website         text;
-- E.164 where possible ("+9715..."), because this is the column Mr. WhatsApp dials.
alter table leads add column if not exists whatsapp        text;
alter table leads add column if not exists city            text;
alter table leads add column if not exists country         text;
-- The columns agents/leads.ts has been TRYING to write since it shipped: its rich insert names
-- exactly these and falls back to a warning when they are missing (leadsHasOutreachColumns).
-- Matching the shipped writer beats inventing parallel names — `draft` is the message
-- Mr. WhatsApp sends, `evidence` is {quote, url, band, reasons, attribution, ...}: the exact
-- page and the line on it that made this a lead. A lead without evidence is a guess with a
-- phone number; the approval screen shows both before any message goes out.
alter table leads add column if not exists domain          text;
alter table leads add column if not exists draft           text;
alter table leads add column if not exists channel         text;
alter table leads add column if not exists observation     text;
alter table leads add column if not exists evidence        jsonb;
-- The approval gate, stamped. approved_by is the admin's user id — "who let this one through"
-- must be answerable when a client asks why their number messaged someone.
alter table leads add column if not exists approved_at     timestamptz;
alter table leads add column if not exists approved_by     uuid;
alter table leads add column if not exists rejected_at     timestamptz;
-- Outreach bookkeeping, denormalised from outreach_messages so the board never joins to sort.
alter table leads add column if not exists contacted_at    timestamptz;
alter table leads add column if not exists replied_at      timestamptz;
alter table leads add column if not exists follow_up_count integer not null default 0;
alter table leads add column if not exists next_action_at  timestamptz;
-- Consent flags. opt_out is FOREVER: no code path may clear it, and the sender checks it last
-- thing before sending, not only at queue time.
alter table leads add column if not exists opt_out         boolean not null default false;
alter table leads add column if not exists opt_out_at      timestamptz;
alter table leads add column if not exists notes           text;
alter table leads add column if not exists updated_at      timestamptz not null default now();

-- ── 2 · the stage vocabulary, mapped then enforced ────────────────────────────────────────
-- Old app-level values -> the CRM pipeline. 'draft' meant "researched, message written, nothing
-- sent" — in the new flow that is exactly pending_approval. 'do_not_contact' was consent, so it
-- maps to opted_out (and sets the flag); 'skipped' was an admin's no, which is rejected.
update leads set stage = 'pending_approval' where stage = 'draft';
update leads set stage = 'rejected'         where stage = 'skipped';
update leads set opt_out = true, opt_out_at = coalesce(opt_out_at, now()) where stage = 'do_not_contact';
update leads set stage = 'opted_out'        where stage = 'do_not_contact';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leads_stage_check') then
    alter table leads drop constraint leads_stage_check;
  end if;
  alter table leads add constraint leads_stage_check check (stage in (
    'new',              -- found, scored, not yet through the quality gate write
    'pending_approval', -- waiting for the admin
    'approved',         -- admin said yes; queue-able
    'rejected',         -- admin said no; kept for the record, never re-surfaced
    'queued',           -- picked by Mr. WhatsApp, waiting for its randomised slot
    'contacted',        -- first message sent
    'delivered',        -- WhatsApp server-acked delivery
    'read',             -- read receipt seen
    'replied',          -- they answered; sending to them stops
    'in_conversation',  -- an exchange is going (brain or human)
    'interested',       -- marked hot by admin or brain
    'won',              -- became a customer
    'lost',             -- went cold / said no
    'opted_out',        -- asked to stop. Terminal, forever
    'invalid',          -- number not on WhatsApp / email bounced
    'failed'            -- sending failed technically after retries
  ));
end $$;

create index if not exists idx_leads_tenant_stage on leads(tenant_id, stage);
create index if not exists idx_leads_tenant_score on leads(tenant_id, icp_score desc);

-- ── 3 · every message, both directions ────────────────────────────────────────────────────
create table if not exists outreach_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  lead_id     uuid not null references leads(id) on delete cascade,
  direction   text not null check (direction in ('out', 'in')),
  channel     text not null default 'whatsapp' check (channel in ('whatsapp')),
  body        text not null,
  -- Out: queued -> sent -> delivered -> read, or failed. In: received, always.
  status      text not null default 'queued'
              check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  -- WhatsApp's own id for the message, so a receipt event can find its row.
  wa_message_id text,
  error       text,
  -- Who wrote an outgoing reply: 'brain' (auto), 'human', or null for the standard first draft.
  answered_by text check (answered_by in ('brain', 'human')),
  queued_at    timestamptz not null default now(),
  sent_at      timestamptz,
  delivered_at timestamptz,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_outreach_tenant_created on outreach_messages(tenant_id, created_at desc);
create index if not exists idx_outreach_lead on outreach_messages(lead_id, created_at);
create index if not exists idx_outreach_wa_id on outreach_messages(wa_message_id) where wa_message_id is not null;

-- ── 4 · the tenant's own WhatsApp connection ──────────────────────────────────────────────
-- Two tables ON PURPOSE. Status is something the dashboard shows a member; the Baileys auth
-- blob is a full login to the client's WhatsApp and must never cross PostgREST with a user
-- token. whatsapp_sessions gets a member policy; whatsapp_auth gets NO policy at all, so only
-- the service role (agent-server) can touch it.
create table if not exists whatsapp_sessions (
  tenant_id    uuid primary key references tenants(id) on delete cascade,
  status       text not null default 'disconnected'
               check (status in ('disconnected', 'pairing', 'connected', 'logged_out', 'banned')),
  phone_number text,
  -- The QR the client scans, as a data string, only while status = 'pairing'. Cleared on connect.
  qr           text,
  last_connected_at timestamptz,
  -- Set once, on the FIRST successful pairing, and never moved: the warmup cap (a fresh number
  -- sends less for its first days) is measured from here. last_connected_at moves on every
  -- reconnect and would reset the warmup each deploy.
  first_connected_at timestamptz,
  -- Sending-day bookkeeping for the cap: how many went out since counter_date (tenant TZ day).
  sent_today   integer not null default 0,
  counter_date date,
  updated_at   timestamptz not null default now()
);

create table if not exists whatsapp_auth (
  tenant_id  uuid primary key references tenants(id) on delete cascade,
  -- Baileys creds + signal keys, serialised. Opaque here on purpose.
  creds      jsonb not null default '{}'::jsonb,
  keys       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── 5 · per-tenant agent switches and knobs ───────────────────────────────────────────────
-- One row per (tenant, agent). settings is jsonb so a new knob is a code change, not a
-- migration; the defaults and the meaning of every key live in ONE place,
-- lib/outreach/settings.ts, exactly as SCHEDULE_KINDS does for timetables.
create table if not exists agent_settings (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  agent      text not null check (agent in ('leads', 'whatsapp')),
  enabled    boolean not null default false,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, agent)
);

-- ── 6 · RLS, same shape as every other tenant table ──────────────────────────────────────
alter table outreach_messages enable row level security;
alter table whatsapp_sessions enable row level security;
alter table whatsapp_auth     enable row level security;
alter table agent_settings    enable row level security;

drop policy if exists "outreach_all_member" on outreach_messages;
create policy "outreach_all_member" on outreach_messages for all
  using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

drop policy if exists "wa_sessions_member_read" on whatsapp_sessions;
create policy "wa_sessions_member_read" on whatsapp_sessions for select
  using (public.is_tenant_member(tenant_id));

-- whatsapp_auth: RLS on, NO policies. Members see nothing; only the service role reads it.

drop policy if exists "agent_settings_all_member" on agent_settings;
create policy "agent_settings_all_member" on agent_settings for all
  using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

-- ── 7 · daily discovery becomes schedulable ──────────────────────────────────────────────
-- 'leads' joins the timetable kinds (027's pattern), so "roz 10 naye leads dhundo" is a
-- schedule row like the audit's, run by the same scheduler tick. count = how many leads that
-- day's run should aim to add AFTER the quality gate, not how many candidates to fetch.
do $$
declare con_name text;
begin
  select conname into con_name from pg_constraint
   where conrelid = 'public.schedules'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if con_name is not null then
    execute format('alter table public.schedules drop constraint %I', con_name);
  end if;
  alter table public.schedules add constraint schedules_kind_check
    check (kind in ('article', 'social', 'audit', 'leads'));
end $$;

-- count was checked 1..5 by 006, sized for articles (five posts a day is already a lot of
-- publishing). A leads run legitimately wants 10-50 a day, so the ceiling moves to 50 here and
-- the PER-KIND ceiling becomes the app's job: SCHEDULE_KINDS carries maxCount (article 5,
-- leads 50) and applySchedule clamps against the kind it is writing, not a global 5.
do $$
declare con_name text;
begin
  select conname into con_name from pg_constraint
   where conrelid = 'public.schedules'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%count%';
  if con_name is not null then
    execute format('alter table public.schedules drop constraint %I', con_name);
  end if;
  alter table public.schedules add constraint schedules_count_check
    check (count >= 1 and count <= 50);
end $$;


-- 029_leads_dedup_guard.sql — a lead can never be stored twice for one tenant.

-- ============================================================
-- 029 · Leads de-duplication guard
-- ============================================================
--
-- The owner's hard rule: a lead must NEVER be duplicated. The agent already dedupes in three
-- places (in-run, against the existing list on domain/phone/name, and in-batch before the write),
-- but application logic cannot stop two runs for the same tenant racing each other into the same
-- insert. This migration is the last line — a database-level guarantee that the same business
-- cannot be stored twice for one tenant, no matter what code does above it.
--
-- It does three things, in order:
--   1. Backfill `domain` from `website` where it is missing, and normalise existing domains
--      (lower-case, no leading "www."), so the uniqueness test sees every lead's real identity.
--   2. Collapse the duplicates already in the table, keeping ONE row per (tenant_id, domain) —
--      the furthest-along one (a contacted/won lead beats a pending one), then the earliest.
--   3. Add a partial unique index on (tenant_id, domain) so a duplicate can never be inserted
--      again. Partial — only where domain is not null — because a lead with no domain yet (a bare
--      map pin) is deduped in code on phone/name and must not be blocked here.
--
-- ⚠ STEP 2 DELETES ROWS. It only ever removes a row that shares a tenant+domain with another row
--    it is keeping, so no unique business is lost — but it is irreversible, so take a backup of
--    `leads` before applying this to a live database. If two *progressed* rows (both past the
--    pending stage) share a domain, step 2 keeps the furthest-along and the index still succeeds.
-- ============================================================

begin;

-- 1 ─ backfill + normalise domain ────────────────────────────────────────────────────────────

-- Fill domain from the website host where we have a site but no stored domain.
update leads
set domain = lower(
  regexp_replace(
    regexp_replace(website, '^\s*https?://(www\.)?', '', 'i'),  -- drop scheme + leading www.
    '[/:?#].*$', ''                                             -- drop path / port / query / hash
  )
)
where (domain is null or btrim(domain) = '')
  and website is not null and btrim(website) <> '';

-- Normalise domains already stored (lower-case, strip a leading "www.") so equal domains compare
-- equal under the unique index.
update leads
set domain = lower(regexp_replace(btrim(domain), '^www\.', '', 'i'))
where domain is not null
  and domain <> lower(regexp_replace(btrim(domain), '^www\.', '', 'i'));

-- An empty string is not a domain; make it null so the partial index ignores it.
update leads set domain = null where domain is not null and btrim(domain) = '';

-- 2 ─ collapse existing duplicates, keeping the best row per (tenant_id, domain) ───────────────

with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, domain
      order by
        -- furthest-along first: a lead someone has worked beats a fresh pending one
        case lower(coalesce(stage, ''))
          when 'won'              then 100
          when 'customer'         then 95
          when 'negotiation'      then 90
          when 'proposal'         then 85
          when 'replied'          then 80
          when 'contacted'        then 70
          when 'queued'           then 60
          when 'approved'         then 50
          when 'pending_approval' then 20
          when 'new'              then 10
          else 15
        end desc,
        created_at asc,   -- then the oldest (the original)
        id asc            -- deterministic tie-break
    ) as rn
  from leads
  where domain is not null
)
delete from leads
where id in (select id from ranked where rn > 1);

-- 3 ─ the guarantee ────────────────────────────────────────────────────────────────────────────

-- One lead per domain per tenant. Partial: domain-less leads (bare map pins) are deduped in code
-- on phone/name and must stay insertable here.
create unique index if not exists leads_tenant_domain_uniq
  on leads (tenant_id, domain)
  where domain is not null;

commit;


-- 030_leads_buyer_fit.sql — buyer-fit columns for high-quality leads (Phases 2-6).

-- ============================================================
-- 030 · Leads: buyer-fit columns (high-quality-leads plan, Phases 2–6)
-- ============================================================
--
-- All additive and nullable, so saveLeads keeps working unchanged on a database where this has
-- not run yet (it probes and falls back). Nothing here changes an existing row.
--
--   source_segment   which confirmed buyer segment produced this lead (Phase 2) — for learning
--                    which segments convert, and for the approval feedback loop.
--   source_query     the search query that surfaced it (Phase 2).
--   classification   the buyer/competitor/irrelevant/unclear verdict of the fit gate (Phase 3).
--   score_breakdown  the per-group score detail as JSON, so "68/100" is explainable in the UI
--                    (Phase 4) rather than a bare number.
--   reject_reason    why a human rejected it: competitor | wrong_industry | wrong_city |
--                    too_small | too_large | already_served | duplicate | other (Phase 6) —
--                    the signal the feedback loop turns into a tighter profile.
-- ============================================================

alter table leads add column if not exists source_segment  text;
alter table leads add column if not exists source_query    text;
alter table leads add column if not exists classification  text;
alter table leads add column if not exists score_breakdown jsonb;
alter table leads add column if not exists reject_reason   text;

-- ── 031 · WhatsApp auto-reply engine (§28) — Phase 1 state (additive) ────────────────────────
alter table leads add column if not exists auto_reply_paused_until timestamptz;
alter table leads add column if not exists last_intent             text;
create index if not exists idx_leads_autoreply_paused
  on leads (tenant_id, auto_reply_paused_until)
  where auto_reply_paused_until is not null;
