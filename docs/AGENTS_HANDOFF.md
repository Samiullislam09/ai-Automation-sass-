# MrLxwa (GrowthTeam AI) — Agent Architecture & Developer Handoff

**Purpose of this document.** It is written to be handed to an outside developer/consultant.
It explains what the product is, every agent that exists today, exactly how each one works,
and what is still missing — so that the reader can recommend **existing open-source GitHub
projects we should adopt instead of writing each agent from scratch** (the way GPT Researcher
is the obvious candidate for a research agent).

It deliberately contains **no credentials, no endpoint hostnames, no key values, no auth
internals and no infrastructure secrets.** Everything here is architecture and behaviour.

- Date of this snapshot: **2026-08-26**
- Codename in code: `GrowthTeam AI` · Product name being adopted: **MrLxwa**
- The question we want answered is in **§10 — What we want from you**.

---

## 1. What the product is

A SaaS "AI marketing team" for small businesses. The customer connects their website (and
optionally Google Search Console / GA4 and their WordPress site). From then on a team of AI
agents does the marketing work a small company cannot afford to hire for:

1. Reads and understands the customer's whole website.
2. Decides what content the business should publish next — grounded in the customer's real
   niche, their real pages, and their real Google Search Console data.
3. Validates each topic against real keyword search volume.
4. Writes the article in the business's tone, with real internal links.
5. Runs a quality gate on the draft.
6. Puts it in an approval queue (or publishes it automatically if the customer opted in).
7. Publishes to the customer's WordPress site or their webhook, and reports the live URL.

The whole thing is presented to the customer as an **animated isometric office**: each agent is
a character at a desk, and the room lights up / shows a live task while a real background job
is running. There is also a chat assistant ("Mr Lxwa") that acts as the manager — you talk to
him and he starts real jobs.

**Core product principle, repeated everywhere in the code:** the system never invents facts.
If there is no data to ground a decision, the agent says so and does nothing, rather than
making something up. No fake search volumes, no invented statistics, no fabricated
"originality 98%" scores.

---

## 2. Architecture at a glance

```
   ┌──────────────────────────────┐        ┌──────────────────────────────────┐
   │  Next.js 14 web app          │        │  agent-server (Node + Express)   │
   │  (App Router, React 18)      │        │  always-on worker process        │
   │                              │        │                                  │
   │  · Landing / auth / onboard  │ HTTP   │  · pg-boss job queues            │
   │  · Dashboard (iso office)    │ ─────► │  · 7 agent workers               │
   │  · Approvals / Content       │ POST   │  · minute-tick scheduler         │
   │  · Schedule / Memory         │ /jobs  │  · Socket.io live agent status   │
   │  · Chat (Mr Lxwa) + API      │ ◄───── │                                  │
   └──────────────┬───────────────┘ socket └───────────────┬──────────────────┘
                  │                                        │
                  └────────────────┬───────────────────────┘
                                   ▼
                     ┌────────────────────────────┐
                     │  Supabase (Postgres)       │
                     │  · multi-tenant + RLS      │
                     │  · pgvector (site_pages)   │
                     │  · pg-boss queue tables    │
                     └────────────────────────────┘
                                   ▲
        ┌──────────────────────────┼──────────────────────────┐
        │              external services (all optional)       │
        │  LLM + embeddings provider · keyword-data provider  │
        │  Google Search Console / GA4 · WordPress REST       │
        └─────────────────────────────────────────────────────┘
```

**Two deployables, two separate builds.** The Next.js app and `agent-server/` have separate
`package.json`, separate `tsconfig`, separate dependency trees. Shared logic (embeddings,
crawling, publishing) is **deliberately duplicated**, not imported across the boundary. Any
replacement agent must respect that split: long work runs in `agent-server`, not in a
serverless request.

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind v4, shadcn/ui, framer-motion, next-themes |
| Web API | Next.js Route Handlers (`app/api/**`), Node runtime |
| Agent runtime | Node 22, Express 4, TypeScript (NodeNext, strict) |
| Job queue | **pg-boss v12 on Postgres** (chosen over BullMQ/Redis — one datastore, no Redis to run) |
| Realtime | Socket.io (per-tenant rooms) |
| Database | Supabase Postgres, Row Level Security per tenant, `pgvector` for page embeddings |
| Auth | Supabase Auth (cookie/SSR based) |
| LLM (execution tier) | NVIDIA NIM — Nemotron 3.5 Lightning 30B-A3B; adapter allows swapping provider |
| LLM (writing tier) | **Currently the same Lightning model — a known temporary compromise.** The design calls for a frontier model behind the same adapter |
| Embeddings | NVIDIA `nv-embedqa-e5-v5`, 1024-dim, stored in `pgvector` |
| Keyword data | DataForSEO Labs (keyword suggestions + volume + competition) |
| Analytics data | Google Search Console + GA4 (read-only OAuth) |
| Publishing | WordPress REST API, or a signed outbound webhook |
| Hosting | Vercel (web) + Railway (agent-server) |

