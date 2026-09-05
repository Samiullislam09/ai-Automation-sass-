-- Strips the dead weight out of jobs_log.detail (2026-09-05 egress audit).
--
-- workers.ts filed each agent's ENTIRE return value as the job's receipt, so Mr. Writer stored
-- a second copy of every article in here (~15 KB) and Mr. Audit stored the whole report — every
-- issue plus a per-page row with LCP/CLS/TBT for up to 200 pages (100 KB+). All of it already
-- lives where it belongs: content_items.body, site_audits.
--
-- Nothing reads these keys. lib/dashboard-data.ts's describeJob(), the only thing that turns a
-- detail into a sentence, uses counts, titles, reasons and the quality gate — never `body`,
-- `blueprint`, `issues`, `meta` or `run.pages`.
--
-- What they cost: the dashboard's live poll re-read 61 of these rows every four seconds and the
-- schedule history reads 150 of the fattest at a time, which is how a 36 MB database with one
-- active user burned Supabase's 5 GB monthly egress allowance in four days and got the whole
-- organisation restricted.
--
-- New rows are trimmed at the source (agent-server/src/jobsLog.ts, trimJobDetail). This is the
-- one-time clean-up for rows already on file. Safe to run more than once: a row that no longer
-- holds any of these keys is not matched.

update jobs_log
set detail = detail - 'body' - 'blueprint' - 'issues' - 'meta' - 'pages' - 'pageSummary' - 'html' - 'markdown'
where jsonb_typeof(detail) = 'object'
  and detail ?| array['body', 'blueprint', 'issues', 'meta', 'pages', 'pageSummary', 'html', 'markdown'];

-- The audit's per-page table, one level down.
update jobs_log
set detail = jsonb_set(detail, '{run}', (detail -> 'run') - 'pages')
where jsonb_typeof(detail) = 'object'
  and jsonb_typeof(detail -> 'run') = 'object'
  and (detail -> 'run') ? 'pages';

-- A `cause` is whatever the failing library said, which can be an entire API error body.
update jobs_log
set detail = jsonb_set(detail, '{cause}', to_jsonb(left(detail ->> 'cause', 2000) || ' …[truncated]'))
where jsonb_typeof(detail) = 'object'
  and jsonb_typeof(detail -> 'cause') = 'string'
  and length(detail ->> 'cause') > 2000;
