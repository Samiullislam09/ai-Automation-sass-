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