---

## 3. How ANY agent runs — the shared runtime

Every agent is the same shape: a class with a `type` and a `run(job, ctx)` method.
Understanding this section means you understand the operational contract that any replacement
library has to fit into.

**File map:** `agent-server/src/agents/base.ts`, `queues.ts`, `workers.ts`, `jobsLog.ts`,
`config/caps.ts`, `socket.ts`.

1. **Queues.** One pg-boss queue per agent type: `boss`, `keyword`, `writer`, `social`, `seo`,
   `leads`, `crawler`. Declared at boot before anything can send or work them.
2. **Retries.** `retryLimit: 2` with exponential backoff (3s → 6s → 12s), i.e. 3 attempts
   total. The attempt number is surfaced in the UI task text ("retry 2/3") — an earlier version
   logged retries as three unrelated jobs and the dashboard looked like it was randomly failing.
3. **Job expiry.** Default 15 minutes; the crawler queue gets 1 hour because a 300-page crawl
   genuinely runs long.
4. **Concurrency.** Two concurrent jobs per queue.
5. **Caps, checked before work starts** (`config/caps.ts`) — two separate ideas that used to be
   one number, which is why a paying customer got rationed like a trial:
   - **Plan caps** (commercial): per-plan, per-agent daily limits. `free` is small, `starter` is
     generous, the top plan has *no* daily cap. Overridable per tenant and per deployment.
   - **Runaway guard** (technical): a per-hour ceiling that applies to *everyone*, including
     unlimited plans. It exists only to stop a bug enqueuing thousands of jobs. No human can
     reach it.
   - A cap hit is **not** an error: it is logged as a distinct `skipped` state with a
     human-readable reason and a hint, and does not burn a retry.
6. **Progress reporting.** `ctx.onProgress({...})` is throttled to one write per 2s and merged
   into the job log, so a ten-minute crawl shows "reading page 41 of 300" instead of a spinner.
7. **Job log.** Every job writes start / progress / finish / error / skipped rows to `jobs_log`
   with the tenant, agent type, a human task label, attempt number, duration and the full return
   value. The dashboard, the daily report and the chat's status answers all read from this one
   table.
8. **Error explanation.** Raw provider errors are translated into a customer-readable cause
   before being stored (`lib/errors.ts`).
9. **Live status.** Each transition emits a Socket.io `agent:status` event into a per-tenant
   room, which is what animates the office.
10. **Entry point.** `POST /jobs/:type` on agent-server, gated by a shared-secret header, with a
    cap pre-check so a refused job returns a real error instead of a job id for work that will
    never run. The web app only ever calls it through one helper (`lib/agent-jobs.ts`), used
    both by the "Run the team" button and by the chat — the chat is not allowed to have its own
    separate pretend pipeline.

---

## 4. The agents that exist today

**Seven queue agents + two pipeline stages + one conversational agent.**

The customer-facing office shows **five characters**, because a stage inside another agent's job
is still work someone wants to watch:

| Character | Role shown to user | Backed by |
|---|---|---|
| Mr Lxwa | Chief of Staff / Orchestrator | `boss` queue agent |
| Mr. Keyword | Search Analyst | `keyword` queue agent |
| Mr. Writer | Staff Writer | `writer` queue agent |
| Mr. QA | Quality Editor | quality-gate stage inside the writer job |
| Mr. Publish | Publishing Manager | publish stage / approval action |

Plus three queue agents that are **not** shown because they are stubs: `social`, `seo`, `leads`.
And the site `crawler`, which runs invisibly after onboarding.

The chain the code actually runs:

```
  boss ──► keyword ──► [optional human keyword choice, ~20s window] ──► writer
                                                                         │
                                                            quality gate │
                                                                         ▼
                                             pass ──► awaiting_approval ──► publish
                                             fail ──► failed (visible, debuggable)
```

