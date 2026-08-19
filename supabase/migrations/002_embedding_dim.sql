-- 002_embedding_dim.sql — switch embeddings provider from Gemini (768-dim) to
-- NVIDIA NIM nv-embedqa-e5-v5 (1024-dim), so we reuse the same NVIDIA account as
-- Boss AI (Step 7) instead of a separate Google AI Studio key.
-- Safe to run even if site_pages is still empty (it is, until Step 5 is actually used).

alter table site_pages alter column embedding type vector(1024);
