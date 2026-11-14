-- 044_wa_events.sql — a log of what the WhatsApp assistant DECIDED, so a manager can see why.
--
-- WHY. outreach_messages records what was said. It does not record what the assistant decided NOT to say, why it said
-- what it said, or what it handed to a person — those lived in console.log lines on the server, which nobody reads.
-- Found 2026-11-14 on a real chat: a customer answered "subah" to "morning, afternoon or evening?" and got silence; the only
-- trace was a flag on the lead. "Error log bhi nahi aaya" — because there was no log. This table is that log.
--
-- ONE ROW PER DECISION, written by agent-server/src/lib/whatsapp/events.ts:
--   sent      "Replied in 9 s" + the text, the intent, and the notes of anything the code corrected on the way
--   skipped   "Not answered: a person has this chat" / "chose not to reply (an 'ok')"
--   flagged   a lead handed to a person, and why
--   meeting   a call requested, and what could or could not be arranged automatically
--   system    a holding message, a retry, an opt-out, a scheduled pause
--   error     something that failed
-- The Activity page (WhatsApp) reads it, merged with the messages, as a live log.
--
-- IT IS A LOG, NOT A RECORD: rows older than 21 days are deleted by the daily sweep, and writing one never blocks or
-- fails a reply. Without this migration the assistant works exactly as before and writes nothing.
--
-- Safe to re-run.

create table if not exists wa_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  lead_id    uuid,
  at         timestamptz not null default now(),
  kind       text not null,
  summary    text not null,
  detail     jsonb not null default '{}'::jsonb
);

create index if not exists idx_wa_events_tenant_at on wa_events (tenant_id, at desc);
create index if not exists idx_wa_events_lead_at   on wa_events (tenant_id, lead_id, at desc);

alter table wa_events enable row level security;
drop policy if exists "wa_events_member_read" on wa_events;
create policy "wa_events_member_read" on wa_events for select using (public.is_tenant_member(tenant_id));
