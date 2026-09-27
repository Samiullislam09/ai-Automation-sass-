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
