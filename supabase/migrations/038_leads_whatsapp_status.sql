-- 038 · leads: remember whether a lead's number is on WhatsApp.
--
-- The Leads page hides the WhatsApp button for a lead that is not on WhatsApp. Asking WhatsApp
-- ("is this number registered?") needs the tenant's WhatsApp to be connected, so the answer is stored
-- on the lead the first time it is known and never asked again: a later visit works even when WhatsApp
-- is disconnected, and WhatsApp is not queried for the same number twice.
--
--   wa_status      'yes' = the number is on WhatsApp, 'no' = it is not (a landline, a toll-free line,
--                  or a number WhatsApp does not know). NULL = never checked / could not be checked.
--   wa_checked_at  when that answer was given. A 'no' is looked at again after 30 days (people join
--                  WhatsApp); a 'yes' is kept.
--
-- Safe to run more than once. The app tolerates this migration not being applied yet: the page still
-- works, it just cannot remember the answers between visits.

alter table leads add column if not exists wa_status     text;
alter table leads add column if not exists wa_checked_at timestamptz;

alter table leads drop constraint if exists leads_wa_status_check;
alter table leads add constraint leads_wa_status_check check (wa_status is null or wa_status in ('yes', 'no'));
