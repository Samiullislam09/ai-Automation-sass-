-- 033 · WhatsApp outbound timeline (§28.8, Lane 2) — the rolling cold-first-message queue.
--
-- One row per lead that is due a FIRST message. The dispatcher (scheduler.ts tickOutbound) sends
-- the next due row per tenant, one at a time, spread over randomised slots — never a bulk blast.
-- Unsent rows persist, so today's leftovers and tomorrow's new leads live on ONE timeline.
--
-- status: pending → (claimed) sending → sent | skipped (not on WhatsApp / opted out) | cancelled.

create table if not exists wa_outbound_queue (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  lead_id       uuid not null,
  scheduled_at  timestamptz not null,
  status        text not null default 'pending',
  attempt       int  not null default 0,
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Never queue the same lead twice while one send is still outstanding.
create unique index if not exists wa_outbound_one_open_per_lead
  on wa_outbound_queue (tenant_id, lead_id)
  where status in ('pending', 'sending');

-- The dispatcher's hot query: a tenant's due pending rows, oldest slot first.
create index if not exists wa_outbound_due
  on wa_outbound_queue (tenant_id, status, scheduled_at);