---

### 4.1 `boss` — Mr Lxwa, the orchestrator ✅ REAL

**File:** `agent-server/src/agents/boss.ts`

**What it is for.** Before this agent existed, nothing connected the agents: keyword research
ran and died in a log, and the writer had to be hand-fed a topic. This is the agent that decides
*what the team works on* and starts the chain.

**Triggered by:** the "Run the team" button, a chat order ("run the team", "plan this week"), or
the scheduler firing at the customer's chosen local time.

**Inputs:** `tenantId`, `count` (clamped 1–5), `chain` (`true` | `false` | `"choose"`),
optional `scheduleRunId` and `autoPublish` (set only by the scheduler), `source`.

**How it works:**

1. Best-effort asks the web app to refresh Google Search Console / GA4 first, so a 9am run plans
   against this week's numbers rather than a stale pull. A failure here must not stop the plan.
2. Loads, in parallel: the tenant row (name, website, niche, tone profile), up to 40 crawled page
   titles, the last 30 already-written titles, and the Search Console insight rows.
3. **Refuses to invent.** If there is no niche, no crawled pages *and* no Google connection, it
   returns `planned: 0` with an explanation telling the user to run the crawler or finish
   onboarding. It does not guess topics for a business it knows nothing about.
4. Builds a planning prompt containing the business, the niche, the existing site pages, an
   explicit "do not repeat these" list, and — when Google is connected — the striking-distance
   and high-impression query lists, with an instruction that **at least half the topics must come
   from measured search data**.
5. Asks the LLM for strict JSON: `{"topics":[{"topic","why"}]}`.
6. Enqueues one `keyword` job per topic, passing `chain`, `scheduleRunId`, `autoPublish` and a
   human task label ("Researching \"X\"").

**Output:** the planned topics with a one-line reason each, plus `groundedIn` — whether the plan
came from Search Console or from the crawl + niche. So "why these topics?" is always answerable.

**Never does:** publish, or skip the human. The chain always ends in the approval queue unless
the customer explicitly turned on auto-publish for that schedule.

---

### 4.2 `keyword` — Mr. Keyword, the search analyst ✅ REAL

**File:** `agent-server/src/agents/keyword.ts` (+ `lib/dataforseo.ts`, `lib/keywordFallback.ts`,
`lib/blueprint.ts`, `lib/insights.ts`)

**Three data sources, in strict order of evidence quality:**

| # | Source | What it gives | Trust |
|---|---|---|---|
| 1 | DataForSEO Labs | Average monthly search volume + competition for the whole market | Measured |
| 2 | Google Search Console | The queries **this site is already shown for**, with impressions and position | Measured, site-specific |
| 3 | LLM fallback | Related customer questions only — **never a number** | Suggested, labelled as such |

The rule enforced in code: an invented volume is indistinguishable from a measured one, so the
fallback returns queries with a null search volume, and the article blueprint carries an explicit
note forbidding the writer from stating any volume, difficulty or traffic figure.

**Three operating modes**, set by whoever enqueues it:

- `chain: false` — **research only.** Nothing gets written. (This exists because customers ask
  for "just the keywords" and that used to be impossible to request.)
- `chain: true` — research, then immediately hand the seed topic to the writer.
- `chain: "choose"` — research, write the candidate list into a `keyword_choices` row with an
  expiry, show the customer a table + countdown, and **schedule the writer job to start after the
  window**. The scheduling is server-side on purpose: a 9am automated run has no browser open,
  and the article still has to get written.

**How it works:**

1. Loads the tenant's Search Console insights and the queries related to the seed topic.
2. Calls DataForSEO for up to 15 keyword ideas; keeps keyword, volume and competition level.
3. On provider failure: falls back to Search Console (if ≥3 related queries), else to the LLM
   suggestion list. If everything returns nothing, it throws with the original provider error.
4. `"No search demand found"` is only ever reported when the market was **actually measured** —
   it is never claimed on fallback data.
5. Builds a **blueprint** (plain text, not JSON, because it feeds straight into the writing
   prompt): primary keyword, the related queries in descending volume order, each number labelled
   with where it came from, and the internal-link candidates.
6. Depending on mode: return, enqueue writer, or open a choice and schedule the writer.

**Failure design:** if the choice row cannot be written, it falls back to writing the seed topic
rather than dropping the article on the floor, and says so in the result.

---

