-- 042_match_site_pages.sql — "which of this tenant's pages is nearest to what the customer just asked".
--
-- WHY. The WhatsApp assistant used to answer from three lines of Site Brain (what we do, five
-- offering names, a tone). The crawled pages — the service details, the process, the timelines the
-- customer is actually asking about — were never consulted: lib/whatsapp/* had no reference to
-- site_pages at all, and the chat tool lookup_site_pages is keyword-only (an ilike on a whole
-- customer sentence almost never matches). Client chat, 2026-11-13: "give me some information about
-- iso" was answered with a generic sentence while the site had pages about exactly that.
--
-- WHAT THIS RETURNS. The k nearest pages — id, url, title, similarity — and NOTHING ELSE. No
-- content_text and no vector. The caller reads the text of the few pages it needs (and caches it),
-- so a question costs a few hundred bytes of egress rather than a page-sized payload; this project
-- has already been restricted once for egress (migration 026 has the account).
--
-- SAME SHAPE AS analyst_nearest_page (026), deliberately, because that one is proven on the live
-- database: p_query is the vector as the text literal "[0.1,-0.2,...]" (PostgREST has no vector
-- argument type), `<=>` is cosine distance so similarity is 1 - distance, search_path pins both
-- public and extensions (where pgvector lives depends on how the project was created), and the
-- function is SECURITY INVOKER so RLS on site_pages does the tenant check exactly as for a direct
-- select. The agent-server calls it with the service role and filters on p_tenant itself.
--
-- NO VECTOR INDEX, as in 026: pgvector's hnsw/ivfflat cap at 2000 dimensions and these vectors are
-- 2048. One tenant's few hundred rows scan in well under a millisecond; the filter on tenant_id
-- keeps it per-tenant no matter how many tenants the table holds.
--
-- Only the first ~1800 characters of a page are embedded (lib/embeddings.ts), so this finds the page
-- whose OPENING is nearest. Choosing the right paragraph inside it is the caller's job
-- (agent-server/src/lib/whatsapp/knowledge.ts). Per-chunk embeddings, if that turns out not to be
-- enough, belong in knowledge_chunks (019) and would replace this function's callers, not this file.
--
-- Safe to re-run.

create or replace function public.match_site_pages(
  p_tenant uuid,
  p_query  text,
  p_k      integer default 3
)
returns table (id uuid, url text, title text, similarity double precision)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  select sp.id,
         sp.url,
         sp.title,
         1 - (sp.embedding <=> p_query::vector(2048)) as similarity
    from site_pages sp
   where sp.tenant_id = p_tenant
     and sp.embedding is not null
   order by sp.embedding <=> p_query::vector(2048)
   limit greatest(1, least(coalesce(p_k, 3), 10));
$$;

comment on function public.match_site_pages(uuid, text, integer) is
  'The k pages of a tenant nearest to a query vector (given as the text literal "[...]"). id, url, title, similarity only — no text, no vector.';
