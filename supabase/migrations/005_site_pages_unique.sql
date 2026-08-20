-- 005_site_pages_unique.sql — deep/full-site crawl (background job, not the old
-- onboarding-request-bound 15-page sample) needs to be safely re-runnable without piling
-- up duplicate rows for the same URL every time it runs.

-- Drop any exact (tenant_id, url) duplicates first, keeping the newest row.
delete from site_pages a using site_pages b
  where a.tenant_id = b.tenant_id and a.url = b.url and a.created_at < b.created_at;

alter table site_pages add constraint site_pages_tenant_url_unique unique (tenant_id, url);
