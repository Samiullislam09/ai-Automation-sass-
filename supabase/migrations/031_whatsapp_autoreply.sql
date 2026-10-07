-- 031 · WhatsApp auto-reply engine (§28) — Phase 1 state.
--
-- Additive and non-destructive: two nullable columns on `leads`. The daily auto-send cap is
-- COUNTED from outreach_messages (direction='out', answered_by='brain') rather than stored in a
-- counter column, the same way leadsDailyStatus counts leads — no column to reset, no race on it.
--
-- auto_reply_paused_until: set when a human takes over a chat (they sent a message themselves),
--   so Mr Lxwa stops auto-replying to that one lead until the window passes. NULL = not paused.
-- last_intent: the decision engine's last read of this conversation (greeting/question/ready/…),
--   stored so the Leads page and Mr Lxwa can show it without re-running the model. NULL until P2.

alter table leads add column if not exists auto_reply_paused_until timestamptz;
alter table leads add column if not exists last_intent             text;

-- A partial index so the auto-reply worker can cheaply find leads whose pause has not expired.
create index if not exists idx_leads_autoreply_paused
  on leads (tenant_id, auto_reply_paused_until)
  where auto_reply_paused_until is not null;
