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
