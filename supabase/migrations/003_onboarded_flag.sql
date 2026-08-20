-- 003_onboarded_flag.sql — onboarding completion must live in the DB, not just
-- browser localStorage, or every new browser/session re-asks the wizard.

alter table tenants add column if not exists onboarded boolean not null default false;
