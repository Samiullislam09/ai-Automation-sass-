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
