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
