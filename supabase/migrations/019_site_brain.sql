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
