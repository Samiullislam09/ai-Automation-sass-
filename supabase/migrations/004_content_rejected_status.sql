-- 004_content_rejected_status.sql — Step 12 (Approvals): a rejected item needs its own
-- status distinct from 'draft'/'failed' so the Approvals page can tell "user said no" apart
-- from "still being written" or "publish attempt errored".
alter table content_items drop constraint if exists content_items_status_check;
alter table content_items add constraint content_items_status_check
  check (status in ('draft', 'awaiting_approval', 'approved', 'published', 'failed', 'rejected'));
