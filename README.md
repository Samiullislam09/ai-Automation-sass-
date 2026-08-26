# MrLxwa (GrowthTeam AI)

An AI marketing team for small businesses. The customer connects their website; a team of
agents reads the site, decides what to publish next from real search data, researches the
keyword, writes the article, runs a quality gate, and publishes to WordPress or a webhook —
with a human approval step at every outward-facing action.

> **Handing this to a developer?** Read [`docs/AGENTS_HANDOFF.md`](docs/AGENTS_HANDOFF.md).
> That is the complete, shareable architecture document: every agent, how each one works,
> what is real, what is stubbed, and where an existing open-source project could replace
> work we would otherwise write from scratch. It contains no credentials or infrastructure
> details.

---

## Repo layout

Two deployables, two separate builds, separate dependency trees:

| Path | What it is | Runs on |
|---|---|---|
| `app/`, `components/`, `lib/` | Next.js 14 web app — landing, auth, onboarding, dashboard, approvals, chat, web API | Vercel |
| `agent-server/` | Always-on Node worker — pg-boss queues, 7 agent workers, scheduler, Socket.io | Railway |
| `supabase/migrations/` | Postgres schema, RLS, pgvector (001–014) | Supabase |
| `docs/` | Architecture, AI plan, competitor analysis, product spec, build guide | — |

Shared logic (embeddings, crawling, publishing) is **deliberately duplicated** across the two
packages rather than imported across the boundary — they have different tsconfigs and deploy
targets. Keep the two copies in step by hand.

---

## Running it

```bash
# web app
npm install
npm run dev              # http://localhost:3000

# agent server (separate terminal)
cd agent-server
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill it in. Nothing runs without Supabase and an LLM
key; DataForSEO, Google and WordPress are all optional and degrade gracefully when absent.

Apply `supabase/migrations/*.sql` in order via the Supabase SQL editor (or the CLI).

---

## The agents

Seven queue agents, two pipeline stages, one conversational manager. The chain:

```
boss ──► keyword ──► [optional human keyword choice] ──► writer ──► quality gate
                                                                        │
                                              pass ──► approvals ──► publish
                                              fail ──► failed (visible, debuggable)
```

| Agent | Role | State |
|---|---|---|
| `boss` | Plans what to write, from the niche + crawled pages + Search Console | ✅ Real |
| `keyword` | Search volume + competition, 3 sources ranked by evidence quality | ✅ Real |
| `writer` | Drafts the article in the business's tone with real internal links | ✅ Real (on the wrong model tier — see the handoff doc) |
| quality gate | Word count, structure, links — measurable checks only | ⚠️ Structural subset |
| publish | WordPress REST or signed webhook | ✅ Real |
| `crawler` | Deep site crawl + embeddings into pgvector | ✅ Real |
| `social` | Multi-platform posting | ⛔ Stub |
| `seo` | Site audits, uptime, decay detection | ⛔ Stub |
| `leads` | ICP discovery, enrichment, scoring | ⛔ Stub |
| Mr Lxwa chat | Manager that starts real jobs from natural language (EN / Hinglish / Roman Urdu) | ✅ Real |

Plus a minute-tick **scheduler** that starts the chain at the customer's local wall-clock time,
with opt-in auto-publish per schedule.

Every agent shares one runtime: pg-boss queues, 3 attempts with exponential backoff, per-plan
daily caps plus a runaway guard, throttled progress reporting, full job logging, and per-tenant
Socket.io status events. See `agent-server/src/workers.ts`.

---

## Design rules the code enforces

These are not style preferences — they are why several files look the way they do:

- **Never invent data.** No fabricated search volumes, statistics, or quality scores. If there
  is nothing to ground a decision in, the agent returns a reason and does nothing.
- **Measured vs. suggested is always labelled.** An AI-suggested query never carries a number.
  A Search Console impression count is never printed as a search volume.
- **A refused job is not an error.** Hitting a cap gets its own state, with a reason and a hint.
- **Bias towards doing nothing.** A missed chat order costs one rephrase; a false positive
  spends the customer's credits on work nobody asked for.
- **Never claim success you did not verify.** A publish that failed keeps the draft in the
  approval queue; a publish that succeeded but failed to record is reported as a problem.

---

## Docs

| File | What it covers |
|---|---|
| [`docs/AGENTS_HANDOFF.md`](docs/AGENTS_HANDOFF.md) | **Start here.** Full agent architecture, shareable with an outside developer |
| `docs/PROJECT_DOCUMENTATION.md` | Long-form project documentation (partly superseded — written 2026-08-20) |
| `docs/AI_LOGIC.md` | Two-tier model plan: which model powers which feature |
| `docs/COMPETITOR_ANALYSIS.md` | Top 5 competitors and our positioning |
| `docs/Solo_Developer_Build_Guide.pdf` | The phased scratch-to-launch plan |
| `docs/AI_Growth_Team_SaaS_Spec_v3 (2).docx` | Master product spec v3.0 (10-agent roster, compliance rules, pricing) |
