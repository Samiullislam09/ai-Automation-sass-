-- 027_schedule_audit_kind.sql — a timetable can be about the audit, not only about articles.
--
-- WHY. Reported live 2026-09-28. The customer asked, in chat:
--
--     "ispe ek new task add karo ok mujhe har roz mere site ka audit rport batana"
--
-- and was told "Saved — every day at 09:00 Asia/Calcutta · 2 articles per run". Nothing about an
-- audit was saved. What happened instead: their existing WEEKLY article schedule was rewritten to
-- DAILY, because the only thing reading that sentence was a regular expression that understands
-- WHEN ("har roz") and has no concept of WHAT ("audit"), and the only row it can write is
-- kind='article'. So a request for a report they were not getting turned into seven times the
-- article spend they did not ask for, and reported itself as a success.
--
-- Two things were wrong and this migration is the smaller one: `audit` was not a kind a schedule
-- could have, so even a perfectly understood request had nowhere to go. The larger fix is that
-- the chat now writes schedules through a tool that must name the kind (lib/chat-schedule-tools.ts)
-- rather than through a regex that cannot.
--
-- 006 wrote `check (kind in ('article', 'social'))` inline, so the constraint carries a generated
-- name. It is looked up rather than guessed at, which is also what makes this safe to re-run.
--
-- `unique (tenant_id, kind)` is deliberately KEPT. One article timetable and one audit timetable
-- per tenant is the whole requirement; it is also what makes "change my audit schedule" a single
-- unambiguous row rather than a question about which of several the customer meant.

do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.schedules'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';

  if con_name is not null then
    execute format('alter table public.schedules drop constraint %I', con_name);
  end if;

  alter table public.schedules
    add constraint schedules_kind_check
    check (kind in ('article', 'social', 'audit'));
end $$;

comment on column public.schedules.kind is
  'What recurring work this row books. article = the boss chain writes N posts. audit = Mr. Audit '
  'runs a site audit and files a report. social = reserved; the social agent is still a stub and '
  'agent-server''s scheduler skips it. `count` and `auto_publish` mean nothing for audit rows.';