### 4.3 `writer` — Mr. Writer, the staff writer ✅ REAL

**File:** `agent-server/src/agents/writer.ts` (+ `lib/writer.ts`)

**Inputs:** `topic` + `blueprint`, **or** a `choiceId` (the keyword-choice path), plus
`scheduleRunId` and `autoPublish`.

**How it works:**

1. If it woke from a keyword choice, it reads which keyword actually won (the user's pick, or the
   recommendation if nobody picked), marks the choice used, and **rebuilds the blueprint for the
   keyword that won** — reusing the recommended keyword's brief would write about the wrong thing.
2. Loads business context: name, website, niche, audience, tone, up to 12 real crawled pages
   (for genuine internal links), and a pre-rendered block of measured Search Console facts.
   Context is an improvement, not a prerequisite — a lookup failure produces a less specific
   article rather than no article, and the metadata records which context was actually used.
3. Generates the article against **nine explicit writing rules** that live in code (so the UI can
   show the customer the same list). Abridged:
   - Answer the primary keyword in the first 100 words.
   - One `##` section per blueprint query, descending by volume.
   - Use only facts from the business context or blueprint — **never invent statistics, prices,
     awards, client names or dates**.
   - Link only to the business's real crawled URLs.
   - **Never print a Search Console impression / click / position in the article** — that data
     shapes what you write, it is not content for the reader.
   - Short paragraphs, no filler openings, end with one concrete next step.
   - 1200–1800 words, starting with a single `# Title` line.
4. Runs the **quality gate** (§4.4).
5. Inserts a `content_items` row: `awaiting_approval` if the gate passed, `failed` if not — a
   failed draft still gets a row so it is visible and debuggable rather than vanishing.
6. If (and only if) this run was set to auto-publish **and** the gate passed, it publishes and
   then moves the row to `published`. Written in that order on purpose: a crash between insert
   and delivery must never leave a row claiming to be live on a site that never received it.

**Known operational details worth knowing before you replace it:**

- Timeout is 180s. A full article is the longest single generation in the product.
- The model's reasoning mode is explicitly disabled at the API level, because a soft
  "detailed thinking off" hint in the system prompt was ignored and the model spent minutes
  generating reasoning before writing a word. This was the single biggest source of writer
  timeouts.
- The token ceiling is set explicitly, otherwise the draft was cut off mid-sentence.
- **The writer is the one place where the current model is the wrong tool.** It runs on the
  cheap/fast execution-tier model as a stand-in. The design calls for a frontier writing model
  behind the same adapter, and the adapter already has the second provider case stubbed out.

---

### 4.4 Quality gate — Mr. QA ✅ REAL (a stage, not a queue)

**File:** `agent-server/src/lib/qualityGate.ts`

Deliberately only claims what is **actually measurable from the text**:

- word count (minimum 600)
- section headings, `##`/`###` (minimum 2)
- link count
- pass/fail with a list of human-readable reasons
- title extracted from the article's own `# Title` line

The earlier demo UI showed a fake "originality 98%". It was **dropped rather than faked** — a
real plagiarism/originality check is a separate paid API, and inventing the number was worse
than not having it.

**The product spec calls for a 7-check gate** (see §7): plagiarism, keyword/structure placement,
HTTP link validation, tone-match by embedding similarity, image compliance, outreach
personalization sanity, sensitive-content escalation, factual flags. **Only the structural
subset is built.** This is one of the clearest places where an existing library would help.

---

### 4.5 Publishing — Mr. Publish ✅ REAL (a stage, not a queue)

**Files:** `lib/publish.ts` (web app) and `agent-server/src/lib/publish.ts` (a deliberate port,
because a scheduled 9am run has no browser to press "approve").

Two destinations, same order of preference in both code paths so a manual approval and an
automatic run always land in the same place:

1. **WordPress REST** — creates a published post from the markdown, converted to HTML.
2. **Signed outbound webhook** — for customers on Next.js/custom stacks; the payload is
   HMAC-signed so the receiving site can verify it.

Credentials are stored encrypted at rest and decrypted only at the moment of use.

**Failure design:** a failed auto-publish leaves the row **in the approval queue** with the error
recorded, not marked `failed` — a network blip must not bury a perfectly good draft. And if the
publish succeeded but the database update failed, the customer is explicitly *not* told it
worked.

---

### 4.6 `crawler` — the site crawler ✅ REAL

