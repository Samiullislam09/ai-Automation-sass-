-- ============================================================
-- 030 · Leads: buyer-fit columns (high-quality-leads plan, Phases 2–6)
-- ============================================================
--
-- All additive and nullable, so saveLeads keeps working unchanged on a database where this has
-- not run yet (it probes and falls back). Nothing here changes an existing row.
--
--   source_segment   which confirmed buyer segment produced this lead (Phase 2) — for learning
--                    which segments convert, and for the approval feedback loop.
--   source_query     the search query that surfaced it (Phase 2).
--   classification   the buyer/competitor/irrelevant/unclear verdict of the fit gate (Phase 3).
--   score_breakdown  the per-group score detail as JSON, so "68/100" is explainable in the UI
--                    (Phase 4) rather than a bare number.
--   reject_reason    why a human rejected it: competitor | wrong_industry | wrong_city |
--                    too_small | too_large | already_served | duplicate | other (Phase 6) —
--                    the signal the feedback loop turns into a tighter profile.
-- ============================================================

alter table leads add column if not exists source_segment  text;
alter table leads add column if not exists source_query    text;
alter table leads add column if not exists classification  text;
alter table leads add column if not exists score_breakdown jsonb;
alter table leads add column if not exists reject_reason   text;
