-- 008_jobs_log_skipped.sql — make a refused job visible.
--
-- agent-server enforces a per-tenant daily cap per agent (agent-server/src/config/caps.ts).
-- The check ran BEFORE the job was ever written to jobs_log, so hitting the cap produced
-- absolutely nothing: the chat said "On it", the office stayed asleep, and there was no row,
-- no error and no explanation anywhere. Found live — Mr Lxwa sat on exactly 6/6 planning runs
-- and every further request vanished in silence.
--
-- A refused job is not an error (nothing broke) and not a success (no work happened), so it
-- needs its own state rather than being forced into one of those.

alter table jobs_log drop constraint if exists jobs_log_status_check;

alter table jobs_log add constraint jobs_log_status_check
  check (status in ('queued', 'running', 'success', 'error', 'skipped'));
