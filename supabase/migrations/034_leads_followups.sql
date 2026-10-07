-- 034 · WhatsApp auto-reply §28.5 Phase 4 — follow-up nudge counter.
--
-- Additive. How many of the 3 follow-up nudges (24h / 90h / 160h) have been sent to a lead in the
-- CURRENT silence cycle. Any new inbound resets it to 0 (store.ts linkIncoming), because a reply
-- starts the clock over — the next silence earns a fresh set of nudges. 3 = all sent; the lead then
-- goes to 'lost' if still silent.

alter table leads add column if not exists auto_followups_done int not null default 0;
