-- ============================================================
-- 029 · Leads de-duplication guard
-- ============================================================
--
-- The owner's hard rule: a lead must NEVER be duplicated. The agent already dedupes in three
-- places (in-run, against the existing list on domain/phone/name, and in-batch before the write),
-- but application logic cannot stop two runs for the same tenant racing each other into the same
-- insert. This migration is the last line — a database-level guarantee that the same business
-- cannot be stored twice for one tenant, no matter what code does above it.
--
-- It does three things, in order:
--   1. Backfill `domain` from `website` where it is missing, and normalise existing domains
--      (lower-case, no leading "www."), so the uniqueness test sees every lead's real identity.
--   2. Collapse the duplicates already in the table, keeping ONE row per (tenant_id, domain) —
--      the furthest-along one (a contacted/won lead beats a pending one), then the earliest.
--   3. Add a partial unique index on (tenant_id, domain) so a duplicate can never be inserted
--      again. Partial — only where domain is not null — because a lead with no domain yet (a bare
--      map pin) is deduped in code on phone/name and must not be blocked here.
--
-- ⚠ STEP 2 DELETES ROWS. It only ever removes a row that shares a tenant+domain with another row
--    it is keeping, so no unique business is lost — but it is irreversible, so take a backup of
--    `leads` before applying this to a live database. If two *progressed* rows (both past the
--    pending stage) share a domain, step 2 keeps the furthest-along and the index still succeeds.
-- ============================================================

begin;

-- 1 ─ backfill + normalise domain ────────────────────────────────────────────────────────────

-- Fill domain from the website host where we have a site but no stored domain.
update leads
set domain = lower(
  regexp_replace(
    regexp_replace(website, '^\s*https?://(www\.)?', '', 'i'),  -- drop scheme + leading www.
    '[/:?#].*$', ''                                             -- drop path / port / query / hash
  )
)
where (domain is null or btrim(domain) = '')
  and website is not null and btrim(website) <> '';

-- Normalise domains already stored (lower-case, strip a leading "www.") so equal domains compare
-- equal under the unique index.
update leads
set domain = lower(regexp_replace(btrim(domain), '^www\.', '', 'i'))
where domain is not null
  and domain <> lower(regexp_replace(btrim(domain), '^www\.', '', 'i'));

-- An empty string is not a domain; make it null so the partial index ignores it.
update leads set domain = null where domain is not null and btrim(domain) = '';

-- 2 ─ collapse existing duplicates, keeping the best row per (tenant_id, domain) ───────────────

with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, domain
      order by
        -- furthest-along first: a lead someone has worked beats a fresh pending one
        case lower(coalesce(stage, ''))
          when 'won'              then 100
          when 'customer'         then 95
          when 'negotiation'      then 90
          when 'proposal'         then 85
          when 'replied'          then 80
          when 'contacted'        then 70
          when 'queued'           then 60
          when 'approved'         then 50
          when 'pending_approval' then 20
          when 'new'              then 10
          else 15
        end desc,
        created_at asc,   -- then the oldest (the original)
        id asc            -- deterministic tie-break
    ) as rn
  from leads
  where domain is not null
)
delete from leads
where id in (select id from ranked where rn > 1);

-- 3 ─ the guarantee ────────────────────────────────────────────────────────────────────────────

-- One lead per domain per tenant. Partial: domain-less leads (bare map pins) are deduped in code
-- on phone/name and must stay insertable here.
create unique index if not exists leads_tenant_domain_uniq
  on leads (tenant_id, domain)
  where domain is not null;

commit;
