-- 039 · whatsapp_sessions: which server process owns the WhatsApp connection.
--
-- WhatsApp allows ONE live connection per linked login. When two server processes both try to hold it (an old
-- deploy that has not stopped yet, a second replica, a copy running on someone's computer against the same
-- database), each one knocks the other off (WhatsApp code 440, "connection replaced") and they take turns
-- forever: the page flips between "Working" and "Reconnecting", and first messages never leave.
--
-- Fix: a lease. A process may open the socket only when no OTHER process holds a fresh lease; it renews the
-- lease every 30 seconds while it runs and gives it up when it shuts down. A second process then waits quietly
-- instead of fighting.
--
--   owner          which process holds the connection (a per-process id, includes the Railway deployment id)
--   owner_seen_at  last time that process renewed. Older than 2 minutes = that process is gone.
--
-- Safe to run more than once. The server tolerates this migration not being applied yet: without it the lease is
-- skipped (and a clash is still handled by backing off for ten minutes).

alter table whatsapp_sessions add column if not exists owner         text;
alter table whatsapp_sessions add column if not exists owner_seen_at timestamptz;
