-- 035 · §29.5/29.10 — WhatsApp team (admins who get alerts) + the notification centre.
--
-- whatsapp_admins: the people who should hear about a meeting request or a hot lead — the owner
-- plus any managers. Each is a WhatsApp number; `notify` lets one be listed but muted. Alerts go
-- to these numbers (P6/P8) AND to the dashboard bell (wa_notifications below).
--
-- wa_notifications: the dashboard bell's feed — one row per thing worth surfacing (a reply, a
-- meeting request, a hot lead). Named wa_ to avoid clashing with any future generic notifications.

create table if not exists whatsapp_admins (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  name       text,
  phone      text not null,
  role       text not null default 'manager', -- 'owner' | 'manager'
  notify     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_wa_admins_tenant on whatsapp_admins (tenant_id);
-- one row per number per tenant (digits compared in code; this stops exact-string dupes)
create unique index if not exists wa_admins_tenant_phone on whatsapp_admins (tenant_id, phone);

create table if not exists wa_notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  type       text not null, -- 'reply' | 'meeting' | 'hot_lead' | 'system'
  title      text not null,
  body       text,
  lead_id    uuid,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_wa_notifications_feed on wa_notifications (tenant_id, read, created_at desc);
