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
