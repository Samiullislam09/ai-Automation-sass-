-- 012_keyword_choices.sql — let the human pick the keyword before anything gets written.
--
-- Until now "write an article" went straight through: Mr. Keyword researched, picked whatever
-- came back first, and Mr. Writer started. The person who asked never saw the options and
-- never got a say in which one their article was about.
--
-- This row is the pause. Mr. Keyword writes the candidates here and schedules the writer to
-- start after a short window; the dashboard shows the table and a countdown; the writer reads
-- this row when it wakes and writes about whichever keyword won.
--
-- Deliberately server-side: the recommended keyword is chosen and scheduled here, so an
-- article still gets written when nobody is looking at the screen — a scheduled 9am run has
-- no browser open at all. The UI is an opportunity to override, not a requirement.

create table if not exists keyword_choices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  -- The seed the research started from, kept so the chat can say what was asked for.
  topic        text not null,
  -- [{keyword, searchVolume, competition, competitionLevel, cpc, impressions, position,
  --   source, recommended, why}] — exactly what was measured, nothing invented.
  candidates   jsonb not null default '[]',
  -- Everything the keyword agent found, so the writer can rebuild a blueprint for whichever
  -- keyword is chosen rather than only for the one that happened to be recommended.
  research     jsonb not null default '{}',
  recommended  text not null,
  chosen       text,
  chosen_by    text check (chosen_by in ('user', 'auto')),
  status       text not null default 'pending' check (status in ('pending', 'chosen', 'used')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

alter table keyword_choices enable row level security;

create policy "keyword_choices_all_member" on keyword_choices for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- The dashboard asks one question of this table: "is anything waiting on me right now?"
create index if not exists idx_keyword_choices_pending
  on keyword_choices(tenant_id, status, expires_at desc);