**File:** `agent-server/src/agents/crawler.ts` (+ `lib/crawl.ts`, `lib/embeddings.ts`)

Two crawls exist, and the difference matters:

| | Onboarding crawl | Background crawler agent |
|---|---|---|
| Where | Next.js route, synchronous | agent-server, queued job |
| Depth | ~15 pages | up to 300 pages |
| Why | must finish inside a serverless request | can take an hour |

**How it works:**

1. Normalises and validates the stored website URL. If it is not a usable address, it **returns**
   a clear message naming the bad value — it does not throw, because retrying cannot fix a bad
   stored string, and it used to fail three times with an unattributed "Invalid URL".
2. Discovers URLs (sitemap first, then link following), capped.
3. For each page: fetch → extract title + text → embed (1024-dim) → upsert into `site_pages`
   keyed on (tenant, url) so re-runs do not pile up duplicates.
4. Reports progress per page **before** fetching, so the URL on screen is the one being worked on.
5. Records failures **by name**, up to 20 — "40 skipped" tells you nothing about whether it
   matters.
6. Finally re-summarises the business's niche and content topics from the **full** set of titles
   on file, and writes that back to the tenant row.

`site_pages` is the RAG store: it feeds topic planning, the writer's internal links, and would
feed a future website chatbot widget.

---

### 4.7 `social` ⛔ STUB · `seo` ⛔ STUB · `leads` ⛔ STUB

All three are placeholder classes: they sleep 800ms and return `{ note: "stub" }`. They have
queues, caps, workers, logging and UI hooks already — **only the agent body is missing.**
They are intentionally hidden from the customer-facing office so a real run does not look like a
mostly-dead building.

- **`social`** — should post approved content to Facebook / Instagram / X / LinkedIn, and
  produce one-tap-copy drafts for platforms that have no posting API.
- **`seo`** — should run site audits (broken links, meta, speed, mobile), uptime/SSL monitoring,
  SEO decay detection and internal-linking suggestions.
- **`leads`** — should discover businesses matching an ICP, enrich and verify contacts, and score
  every lead **with a mandatory stated reason** (the rule in the spec is: *no reason → not shown*).

---

### 4.8 Mr Lxwa — the conversational manager ✅ REAL

**Files:** `app/api/chat/route.ts`, `lib/chat-intent.ts`, `lib/chat-classify.ts`,
`lib/chat-context.ts`, `lib/chat-cache.ts`

Not a queue agent — it is a streaming chat endpoint that can **start real jobs**. It is the most
heavily engineered single file in the product, and the design decisions are worth reading before
proposing a replacement framework.

**Personality contract (enforced in the system prompt):** he is the *manager*, not the writer.
He will not write an article, a sample or even an outline in the chat. Two sentences maximum.
He answers only what was asked — a greeting gets a greeting, not a status report. He never claims
work was queued when it was not.

**Two-stage intent detection — a fast path and a slow path:**

1. **Regex matcher** (`chat-intent.ts`) — instant, free, and right about the obvious cases.
   It handles English + Hinglish + Roman Urdu, is typo-tolerant ("artical", "artcile",
   "artikel"), separates *questions about the work* from *orders*, separates *status checks*
   ("kya update hai") from new orders so asking how it is going never re-queues and re-bills the
   job, and has an explicit **negation** pattern in both languages.
2. **LLM classifier** (`chat-classify.ts`) — runs **only when the matcher is unsure**, and only
   for messages that mention the work at all. Returns `write | research | plan | none` plus a
   cleaned topic, at temperature 0 so the same sentence classifies the same way twice.

**Both are biased hard towards doing nothing.** A missed order costs one rephrase; a false
positive spends the customer's credits producing something nobody asked for. Unsure → `none`,
unexpected response → `none`, failed call → `none`.

The reason this is so defensive: real shipped bugs. *"ek keyword research karke do … but artical
nahi likhna"* matched a writing verb and an article noun, so an explicit instruction **not** to
write an article was read as an order to write one — and one got written.

**Performance work already done here** (relevant if you propose swapping in a framework):

- Seven serial database round trips before the model was even called — including the same auth
  call made twice — collapsed into parallel reads behind one auth check.
- Non-streaming generation followed by fake 22ms-per-word typing was replaced with a real token
  relay. Time-to-first-word went from "however long the whole answer took" to ~1.2s.
- A short-TTL context cache keyed per session.
- The counts in the prompt are read **server-side**; the client used to send them and was
  reliably wrong (it reported zero pending approvals while six real articles sat in the queue,
  and the model read that out as fact).

