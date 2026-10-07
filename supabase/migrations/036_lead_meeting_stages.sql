-- 036 · §29.3 — the meeting/buying stages on top of migration 028's funnel.
--
-- Additive to the CHECK vocabulary: nothing is renamed or moved, four new stages are allowed.
--   meeting_requested → the lead asked for a call/demo (detection: P6)
--   meeting_scheduled → a time + Google Meet link is set (P7)
--   meeting_done      → the meeting happened (outcome recorded)
--   ready_to_buy      → an explicit buying signal (P8); won = paying client (Client page)
-- Re-create the constraint (Postgres CHECKs can't be ALTERed in place) with the old values + these.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leads_stage_check') then
    alter table leads drop constraint leads_stage_check;
  end if;
  alter table leads add constraint leads_stage_check check (stage in (
    'new', 'pending_approval', 'approved', 'rejected', 'queued',
    'contacted', 'delivered', 'read', 'replied', 'in_conversation', 'interested',
    'meeting_requested', 'meeting_scheduled', 'meeting_done', 'ready_to_buy',
    'won', 'lost', 'opted_out', 'invalid', 'failed'
  ));
end $$;
