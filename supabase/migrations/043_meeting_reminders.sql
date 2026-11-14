-- 043_meeting_reminders.sql — remember which reminders a booked meeting has already had.
--
-- WHY. A booked call that the customer forgets is a lost sale. agent-server/src/lib/whatsapp/reminders.ts
-- sends the customer a reminder 24 hours and 1 hour before, and the owner a briefing 1 hour before. Each
-- must go out exactly once, however often the 5-minute sweep looks at the meeting — so the sweep writes a
-- timestamp here BEFORE it sends, and skips anything already stamped.
--
-- WHAT IT HOLDS. A small json object, e.g.
--     { "booked_at": "2026-11-14T08:12:00Z", "lead_24h": "2026-11-15T09:00:04Z", "lead_1h": "...", "boss_1h": "..." }
-- `booked_at` is when the customer picked the slot: a meeting booked 3 hours ahead must not get a "your call
-- is tomorrow" reminder seconds after its confirmation, so the 24-hour reminder is only for meetings booked
-- well before that point.
--
-- SAFE WITHOUT IT. If this migration has not been applied the sweep cannot record that it sent anything, so it
-- sends NOTHING (and says so once in the log) rather than risk reminding the same customer every five minutes.
--
-- Safe to re-run.

alter table lead_meetings add column if not exists reminders jsonb not null default '{}'::jsonb;