Chat conversations, messages and **team event rows** are persisted. Team reports (e.g. "Mr.
Keyword found these five keywords with these volumes") are stored as a separate `event` kind —
they are not turns in the conversation, so they stay on screen but are kept out of the model's
history.

---

### 4.9 The scheduler ✅ REAL

**File:** `agent-server/src/scheduler.ts`

The thing that makes the product actually automatic. Ticks once a minute, reads enabled
`schedules` rows, and starts the boss chain for any tenant whose **local wall-clock** just
reached their chosen time.

- Wall-clock + IANA timezone, **not** a UTC cron: "every day at 9am" must stay 9am for the
  customer through daylight saving.
- A ±5-minute window absorbs late ticks; a last-run timestamp stops a slot double-firing inside
  it.
- **Missed runs are never replayed.** If the process was asleep at 09:00 the run is skipped —
  waking at noon and firing a backlog would spend the customer's credits on articles they were
  no longer expecting.
- Each firing gets a `scheduleRunId` threaded boss → keyword → writer and stamped on every
  content row, so the UI can say exactly which articles came out of the 9am run rather than
  guessing from timestamps.
- **Auto-publish is opt-in, per schedule, default off.** The reasoning is written into the
  migration: turning on "2 articles every day at 9am" *is* the approval, given once in advance.
  But the quality gate remains the last check, and a failed publish falls back to the approval
  queue.

---

## 5. Data model (summary)

14 migrations. Multi-tenant with Row Level Security on every table.

| Table | Holds |
|---|---|
| `tenants` | business profile, website, niche, tone profile, ICP profile, plan, onboarded flag, memory facts, per-tenant cap overrides |
| `site_pages` | crawled pages: url, title, text, **1024-dim embedding**; unique per (tenant, url) |
| `site_insights` | measured Google data: Search Console queries/pages, GA4 traffic, Business Profile — every row is a measurement with a period attached |
| `content_items` | articles: status (`draft` / `awaiting_approval` / `approved` / `published` / `failed` / `rejected`), title, body, blueprint, metadata incl. the quality-gate result |
| `jobs_log` | every agent run: agent, task label, status (incl. `skipped`), attempt, duration, result/error detail |
| `schedules` | recurring automation: local time + timezone, count, enabled, auto-publish, last run |
| `keyword_choices` | the human's keyword pick window: candidates, research payload, recommendation, expiry, what was chosen and by whom |
| `chat_conversations` / `chat_messages` | chat history, including a separate `event` kind for team reports |
| `integrations` | connected destinations (WordPress / webhook / Google), credentials encrypted at rest |
| pg-boss tables | the job queue itself |

---

## 6. What is real vs. what is not — the honest table

| Capability | State |
|---|---|
| Auth, multi-tenancy, RLS | ✅ Real |
| Onboarding + quick site crawl | ✅ Real |
| Deep site crawl + embeddings | ✅ Real |
| Topic planning grounded in real data | ✅ Real |
| Keyword research (3 sources, ranked by evidence) | ✅ Real |
| Human keyword choice with countdown | ✅ Real |
| Article writing | ✅ Real — **but on the wrong model tier** |
| Quality gate | ⚠️ Structural checks only (3 of the spec's 7+) |
| Approvals queue | ✅ Real |
| WordPress / webhook publish | ✅ Real |
| Recurring schedule + auto-publish | ✅ Real |
| Job caps + runaway guard | ✅ Real |
| Live agent status (Socket.io) | ✅ Real |
| Chat manager that starts real jobs | ✅ Real |
| Daily reports | ✅ Real (read from `jobs_log`) |
| Google Search Console / GA4 sync | ✅ Real (read-only) |
| **Social posting** | ⛔ Stub |
| **SEO audit / site care** | ⛔ Stub |
| **Lead generation** | ⛔ Stub |
| **Outreach (email / WhatsApp)** | ⛔ Not started |
| **Reputation / review management** | ⛔ Not started |
| **Image generation** | ⛔ Not started |
| **Website chatbot widget** | ⛔ Not started (the RAG store it needs already exists) |
| **Billing / payments** | ⛔ Not started |
| **Rich article editor** | ⛔ Not started |

---

## 7. The agents the spec calls for but we have not built

From the product spec (v3.0). These are the ones where we most expect an existing open-source
project to save us months.

| # | Agent | What it must do | Status |
|---|---|---|---|
| 1 | Boss AI / Orchestrator | Plan, route, delegate, report | ✅ built (simple — could become a real graph) |
| 2 | Mr. Keyword Finder | Volume / difficulty / SERP-driven topic selection | ✅ built (no SERP analysis yet) |
| 3 | Mr. Writer | Frontier-model, section-by-section, tone-matched long form | ⚠️ built on wrong tier |
| 4 | Mr. Story Maker | Images, alt text, web stories | ⛔ |
| 5 | Mr. Social Media Manager | Multi-platform scheduling + posting | ⛔ stub |
| 6 | Mr. Lead Hunter | ICP-based business discovery + enrichment + scoring | ⛔ stub |
| 7 | Mr. Outreach | Compliant cold-email sequences, reply detection, opt-out | ⛔ |
| 8 | Chat Agent (site widget) | Embeddable RAG chatbot over the customer's own site | ⛔ |
| 9 | Mr. Reputation | Review monitoring + reply drafts | ⛔ |
| 10 | Mr. Analyticser | Insight narration, decay detection, reporting | ⚠️ partial (raw sync exists) |

**Compliance constraints that any recommended library must not violate** (these shaped the
product design; they are not negotiable):

- No automated bulk SMS to collected numbers. SMS/WhatsApp to cold contacts is always a draft the
  customer personally sends.
- Automated WhatsApp only to consented / inbound contacts.
- Cold email is B2B only, from a separate warmed sending domain per client — never the client's
  real domain — with opt-out, accurate headers, hard daily caps and reply-detection auto-stop.
- Lead discovery uses public business information only. No personal-account scraping, no
  purchased lists.
- Negative reviews are always escalated to a human, never auto-replied.
- No fully-automated posting to platforms with no posting API (Quora / Reddit) — draft-assist only.

---

## 8. Missing pieces inside agents we *have* built

Worth listing separately, because a library might solve these without replacing the agent:

1. **SERP analysis.** The blueprint is built from keyword volume only. The design calls for
   fetching the top 10 results, extracting their headings / length / topics, computing the gap,
   and expanding with People-Also-Ask + related searches + autocomplete. **None of this exists.**
2. **Frontier writing model.** The adapter is there; the second provider case throws.
3. **Full quality gate.** Plagiarism, HTTP link validation, tone similarity, sensitive-content
   escalation — all missing.
4. **Section-by-section writing.** Currently one single generation for the whole article.
5. **Content refresh.** No re-reading of published articles against later Search Console trends.
6. **Real orchestration graph.** `boss` is a single LLM call that fans out into a queue. There is
   no planner/critic loop, no re-planning, and no tool-calling agent loop anywhere in the product.
7. **Crawl depth/quality.** The crawler is a hand-rolled fetch + Cheerio extraction. No JS
   rendering, no readability heuristics, no PDF/doc handling, no incremental re-crawl.
8. **Observability of agent reasoning.** We log inputs and outputs, not intermediate steps.

---

## 9. Where everything lives

```
app/
  api/                 web API — chat, dashboard, content, schedule, integrations, onboarding
  app/                 the logged-in product (dashboard, approvals, content, schedule, memory,
                       reports, billing, connect)
  onboarding/          5-step wizard
components/            AppShell, the isometric office, landing, shadcn/ui primitives
lib/
  agents-data.ts       the office roster + per-agent profile/brief + the real handoff map
  agent-jobs.ts        the ONLY caller of agent-server's job endpoint
  chat-intent.ts       regex fast-path intent matcher (EN + Hinglish + Roman Urdu)
  chat-classify.ts     LLM slow-path classifier, biased towards doing nothing
  chat-context.ts      parallel context loads for the chat prompt
  dashboard-data.ts    turns jobs_log rows into human sentences for the UI
  publish.ts           WordPress + signed webhook delivery
  google.ts            Search Console / GA4 read-only integration
  ai/                  LLM + embeddings adapters (provider-swappable)
  crawl.ts             URL discovery + page extraction
agent-server/src/
  index.ts             Express app, job endpoint, health/version
  queues.ts            queue declarations, retry policy, enqueue()
  workers.ts           the shared worker loop: caps, logging, progress, retries, sockets
  scheduler.ts         minute tick → boss chain
  socket.ts            per-tenant realtime rooms
  jobsLog.ts           job lifecycle + daily/hourly usage counting
  config/caps.ts       plan caps + runaway guard
  agents/              base · boss · keyword · writer · crawler · social* · seo* · leads*
  lib/                 llm · writer · embeddings · crawl · dataforseo · blueprint · insights ·
                       qualityGate · publish · googleSync · keywordFallback · errors
supabase/migrations/   001–014
docs/                  this file, AI_LOGIC.md, COMPETITOR_ANALYSIS.md, PROJECT_DOCUMENTATION.md,
                       the product spec and the build guide

(* = stub)
```

---

## 10. What we want from you

**The ask:** for each row in the table below, tell us whether a mature open-source project
already does this well enough to adopt or fork, and which one. We would rather integrate a
proven repo than write another agent from scratch — a from-scratch agent is where our bugs come
from.

For each recommendation, please tell us:

1. Repo name + link, licence, and whether it is actively maintained.
2. Language / runtime — **Node/TypeScript is a much easier fit** for us; a Python service is
   acceptable only if it is worth a second deployable.
3. Whether it can run as a **library inside our existing pg-boss worker**, or whether it insists
   on being its own server/orchestrator. This matters a lot: we already have queues, caps,
   retries, logging, realtime status and multi-tenancy, and we do not want to rebuild them.
4. How it handles multi-tenancy and per-tenant credentials.
5. Whether the model provider is swappable (we use an OpenAI-compatible endpoint today and will
   move the writer to a frontier model).
6. Roughly how much of our requirement it covers, and what we would still have to write.

### The table to fill in

| # | Need | What we have now | Our starting guess (unverified — please verify or replace) |
|---|---|---|---|
| 1 | **Research agent** — SERP fetch, competitor analysis, query expansion, source-cited briefs | Keyword volume only, no SERP work | GPT Researcher |
| 2 | **Agent orchestration** — planner/critic loops, re-planning, tool calling | One LLM call + a queue | LangGraph · CrewAI · AutoGen · Mastra (TS) |
| 3 | **Web crawling / extraction at scale** — JS rendering, readability, sitemaps, incremental re-crawl | Hand-rolled fetch + Cheerio, 300-page cap | Firecrawl · Crawl4AI · browser-use |
| 4 | **Long-form writing pipeline** — outline → section-by-section → assemble → tone match | One single generation | ? |
| 5 | **Content quality gate** — plagiarism, link validation, tone similarity, sensitive-content flags | 3 structural checks | ? |
| 6 | **Social posting / scheduling** across FB / IG / X / LinkedIn | Stub | Postiz · Mixpost |
| 7 | **SEO site audit** — broken links, meta, speed, mobile, decay detection | Stub | ? |
| 8 | **Lead discovery + enrichment + scoring** (public business data only) | Stub | ? |
| 9 | **Compliant cold-email sequencing** — warmup, opt-out, reply detection, caps | Not started | ? |
| 10 | **Embeddable RAG chatbot widget** for the customer's own site | Not started (vector store exists) | ? |
| 11 | **Review monitoring + reply drafting** | Not started | ? |
| 12 | **Image generation + alt text + licensing compliance** | Not started | ? |
| 13 | **Agent observability** — traces, step-level debugging, cost per run | `jobs_log` only | Langfuse · Helicone |

> The names in the last column are starting points we have heard of, not endorsements. Please
> verify each one — maintenance status, licence and actual fit — or replace it with something
> better.

### Constraints to keep in mind when recommending

- **Node 22 / TypeScript preferred.** Postgres is our only datastore — we removed Redis on
  purpose. A repo that mandates Redis, Kafka, or its own Postgres schema is a real cost.
- **Multi-tenant from day one.** Every row is scoped to a tenant and RLS enforces it. A
  single-tenant "run it on your own laptop" tool needs wrapping.
- **We already own the operational layer.** Queues, retry policy, daily caps, a runaway guard,
  job logging, progress reporting, realtime status, error translation. We want agent *logic*, not
  another orchestrator that wants to own the process.
- **Human approval is a product promise, not a setting.** Anything that publishes or sends
  without a gate is not adoptable as-is.
- **Never invent data.** Any library that fabricates metrics, volumes or citations is out. This
  is the one rule the whole product is built on.
- **Cost.** Around 90% of calls run on a cheap execution-tier model. A framework that assumes a
  frontier model for every step changes our unit economics.

---

*Snapshot: 2026-08-26. Contains no credentials, endpoints, or infrastructure details.*
