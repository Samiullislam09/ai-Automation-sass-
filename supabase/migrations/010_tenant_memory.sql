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
