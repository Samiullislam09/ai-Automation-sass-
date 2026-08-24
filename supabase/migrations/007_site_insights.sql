-- 007_site_insights.sql — what Google actually knows about this business.
--
-- site_pages (001) holds what the CRAWLER read off the site: titles and copy the business
-- wrote about itself. That says nothing about whether any of it works. This table holds the
-- other half — real Search Console queries/positions, real GA4 traffic, the real Business
-- Profile — so the agents can plan from evidence instead of from the homepage's adjectives.
--
-- Every row is a measurement with a period attached. Nothing in here is ever invented: if
-- Google returns no rows, no rows are stored, and the agents are told the data is absent
-- rather than being handed a guess.

create table if not exists site_insights (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  source       text not null check (source in ('gsc', 'ga4', 'gbp')),
  -- gsc:  'query' (a search someone typed) | 'page' (a landing page)
  -- ga4:  'page'  (a landing page)         | 'summary' (site totals)
  -- gbp:  'location' (a Business Profile)
  kind         text not null,
  key          text not null,                    -- the query text / page path / location id
  metrics      jsonb not null default '{}',      -- {clicks, impressions, ctr, position} etc.
  period_start date,
  period_end   date,
  captured_at  timestamptz not null default now(),
  unique (tenant_id, source, kind, key)
);

alter table site_insights enable row level security;

create policy "site_insights_all_member" on site_insights for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create index if not exists idx_site_insights_lookup on site_insights(tenant_id, source, kind);
