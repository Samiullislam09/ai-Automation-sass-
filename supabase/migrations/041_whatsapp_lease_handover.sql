-- 041 · whatsapp_sessions: who holds the WhatsApp connection, since when, and a handover request.
--
-- Migration 039 added the lease (owner, owner_seen_at) so only ONE server process holds a WhatsApp login. That stopped
-- the two processes from fighting, but not the waiting: when a new deploy started while the old container was still
-- alive, the new one had to wait until Railway stopped the old one (or the lease went stale), which can be minutes.
--
-- This adds a HANDOVER: the newest process asks the current holder to step aside, and the holder yields within
-- ~15 seconds. The newest deploy always wins; an older process can never take a login back from a newer one, so
-- there is nothing to take turns over.
--
--   owner_started_at  when the holding process started. A process may ask for a handover only if it started LATER.
--   takeover_by       the process asking for the connection; the holder sees it on its next 15 s renewal and yields.
--   owner_info        who the holder is, in words (operating system and host), so the Activity page can name it.
--
-- Safe to run more than once. The server runs fine without this migration (it then waits as before).

alter table whatsapp_sessions add column if not exists owner_started_at timestamptz;
alter table whatsapp_sessions add column if not exists takeover_by      text;
alter table whatsapp_sessions add column if not exists owner_info       text;
