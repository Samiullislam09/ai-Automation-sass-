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
