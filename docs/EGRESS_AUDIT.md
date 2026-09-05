# Egress audit — 2026-09-05

Supabase free plan, one active user, a 36 MB database, 30 MB of files, 1 MAU. Egress: **7.67 GB
against a 5 GB monthly allowance, used in four days** (~1.8 GB/day, 1–4 Sep). The organisation
was restricted, which takes the whole app down.

Nobody was reading anything. The app was idling.

## What was actually doing it

### 1. `jobs_log.detail` held the agent's entire return value — FIXED (`c77f6c9`)

`agent-server/src/workers.ts:178` → `logJobFinish(logId, result)`.

| Agent | what went into `detail` | size |
|---|---|---|
| writer | `body` — the whole article — plus `blueprint`, `qualityGate`, `meta` | 10–20 KB |
| audit | `issues` + `run.pages`: a row per page with LCP/CLS/TBT, up to 200 | 50–200 KB+ |

All of it duplicated: the article is `content_items.body`, the report is `site_audits`. And
`describeJob()` (`lib/dashboard-data.ts:277`), the only thing that turns a detail into a
sentence, reads none of those keys.

Then it was read back, constantly. `/api/dashboard/live` pulls **61 of these rows on every
poll** — `getAgentRoomStates` 40, `getRecentJobs` 20, `getRunningCrawl` 1 — and
`components/LiveAgents.tsx` polls it **every 4s idle, every 1.2s while a job runs**, from
`AppShell` (so on every dashboard page). One open tab is 21,600 polls a day.

Fix: `trimJobDetail()` in `agent-server/src/jobsLog.ts` drops the heavy keys before writing,
caps `cause` at 2,000 chars, and falls back to known-read keys above 8 KB. Migration 024 strips
rows already on file. `getAgentRoomStates` and `getRunningCrawl` now select `detail->progress`
instead of `detail`.

### 2. `/api/schedule/history` — 150 rows × `detail` — FIXED (`c77f6c9`)

`route.ts:154`, `agent in ('keyword','writer')` — the two fattest receipts in the table — and
the only thing read out of them is the failure sentence. Called by `ScheduleSection` every 20s
while a run is active (120s idle) and by every Reports day page. Now selects
`detail->>message`.

### 3. `getEvents()` / `replay()` had no LIMIT — FIXED (`c77f6c9`)

`lib/live.ts:879` fetched a task's entire recording, `payload` included, and the workspace
fallback poll (`live.ts:1083`) re-ran it **every 4s per unfinished task** whenever Realtime was
not connected. Capped at the newest 400, reversed back into fold order.

### 4. Analyst pulls 300 pages × 2048-dim embeddings — NOT FIXED, on purpose

`agent-server/src/agents/analyst.ts:63`. PostgREST returns a `vector` as JSON text, ~40 KB per
row, so a run reads ~13 MB. It is the largest single read in the system — and it is also
correct: the embeddings are what the topic clustering runs on, and it runs a few times a week.
Roughly 1% of the monthly allowance.

The only real fix is moving the k-means into a Postgres function so the vectors never cross the
wire. That is a real change with real risk, and it was not worth making to save 50 MB a month.
Revisit if the crawl limit or the tenant count grows.

### 5. `/api/content` sent up to 100 full article outlines — FIXED (`c77f6c9`)

`blueprint` is the article's outline; the list needs exactly one field of it
(`parent_article_id`, for grouping images and stories under their article). Now
`blueprint->>parent_article_id`, rebuilt into the same response shape so no caller changed.

### 6. pg-boss polled 13 queues every 2 seconds, forever — FIXED (`377d9d5`)

~560,000 queries a day of "anything for me?", whether or not anyone used the product. Queues
now use Postgres NOTIFY (`notify: true` + `useListenNotify`) so a worker wakes the instant a job
is created, and polling drops to a 30s backstop. Nothing starts later than before.

**Not live until agent-server is redeployed to Railway.**

### 7. `getCostSummary` read 5,000 whole receipts — FIXED (`c77f6c9`)

`lib/dashboard-data.ts:527`, `limit(5000)`, to add up one number each. Now `detail->cost`.
(It has no caller today — `/api/dashboard/costs` is unrouted — so it was a landmine, not a
leak.)

### 8. Background tabs polled all night — FIXED (`377d9d5`)

`lib/poll.ts`: a tick while `document.hidden` does nothing, and the callback fires immediately
when the tab comes back. Applied to the agent stage (3s), command centre (7s), schedule
(20/30s) and shell (60s).

## Checked and clean

- **Realtime** (`lib/live.ts:1034`) — broadcast only, no `postgres_changes`, small messages.
- **Storage** (`agent-server/src/lib/media/store.ts:77`) — `cacheControl: 31536000`, public
  bucket, CDN-cached; images are uploaded once and never re-read by us. The only future risk is
  that published articles embed Supabase URLs, so the live site's visitors spend our egress.
- **Scheduler** (`agent-server/src/scheduler.ts:42`) — five sub-ticks a minute, all small
  queries, no wide columns.

## The multiplier everyone forgets

Local `npm run dev`, Vercel and Railway all hit the same project. Two open tabs plus local dev
is three times everything above. Do not leave the dev server running overnight.

## How to confirm, rather than trust this document

```sql
select agent,
       count(*) as rows,
       pg_size_pretty(sum(pg_column_size(detail))) as total_detail,
       pg_size_pretty(avg(pg_column_size(detail))::bigint) as avg_detail
from jobs_log group by agent order by sum(pg_column_size(detail)) desc;
```

After the fixes, no agent's `avg_detail` should exceed a couple of KB.
