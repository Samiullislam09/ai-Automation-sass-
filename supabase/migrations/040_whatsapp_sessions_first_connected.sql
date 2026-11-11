-- 040 · whatsapp_sessions.first_connected_at (and the other columns migration 028 describes).
--
-- Migration 028 declares this column, but 028 uses "create table if not exists": on a database where
-- whatsapp_sessions already existed from an earlier draft, the table was left as it was and the later columns were
-- never added. Production is such a database: `select first_connected_at from whatsapp_sessions` fails with
-- 'column "first_connected_at" does not exist'.
--
-- That broke every place that reads the row with that column in its select list (the first-message sender, the
-- follow-up sender, the auto-reply limit, the Activity page). A failed select returns no row, so the server saw
-- "database said none" and treated a connected number as not connected. The server now reads the row with
-- select("*"), so it no longer breaks on a missing column, but the warm-up limit (a new number sends fewer messages
-- in its first days) needs this column to know how old the number is.
--
-- Safe to run more than once.

alter table whatsapp_sessions add column if not exists first_connected_at timestamptz;
alter table whatsapp_sessions add column if not exists last_connected_at  timestamptz;

-- Linked numbers with no recorded first connection: start the warm-up clock from the last connection we know of.
-- (If you know the number was linked earlier, set the real date instead, for example:
--    update whatsapp_sessions set first_connected_at = '2026-10-20' where tenant_id = '<your tenant id>';)
update whatsapp_sessions
   set first_connected_at = coalesce(last_connected_at, updated_at)
 where first_connected_at is null
   and phone_number is not null;
