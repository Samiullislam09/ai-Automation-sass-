# MrLxwa — Rebuild Master Plan

**Open `MASTER_PLAN.html` in a browser** (double-click, or GitHub → Raw → save → open). It is the
single source of truth for the rebuild: 26 sections in Hinglish with diagrams, tables and the
decision log. The live copy is the Claude artifact
https://claude.ai/code/artifact/15bc00af-26b0-431d-a0ac-d93bf6da05b7 — this file is the
committed snapshot so the plan survives any tool, account or decade.

## What is in it

| §   | Topic |
|-----|-------|
| 0–3 | The one-line verdict, what exists today and why users get confused, repo reality check, the five principles that never break |
| 4–6 | New architecture: one brain (Intent → Planner → Orchestrator), agent contract (`/health`, `/manifest`, `POST /run` + callback) |
| 7–9 | Agent-by-agent spec, article pipeline state machine, Supabase schema (migration 017 = brain tables) |
| 10–12 | Chat UX rules, repo/deploy layout (each agent its own repo, 3 deploy units), the 1000-articles/day math |
| 13–15 | Phases with exit criteria, acceptance tests, decisions the owner has to make |
| 16 | Self-audit of v1 and the 11 v2 upgrades |
| 17 | Better repos/alternatives per agent + each agent's work flow (kaymen99 leads skeleton — see `THIRD_PARTY_LICENSES.md`) |
| 18 | Why chat took 8 s, measured latencies, the free LLM stack (`openai/gpt-oss-120b` on NVIDIA NIM) |
| 19–20 | Mr. Image / Mr. Story, how an agent works inside, the Leads deep flow |
| 21–22 | Risks not yet discussed; the plan's own cons and their fixes |
| 23 | UI audit — professional down to every button, 3-tier fix plan |
| 24 | Live visualisation: AG-UI events, **Agent Workspace** (Manus-style) replaces the pixel office as default, browser live view, replay |
| 25 | **Site Brain**: how crawl + GSC/GA data is actually used, duplicate locks, growth-first planning, **Mr. Support** website chatbot, how the brain stays fresh |
| 26 | **Build log** — kya ban chuka hai, kis commit me, aur kya abhi baaki hai. Har naye kaam pe yahan ek row jodo |

## How to update it

The HTML is plain, self-contained (inline CSS, mermaid diagrams as `<pre class="mermaid">`).
Edit it directly and commit; keep the section numbers stable so links like `#sitebrain` keep working.
Decisions get a dated pill (`DONE 2026-08-27`, `DECIDED …`, `AAPKA KAAM`) rather than being rewritten,
so the history of *why* stays readable.
