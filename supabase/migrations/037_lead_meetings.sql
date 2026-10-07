-- 037 · §29.6 (P7) — meetings booked through Google Calendar + Meet.
--
-- One row per meeting attempt for a lead. Lifecycle:
--   offered   → AI sent 2-3 free slots on WhatsApp, waiting for the lead to pick (slots in jsonb)
--   scheduled → lead picked; a Calendar event + Meet link exist (start/end/event_id/meet_link)
--   done      → it happened (outcome: positive | negative)
--   no_show   → the lead didn't turn up; reschedule nudges tried (nudges_done)
--   cancelled → called off (by the lead's postpone-into-silence, or an admin)

create table if not exists lead_meetings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  lead_id           uuid not null,
  status            text not null default 'offered',
  offered_slots     jsonb,
  start_at          timestamptz,
  end_at            timestamptz,
  calendar_event_id text,
  meet_link         text,
  outcome           text,
  nudges_done       int  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_lead_meetings_lead   on lead_meetings (tenant_id, lead_id);
create index if not exists idx_lead_meetings_status on lead_meetings (tenant_id, status);
