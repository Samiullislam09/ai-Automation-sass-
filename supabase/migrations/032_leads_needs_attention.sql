-- 032 · WhatsApp auto-reply §28 Phase 2 — "needs you" flag on a lead.
--
-- Additive, non-destructive. The decision engine (decide.ts) sets these when it replies to a
-- message it was unsure about or that looked complex (an objection, pricing/legal, low confidence):
-- we STILL reply (owner's choice), but the lead is flagged so a human can review it. The Leads page
-- badge that renders this lands in Phase 3; the data is written from Phase 2.

alter table leads add column if not exists needs_attention        boolean not null default false;
alter table leads add column if not exists needs_attention_reason  text;

-- Cheap lookup of "which leads want my attention" for this tenant.
create index if not exists idx_leads_needs_attention
  on leads (tenant_id)
  where needs_attention = true;
