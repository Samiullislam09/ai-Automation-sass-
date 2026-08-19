# GrowthTeam AI — Complete Project Documentation

> Full analysis of the codebase, written 2026-08-19. Covers every route, component, and feature currently implemented, plus what's stubbed for a future backend.

## 1. What this project is

**GrowthTeam AI** is a Next.js 14 marketing SaaS frontend: an "AI marketing team" product for small businesses. The pitch is six named AI agents (Boss AI + five specialists) that research, write, and distribute content, with every action gated behind human approval. The product is visualized as a **live animated isometric office** — each agent has a room that lights up when working and goes dark when offline.

This repo is explicitly a **production-reference frontend, not a finished product**. Every place that needs a real backend has a `TODO(backend)` comment. State, the content pipeline, and payments are all simulated client-side with timers and `localStorage` so the full UX can be demoed and clicked through end-to-end before any backend exists.

- **Stack**: Next.js 14.2.5 (App Router), React 18.3.1, TypeScript 5.4.5, Tailwind CSS 3.4.4 (config present but styling is mostly inline `style={}` objects + a global stylesheet).
- **No auth/DB yet**: `npm install && npm run dev` runs the whole thing with zero env vars — everything persists to `localStorage` under the key `gt-state`.
- **Build status** (per README): 17 routes, 0 build errors.

### 1.1 UI redesign in progress (started 2026-08-19)

The landing page (`app/page.tsx`) and its supporting components have been rebuilt to match the visual language of a reference template (`nexus-work-management-platform`, a v0.app "Apex" export) while keeping GrowthTeam AI's own branding and copy. This pulled in a real stack upgrade, not just a reskin:

- **New dependencies**: Tailwind CSS upgraded 3→4 (CSS-first config, no more `tailwind.config.ts`), plus `shadcn/ui`-style primitives (`components/ui/button.tsx`, `components/ui/accordion.tsx`), `framer-motion`, `lucide-react`, `next-themes`, `lenis` (smooth scroll), `class-variance-authority`/`clsx`/`tailwind-merge`. Next.js/React versions were deliberately **not** upgraded (stayed on 14.2.5 / 18.3.1) — the new stack works fine on top of them.
- **Dual token system in `app/globals.css`**: a new shadcn-style CSS variable set (`--background`, `--foreground`, `--card`, `--primary`, etc., with light values in `:root` and dark overrides in `.dark`) was added *alongside* the original hand-rolled variables (`--bg`, `--panel`, `--ac`, etc.) — the old ones were left untouched on purpose. Only the new landing page components use the new tokens; the dashboard/app pages still run on the old dark-only system and are unaffected by the theme toggle.
- **Theme toggle**: `components/theme-provider.tsx` (wraps `next-themes`, wired into `app/layout.tsx` with `attribute="class" defaultTheme="dark" enableSystem`) + `components/theme-toggle.tsx` (sun/moon icon button in the new navbar). Light and dark both work on the landing page; first-time visitors default to dark to match the still-dark-only dashboard.
- **New `components/landing/` folder**: `navbar.tsx` (floating pill nav), `hero.tsx` (animated text reveal, agent-avatar row instead of fake customer photos), `trust-strip.tsx` (marquee of *real* planned integrations — WordPress/GSC/GBP/Meta/LinkedIn/GA — not fabricated client logos), `office-section.tsx` (wraps the existing `<Office demo />`), `features.tsx` (bento grid using the actual 6 product features, plus a live mini pipeline-stage animation), `comparison.tsx` (the existing competitor comparison table, restyled), `pricing.tsx` (reads live from `lib/store.tsx`'s `PLANS`/`TOKEN_COST` — not hardcoded numbers), `faq.tsx` (shadcn Accordion, content sourced from `lib/landing-content.ts`), `final-cta.tsx`, `footer.tsx`, `smooth-scroll.tsx` (Lenis wrapper).
- **Fonts**: Manrope (body) + Plus Jakarta Sans (display/headings) via `next/font/google` — the reference's actual fonts (Cal Sans, Instrument Sans) are local/proprietary files not present in its exported repo, so Google Fonts equivalents were substituted.
- **Scope**: this pass covered the landing page only, by explicit user choice. `/login`, `/signup`, `/onboarding`, `/whoami`, and all `/app/*` dashboard pages still use the original hand-rolled dark-only styling and have not been touched yet — they're next in line for the same design-system treatment.
- **Known follow-up**: `npm audit` flags Next.js 14.2.5 itself (pre-existing, unrelated to this redesign) with a long list of advisories fixed only by upgrading to a much newer Next.js major/minor — that upgrade was deliberately out of scope for this UI pass and should be a separate, explicit decision.

## 2. Repo map

```
app/
  page.tsx                  Landing page (marketing site)
  layout.tsx                Root layout — wraps app in StoreProvider, sets SEO metadata
  sitemap.ts / robots.ts    SEO routes
  login/page.tsx            Login (AuthCard)
  signup/page.tsx           Signup (AuthCard)
  onboarding/page.tsx       5-question setup wizard + simulated site-learning
  whoami/page.tsx           Boss AI's business-understanding summary
  help/[k]/page.tsx         Full-detail help article page (dynamic by topic key)
  api/chat/route.ts         Streaming chat endpoint (SSE-style) for Boss AI chat widget
  app/                      Authenticated app shell (sidebar/mobile nav + pages)
    layout.tsx               Sidebar, mobile bottom nav, client auth guard, BossChat widget
    page.tsx                 Dashboard — office view, stats, create panel, activity feed
    content/page.tsx         Full content list with status pills
    approvals/page.tsx       Approval queue — approve/edit/reject
    reports/page.tsx         Daily report list
    reports/[id]/page.tsx    Single report detail (marks read)
    memory/page.tsx          AI Memory CRUD
    billing/page.tsx         Plans, demo checkout, cancel flow
components/
  Office.tsx                 Animated isometric office (dashboard hero + landing demo)
  kit.tsx                    Help tooltip/link system, Boss AI chat widget, TokenBox
  AuthCard.tsx                Shared login/signup card UI
lib/
  store.tsx                  Global state (Context), demo pipeline engine, persistence
docs/
  AI_LOGIC.md                 Which AI model powers which feature (production plan)
  COMPETITOR_ANALYSIS.md      Competitive positioning vs 5 named competitors
  AI_Growth_Team_SaaS_Spec_v3 (2).docx   Full product spec
  Solo_Developer_Build_Guide.pdf         Step-by-step backend build guide
```

## 3. State & the demo engine — `lib/store.tsx`

A single React Context (`StoreProvider`, consumed via `useStore()`) holds all app state and doubles as the mock backend.

**Shape of state:**
- `user` — `{ name, email } | null`
- `onboarded` — bool
- `plan`, `tokens`, `tokensMax`
- `memory` — array of `{ k, v }` facts
- `content` — array of generated items (`article` / `story` / `social`), each with `status`: `awaiting → published | rejected`
- `reports` — one per calendar day, each holding timestamped `lines`
- `agents` — per-agent `{ st: "w"|"i"|"o", task }` (working / idle / offline)
- `activity` — rolling feed of the last 40 inter-agent messages
- `busy` — true while a pipeline job is running (blocks concurrent generation)

**Persistence**: loads/saves the entire state object to `localStorage["gt-state"]` on every change. Marked `TODO(backend)`: replace with Supabase + RLS.

**Constants:**
- `TOKEN_COST`: article = 10, story = 4, social = 1
- `PLANS`: Free ($0, 10 tokens/mo), Starter ($5, 120 tokens/mo), Growth ($15, 400 tokens/mo)
- `AGENTS`: 6 fixed agents — Boss AI (orchestrator), Mr. Keyword (research), Mr. Writer, Mr. Story (stories/images), Miss Social, Mr. SEO (site care)

**Core actions exposed via context:**
| Action | What it does |
|---|---|
| `generate(type, onStage?, onDone?)` | Runs the simulated pipeline (see §5), deducts tokens, drives agent states/activity feed over a series of `setTimeout`s, then files the result as "awaiting approval" and writes a report line |
| `approve(id)` / `reject(id)` | Flips a content item's status, logs activity + a report line, toasts |
| `applyPlan(plan)` | Swaps plan + token allotment, logs activity/report, toasts — stands in for a payment webhook |
| `report(line)` | Appends a line to today's report, creating it if needed, and marks it unread |
| `act(msg, from?, to?)` | Pushes an entry to the activity feed (used to simulate agents "talking" to each other) |
| `setAgent(id, state, task)` | Updates one agent's live status shown in the office |
| `toast(msg)` | Fires a 3.2s auto-dismiss toast |

All of this is explicitly the seam for backend wiring: `generate()` → agent-server jobs over Socket.io, `applyPlan()` → Paddle/Lemon Squeezy webhook, persistence → Supabase.

## 4. The animated office — `components/Office.tsx`

The dashboard's signature visual. Six isometric "rooms" (CSS-positioned divs, not SVG/canvas) laid out around a ground plane, one per agent, driven entirely by `store.s.agents`:

- **Room state → visuals**: `data-st` attribute (`w`/`i`/`o`) switches CSS for lit/idle/dark-and-asleep rooms via the global stylesheet.
- **Boss AI's room** is visually distinct (an orb instead of a desk/character) and periodically shows a speech bubble cycling through 4 canned lines ("Team status: sab on track ✓", etc.) every 6.5s.
- **Click-to-zoom**: clicking a room computes an isometric camera transform (`scale(1.6) translate(...)`) to "walk into" that room; clicking the background zooms back out.
- **Responsive scale-to-fit**: measures wrapper width on resize and scales the whole 820px-wide world down proportionally.
- **"Chacha's Chai" wala**: a small animated character that periodically (every ~11s) walks from a chai stall to a random online agent's room, pauses with a "Chai garam! ☕" speech bubble, then walks back — pure flavor/personality detail, has no functional role.
- Used in two places: full interactive version on the dashboard (bound to real store state), and a `demo` mode on the landing page (`<Office demo />`) using hardcoded fake states so the marketing site can show it without auth.
- Explicitly marked `TODO(backend)`: real agent states should arrive over Socket.io from an agent server instead of local timers.

## 5. Content pipeline (the "5-stage" simulation)

Triggered from the dashboard's "Create content" panel. Three content types, each token-costed:

- **Article (⚡10)** — the full 5-stage pipeline, shown to the user as a live modal checklist:
  1. Mr. Keyword validates the topic & pulls related queries
  2. Analyze top-10 ranking pages (assigned to Mr. SEO in the simulation)
  3. Build the content blueprint
  4. Mr. Writer writes in brand tone
  5. Boss AI quality-gate check
  Each stage fires on a staggered timer (500ms → 8300ms total), updates the relevant agent's office status/task text, and appends an "agent talking to agent" line to the activity feed (e.g. *"Topic is strong — 8 related queries found."* Mr. Keyword → Boss AI).
- **Story (⚡4)** and **Social post (⚡1)** — a simplified 2-stage version (assigned agent starts working → finishes, ~3s total).

On completion: token balance is already deducted up front, the item lands in `content` with `status: "awaiting"`, a report line is written, and a toast fires. **Nothing ever "auto-publishes"** — this is the product's core trust promise, enforced by the state machine (only `approve()` sets `status: "published"`).

Topics are picked at random from a fixed 4-item list (`TOPICS` in `store.tsx`) — this is purely a UI placeholder; production topic selection is Lightning-model `generateJson` scoring per `AI_LOGIC.md`.

**Dashboard modals** (`app/app/page.tsx`):
- **Confirm modal** — shows token cost before starting any job (transparency-first)
- **Paywall modal** — appears if tokens are insufficient; offers one-tap upgrade to Starter, wired straight to `applyPlan("starter")`
- **Pipeline modal** — live 5-step checklist with spinner on the active step, only for articles

## 6. Route-by-route feature breakdown

### Landing page (`app/page.tsx`)
Full marketing site, single scrolling page with anchored nav (`#office #feat #pricing #faq`):
- Hero with gradient headline, CTA to signup, CTA scrolling to the live office demo
- Embedded **live `<Office demo />`** — "watch your dashboard before you sign up" — the landing page's key differentiator per `COMPETITOR_ANALYSIS.md`
- 6-card feature grid (articles, multi-platform posting, scored leads, human approval, daily reports, site care)
- Comparison table: GrowthTeam AI vs. "AI writing tools" vs. "Enterprise AI agents" across 5 dimensions
- 3-tier pricing cards (Free/Starter/Growth) mirroring `lib/store.tsx`'s `PLANS`
- FAQ (`<details>` accordion, 5 Q&As)
- **SEO**: JSON-LD `@graph` with `SoftwareApplication` + `FAQPage` schema injected via `<script type="application/ld+json">`; root `layout.tsx` sets full Open Graph/Twitter/keywords metadata; `sitemap.ts` and `robots.ts` (disallows `/app/` and `/api/`, allows everything else)

### Auth — `login`, `signup` (`components/AuthCard.tsx`)
Shared card component parameterized by `mode`. Google OAuth button (styled, non-functional) + email/password form. Submitting does **not** validate credentials — it just sets `user` in the store from whatever email was typed (defaults to `demo@business.com`) and routes to `/onboarding` (first time) or `/app` (returning). Marked for replacement with Supabase Auth (email + Google OAuth).

### Onboarding (`app/onboarding/page.tsx`)
5-click wizard, no real typing beyond the website URL:
1. Paste website URL (or "Skip — describe instead")
2. Business type (6 options)
3. Audience (5 options)
4. Brand tone (4 options)
5. Publishing pace (4 options)
6. **"Boss AI is learning…" screen** — 5 staged fake-progress lines appear one by one (~700ms apart): "Reading {site}…", "Detecting your niche…", "Learning your brand tone…", "Mapping content opportunities…", "Building your team's memory…"

On completion, it synthesizes the `memory` array directly from the wizard answers (Website, Business type, Audience, Brand tone, Publishing pace, a computed Niche summary, and a fixed Goals line), sets `onboarded: true`, and routes to `/whoami`. Marked for replacement with a real crawl + embeddings pipeline (Build Guide Step 5).

### Who Am I (`app/whoami/page.tsx`)
A single-paragraph natural-language summary that Boss AI "wrote," assembled by interpolating the `memory` facts into a template sentence. Links out to Memory (to correct anything) or straight into the dashboard.

### Dashboard (`app/app/page.tsx`)
The main authenticated home: greeting header, live `<Office />`, 4 stat cards (tokens left, content published, awaiting approval, daily reports w/ unread count), a "Create content" action panel (3 buttons: Article/Story/Social, each tagged with its token cost), and a live activity feed panel showing the last agent-to-agent messages. Houses the confirm/paywall/pipeline modals described in §5.

### Content (`app/app/content/page.tsx`)
Flat list of every generated item ever, each with type icon, title, timestamp, token cost, and a status pill (`NEEDS APPROVAL` / `PUBLISHED` / `REJECTED`).

### Approvals (`app/app/approvals/page.tsx`)
Queue of only `status: "awaiting"` items. Each card shows a synthetic "quality gate" report (word count/sections/links/originality for articles; frame count for stories; hashtag count for social) and three actions: **Approve & publish**, **Edit** (currently just toasts "wired in backend Step 12" — not implemented), **Reject**.

### Daily Reports (`app/app/reports/page.tsx` + `reports/[id]/page.tsx`)
One report auto-created per calendar day the first time any report-worthy event happens (content generated, approved, rejected, plan changed, memory edited). List view shows date, unread badge, and a preview of the last line. Detail view lists every timestamped line for that day and marks the report read on open.

### AI Memory (`app/app/memory/page.tsx`)
Full CRUD over the `memory` fact list seeded by onboarding: inline edit (✎), delete (🗑), and an "Add fact" modal (label + free-text value). Every mutation logs a Boss AI activity line ("Noted. All agents realigned." / "Forgotten." / "learned something new from you: …") to reinforce the "the whole team adjusts instantly" narrative.

### Billing (`app/app/billing/page.tsx`)
Current-plan summary with token usage bar, 3-tier plan grid mirroring the landing page, a **demo checkout modal** (fake card form, 1.4s fake "Processing payment…" spinner, then calls `applyPlan`), and a **cancel-plan modal** (reverts to Free, explicitly reassures the user that content/memory/reports are kept). Marked for replacement with Paddle/Lemon Squeezy.

### Help system (`components/kit.tsx` `Help`/`HELP`, `app/help/[k]/page.tsx`)
Three-tier help pattern used throughout the app: a small `?` badge next to any labeled feature → hover shows a short tooltip → click routes to `/help/{key}` for a full paragraph explanation. Nine documented topics: tokens, agents, approval, reports, memory, pipeline, billing, status, whoami. Centralized in one `HELP` dictionary so tooltip and detail-page content never drift apart.

### Boss AI Chat widget (`components/kit.tsx` `BossChat`, `app/api/chat/route.ts`)
Floating chat bubble (bottom-right, present on every authenticated page via `app/app/layout.tsx`) that opens a slide-up chat panel styled like a typical support widget. On first open it auto-sends a hidden `"__hello__"` message. Messages POST to `/api/chat`, which streams the reply back **word-by-word** (24ms per word) using a `ReadableStream` — genuinely real streaming infrastructure, just backed by a rule-based canned-response function (`brain()`) instead of a model. `brain()` pattern-matches on keywords (tokens/credit, report/today, team/agent, memory/business, plan/price, article/write, hello) and answers using live context passed from the client (current token balance, plan, memory facts, awaiting-approval count, latest report line) — so answers are dynamic even though the "intelligence" is just regex. Explicitly documented as a one-function swap for NVIDIA NIM (Nemotron 3.5 Lightning) in production, with the exact fetch call written in a comment.

### App shell / navigation (`app/app/layout.tsx`)
Sidebar (desktop) with 6 items (Dashboard/Content/Approvals/Reports/Memory/Billing), badge counts for unread reports and pending approvals, and an embedded `TokenBox` widget. Collapses to a fixed bottom tab bar (first 5 items) under 860px. Contains a **client-side auth guard**: a 350ms-delayed effect that redirects to `/login` if no user, or `/onboarding` if not yet onboarded — explicitly marked to be replaced by Next.js middleware + a real Supabase session check (this guard is trivially bypassable client-side, being pure demo scaffolding).

## 7. Design system notes

- Global styles live in `app/globals.css` (dark theme, CSS variables like `--ac`/accent, `--bg2`, `--panel`, `--line`), referenced throughout via inline `style={}` and a handful of semantic classNames (`card`, `btn btn-p/btn-g/btn-red`, `pillst st-*`, `xs`/`sm`/`mut` text utilities, `modalwrap`/`modal`).
- Tailwind is configured (`tailwind.config.ts`) but barely used in favor of inline styles + the global stylesheet — likely intentional for a single-file-per-component "reference" style.
- No component library (no shadcn/Radix/MUI) — everything is hand-rolled.

## 8. Production AI plan (from `docs/AI_LOGIC.md`)

The repo documents (but does not implement) a two-tier model strategy:
- **"Lightning" tier** (NVIDIA NIM, Nemotron 3.5 Lightning) — cheap, fast, used for ~90% of tasks: Boss AI orchestration/chat, topic scoring, SERP gap analysis, blueprint generation, quality-gate checks, tone matching, social captions, comment triage, daily report writing, lead scoring, chatbot RAG.
- **"Frontier" tier** (adapter over DeepSeek/Gemini/Claude) — reserved for quality-critical long-form writing only: full article drafts and first-touch outreach personalization. Explicitly *not* used for the cheap tier's jobs.
- Embeddings + pgvector for site-crawl tone/niche profiling and chatbot retrieval.
- Env vars named for this: `NVIDIA_API_KEY`, `WRITER_PROVIDER` (+ its key), an embeddings provider key. All model access intended to go through an `lib/ai/` adapter pattern so swapping providers is an env change, not a code change.

## 9. Competitive positioning (from `docs/COMPETITOR_ANALYSIS.md`)

Benchmarked against 5 named products (research dated Aug 2026):
1. **NoimosAI** — closest positioning (24/7 AI marketing team, approval feed); gap filled: GrowthTeam's approval flow is a *visual experience* (live office, named agents) vs. NoimosAI's plain list, plus transparent token pricing vs. their opaque pricing.
2. **Sight AI** — strong on GEO/AI-visibility tracking but content-only; GrowthTeam bundles content+leads+reviews+site-care, treats GEO as roadmap.
3. **HubSpot Breeze** — deep CRM but enterprise pricing/complexity; GrowthTeam undercuts with $0 start, 2-minute setup.
4. **Copy.ai (GTM AI)** — strong workflows but operator-driven, no visible "team" identity.
5. **Jasper** — brand voice/content pipelines but a tool, not a team: no autonomy, no leads, no daily reports, $39+/mo.

Landing-page SEO patterns explicitly borrowed and extended: comparison table (adds a "you can SEE the team" row nobody else can claim), FAQ + JSON-LD schema, outcome-led headings, and a live office demo embedded directly on the marketing page ("show, don't tell" — competitors' dashboards are all faceless).

## 10. What's implemented vs. what's pending

**Fully working (frontend, demo-data level):**
- Landing page with full SEO (metadata, OG, JSON-LD, sitemap, robots)
- Login/signup UI + routing logic (no real auth)
- 5-step onboarding → simulated learning animation → Who-Am-I summary
- Dashboard with live animated office, stats, create panel, activity feed
- Full token/paywall/checkout/plan logic across 3 tiers
- 5-stage article pipeline modal; simplified story/social pipeline
- Approvals (approve/reject fully wired; Edit is a stub)
- Daily reports (auto-generated, unread tracking, detail view)
- AI Memory CRUD
- Billing (plan display, demo checkout, cancel)
- 3-tier help system (tooltip → detail page) across 9 topics
- Boss AI chat with real word-by-word streaming (canned brain)

**Explicitly pending** (every instance marked `TODO(backend)` in-code):
- Supabase auth + Postgres/RLS to replace `localStorage`
- Real website crawl + embeddings (pgvector) to replace onboarding's simulated learning
- An agent-server (BullMQ jobs + Socket.io) to replace the `setTimeout`-based pipeline and drive real-time office states
- Swapping `/api/chat`'s `brain()` for an NVIDIA NIM (Nemotron 3.5 Lightning) call — the streaming plumbing is already production-shaped
- Paddle/Lemon Squeezy checkout + webhooks to replace the demo billing flow
- A real content editor (Approvals' "Edit" button)
- Push notifications / PWA support
- Next.js middleware-based auth guard to replace the client-side redirect effect

## 11. The backend roadmap (from `docs/Solo_Developer_Build_Guide.pdf`)

The PDF is a 10-page, beginner-friendly (Hinglish) step-by-step companion to the product spec, meant to be followed with Claude Code doing the implementation and the solo developer doing accounts/keys/testing/sales. Each step is labeled either **Claude Code** (a copy-pasteable prompt) or **Aap khud** (manual: account signup, API key, clicking, real-world testing) and ends in a **Checkpoint** that must pass before moving on. Golden rules: one step at a time, commit after every step, ask Claude Code to explain unfamiliar files, API keys only ever in `.env`, paste full errors not screenshots.

### Step 0 — Setup Day (manual, do first)
Install Node/Git/Claude Code/VS Code. Sign up for 9 free-tier services: GitHub, Vercel (frontend hosting), Supabase (DB+auth+storage), Upstash (Redis for the job queue), Railway (agent-server hosting), build.nvidia.com (NIM/Lightning API key), DeepSeek or Gemini (writer model, ~$5 credit needed), DataForSEO (keywords/SERP data), Resend (transactional email). Also stand up one throwaway WordPress site and generate an Application Password for it (pipeline test target). Critically: **file the slow approvals on day 1** — Google Cloud APIs (Search Console, Analytics, My Business), Meta Business app (Instagram/Pages), and LinkedIn Community Management API access — these take weeks to approve and gate Phase 2/3 work, so applying early is the single highest-leverage move in the whole guide.

### Phase 1 — Foundation (Weeks 1–8): this is the article pipeline becoming real
| Step | Builds |
|---|---|
| 1 | Next.js 14 + TS + Tailwind scaffold; GitHub repo; Vercel deploy |
| 2 | Supabase schema + RLS: `tenants`, `memberships`, `integrations`, `content_items`, `site_pages` (pgvector), `jobs_log`, `leads`, `notifications` — every table scoped to the calling user's tenant via `memberships` |
| 3 | Supabase Auth (email + Google) login/signup; protected `/app` route group; dashboard shell with the 6 agent status cards (static data at this point) |
| 4 | Onboarding wizard: company profile → website → tone questionnaire → publishing frequency → WordPress connect (with a live "Test connection" call to the WP REST API) |
| 5 | Site crawler (sitemap-first, capped at 100 pages) + provider-agnostic embeddings adapter (`lib/ai/embeddings.ts`) storing into `site_pages`, plus an LLM-generated niche/topics summary into `tenants.tone_profile` |
| 6 | **Agent server** as a second app (`/agent-server`): Node+TS+Express+BullMQ against Upstash Redis, one queue per agent type, a `jobs_log` writer, per-tenant daily caps, retry w/ exponential backoff, a `/health` endpoint, and Socket.io emitting live agent status events. Deployed to Railway (~$5/mo Hobby plan once trial ends) |
| 7 | `lib/lightning.ts` — an OpenAI-compatible client for NVIDIA NIM's Nemotron 3.5 Lightning model with `classify()`, `summarize()`, `generateJson()` (schema-validated, one retry on bad JSON); plus the Boss AI orchestrator that turns a task request into an ordered job queue and streams status over Socket.io |
| 8 | Wire the dashboard's agent cards + a live activity feed to the agent-server's Socket.io feed (replacing Office.tsx's/store.tsx's demo timers) |
| 9 | **Keyword Finder agent**: DataForSEO volume/difficulty + embeddings-based "already covered" exclusion + Lightning `generateJson` scoring → top-5 topic suggestions with reasons |
| 10 | **SERP analyzer + Blueprint**: scrape top-10 results, extract structure/gaps per competitor via Lightning, pull People-Also-Ask, generate a blueprint (titles, full H2/H3 outline, target word count above the top-10 average, 3-5 internal-link candidates by embedding similarity) |
| 11 | **Writer agent**: a named-provider model adapter (`deepseek`/`gemini`/`anthropic`, chosen by `WRITER_PROVIDER` env var) writing section-by-section from the approved blueprint. Explicitly flagged as the one step where **the developer's own judgment, not Claude Code's, decides product quality** — write the same blueprint through 2-3 providers, read all of them, pick the winner as default |
| 12 | **Quality gate + Approvals + Publish**: automated checks (keyword placement, all H2s present, word count vs. target, link-resolution HEAD checks, tone-similarity via embeddings, dated-claim flags) feed an Approvals card UI (Approve / Edit / Reject); Approve publishes straight to the tenant's WordPress via the REST API and stores the live URL. This step is called **"Phase 1 ka dil"** (the heart of Phase 1) — topic → blueprint → draft → QC → approval → live WP post, end to end |
| 13 | Content calendar: BullMQ repeatable jobs matching the tenant's onboarding cadence, a week-grid Calendar page, pause/resume ("vacation mode") toggle |
| 14 | Notifications: installable PWA + Web Push via Firebase Cloud Messaging (deep-links to the approval card) + Resend email fallback with a magic link; per-user quiet-hours preferences |
| 15 | **Real test**: run the pipeline on the developer's own site for 2 weeks, personally read every article before approving and feed a problem-list back to Claude Code to tune the Writer prompt (explicitly called "asli product-making" — the real product work), watch Search Console indexing. In parallel, the guide's most emphasized manual task: **pitch 3-5 real small businesses/agencies**, demo the live pipeline, give the first client 50% off, and hand-invoice them rather than waiting on a billing system — "Paying client ke bina Phase 2 shuru mat karna" (don't start Phase 2 without a paying client). |

**Phase 1 exit criteria**: 5+ AI articles live that the developer personally considers publish-quality, one outside pilot client actively using the system, and the scheduler running full cycles unattended.

### Phase 2 — Distribution (Weeks 6–14, can overlap Phase 1's tail)
One Claude Code prompt per feature from here on, each paired with its own manual gate: embeddable RAG **chatbot widget** (site-key signed, leads captured to `leads` with `source=inbound`); **images agent** (Stability/Unsplash adapter, AI alt-text, WebP, upload to WP media); **Social auto-post** (Meta Graph/X/LinkedIn adapters — flagged as ~80% manual waiting on platform app-review, not coding); **Quora/Reddit draft-assist** (a Ready-to-Paste queue, never auto-posted); **Google Business Profile** integration (weekly posts + Q&A drafts); **daily site audit + uptime** (broken links, PageSpeed, SSL expiry, 5-min pings); and finally **wiring the isometric office prototype to real Socket.io events** instead of demo buttons — noted that the current office art is a prototype/brief only, and a real version needs a commissioned layered-art asset (~$300-800).

### Phase 3 — Growth module (leads) + Billing
**ICP interview** (Boss AI conversationally captures the ideal-customer profile during onboarding) → **Lead Hunter agent** (Google Places + directories + email-finder/verification + Lightning ICP-fit scoring with a one-line reason per lead) → **Mini-CRM** (New/Contacted/Replied/Won/Lost pipeline board) → **email outreach**, called out as the most manual feature in the whole guide: a *separate* sending domain (never the client's main domain), 2-3 weeks of deliverability warmup, manual SPF/DKIM/DMARC setup, hard sending caps (40/day/domain), mandatory opt-out + suppression list, and IMAP/webhook reply-detection that halts a sequence → **SMS/WhatsApp draft queue** (tap-to-open `sms:`/`wa.me` links, never auto-sent — the developer must personally send and tone-check the first 10) → reviews/decay/digest/monthly-report agents (each following the same "one prompt per spec section" pattern) → **Billing** via Paddle or Lemon Squeezy (checkout, webhooks driving subscription state, plan-gated features, usage metering) — gated on a 1-2 week seller KYC approval, so that account should be applied for early too.

### The guide's closing framing
The whole build is "a pile of small 15-minute steps — no step is hard, there are just a lot of them." Four categories of work are explicitly called out as things Claude Code will *never* do for the developer: **(1)** accounts/keys/approvals, **(2)** quality judgment (reading the AI's output, choosing models, tuning prompts), **(3)** real-world testing on an actual phone/site, **(4)** finding clients. Everything else is a Claude Code prompt.

## 12. Suggested entry point for backend work

The README states the intended first prompt for continuing this project: implement the Supabase schema and replace `lib/store.tsx`'s localStorage persistence with Supabase, **while keeping every component's props and behavior identical** — i.e., the store's public API (`s`, `patch`, `generate`, `approve`, `reject`, `applyPlan`, etc.) is the contract every page/component already codes against, so backend work should slot in behind that same interface rather than changing call sites. This is exactly Build Guide Step 2 above.

## 13. Full Product Spec (from `docs/AI_Growth_Team_SaaS_Spec_v3 (2).docx`)

This is the source-of-truth product/technical spec (Version 3.0, "Final End-to-End Development Plan," August 2026) that both `docs/AI_LOGIC.md` and the Build Guide are derived from. It supersedes a v2.0 that was scoped to blog automation only — v3.0 pivots to a **full small-business growth platform**: content, distribution, lead generation, reputation management, and site care, unified under one AI team with a human-approval gate at every outward-facing action.

**Positioning** (§1–2): not a content tool — positioned as a replacement for "the marketing agency + SDR + webmaster a small company cannot afford," marketed honestly as "AI-powered, human-approved." Primary users: small/new companies (local services, clinics, salons, agencies, contractors, early-stage startups) currently outsourcing content; a later Agency tier runs multiple client companies from one account with white-label reporting. Explicit design principle: **every feature in the spec must be truthfully deliverable** — anything that couldn't be (bulk SMS to scraped numbers, fully automated Quora/Reddit posting, server-level security monitoring) was redesigned into a compliant form or cut, not shipped as vaporware.

### 13.1 Master feature list (§3), by module and delivery phase
- **Content Engine**: SERP-driven articles (P1), trending topic discovery (P1), service/landing page copy (P4), auto content refresh (P3), images & alt-text (P2), newsletter (P3)
- **Distribution**: social auto-post FB/IG/X/LinkedIn (P2), Quora/Reddit draft-assist (P2 — no posting API exists for either, so these are always one-tap-copy drafts, never automated), Google Business Profile posts/Q&A/photos (P2), content calendar (P1)
- **Growth Module (Leads)**: ICP-aware lead discovery (P3), enrichment & scoring (P3), compliant cold email (P3), SMS/WhatsApp draft queue (P3 — never automated bulk send), warm-lead auto-WhatsApp for consented/inbound leads only (P3), website chatbot widget (P2), mini-CRM pipeline (P3), lead magnets (P4)
- **Reputation**: review monitoring & reply drafts (P3), review-request campaigns to the client's own consented customers (P3), comment auto-reply/triage (P3)
- **Website Care & Insights**: daily audit — broken links/meta/speed/mobile (P2), uptime+SSL monitoring (P2), SEO decay detection + internal-linking suggestions (P3), real-time GA4/GSC dashboard (P2), competitor tracking (P4), monthly white-label PDF report (P3), daily digest + title A/B testing (P3)
- **Platform/Experience**: AI-team dashboard — Boss AI orb, live Lottie agent status, approval cards, calendar (P1), notifications — Web Push + email fallback, WhatsApp in P3 (P2), voice interaction (P4), billing via Paddle/Lemon Squeezy (P3), operator admin panel (P3)

### 13.2 The full agent roster (§4) — 10 agents, not 6
The spec's roster is larger than what's implemented in this demo (§3 of this doc lists only 6): **Boss AI** (orchestrator, Lightning), **Mr. Keyword Finder** (Lightning+APIs), **Mr. Writer** (Frontier model), **Mr. Story Maker** (Lightning+image APIs), **Mr. Social Media Manager** (Lightning), **Mr. Lead Hunter** (Lightning+APIs — not present in the current demo), **Mr. Outreach** (Lightning, Frontier for first-touch personalization — not present in the current demo), **Chat Agent** for embedded site widgets (Lightning RAG — not present in the current demo), **Mr. Reputation** (Lightning — not present in the current demo), **Mr. Analyticser** (Lightning — not present in the current demo). The demo's Mr. SEO plays a subset of both Mr. SEO Analyzer's and Mr. Analyticser's spec roles.

### 13.3 Model strategy (§5) — same two-tier plan as `AI_LOGIC.md`
Tier 1 "Execution" (≈90% of calls): Nemotron 3.5 Lightning via NVIDIA NIM — routing, classification, validation, RAG, summaries, captions, monitoring, triage; near-zero marginal cost. Tier 2 "Quality-critical writing": external frontier model behind a configurable adapter — full articles, first-touch outreach personalization, service-page copy; ~$0.01–0.05/article, swappable per plan tier.

### 13.4 End-to-end workflows (§6) — the mechanics behind each pipeline
- **Topic discovery**: onboarding crawl builds a pgvector "niche map"; signals = GSC page-2/3 queries (fastest wins) + DataForSEO volume/difficulty + daily Trends/news filtered to niche; Lightning scores and returns top 5 with reasons.
- **SERP-driven article pipeline** (this is what the demo's 5-stage pipeline modal dramatizes): fetch top-10 SERP → extract & analyze all 10 (headings/word count/topics/gaps) → query expansion (PAA, related searches, autocomplete) → blueprint (3 titles, H2/H3 = union of competitor topics + gaps + PAA, target length above top-10 average, internal-link candidates from embeddings) → optional blueprint approval → frontier-model section-by-section writing in tone profile → quality gate → Boss AI review → approval card → CMS publish → distribution starts.
- **Content refresh**: weekly GSC trend read per article; minor fixes (meta, freshness dates, broken links, small factual corrections) can be opt-in auto-applied; substantive rewrites always go through an approval card with a diff view — **full silent auto-rewrite is deliberately never offered**, called out as contradicting the trust model.
- **Chatbot**: one script tag, RAG over the same onboarding pgvector store, unknown answers escalate to a lead-capture prompt, hot leads trigger an instant client notification.
- **Lead generation**: ICP defined via a Boss AI onboarding interview → discovery via Google Places/directories/company sites → enrichment via Hunter/Apollo-class email verification + firmographics → every lead scored with a **mandatory stated reason** ("no reason → not shown") → daily batch delivery, approvable per-lead or per-batch.
- **Outreach**: email is automated but B2B-only, from a separate warmed sending domain per client (never the client's real domain), opt-out + accurate headers + hard caps (~30–50/day/domain), reply detection auto-stops the sequence; SMS/WhatsApp for cold/unconsented leads is always a draft the client personally sends via a deep link — automated WhatsApp only for consented/inbound leads.
- **Reputation**: positive reviews get optional auto-send thank-yous; negative reviews are always flagged for human response, never auto-sent.

### 13.5 Reliability & compliance guardrails (§9) — the spec's core trust argument
Publish failures get 3× exponential-backoff retry then a "needs attention" state; hard per-tenant daily caps on every auto-action so a malfunctioning agent can't loop; a global per-agent-type kill-switch in the admin panel; published content is revertible, drafts are versioned, and a full per-tenant audit log covers every approval/publish/message/action.

Outreach compliance is spelled out explicitly because it shaped several features' designs: **no automated bulk SMS to collected numbers** — India's TRAI DLT rules would block unregistered promotional SMS outright, and US TCPA fines run $500–1,500 per unsolicited message, so the SMS/WhatsApp "draft queue, client presses send" pattern exists specifically to deliver the same personalized-outreach outcome without the legal exposure. Cold email is B2B-only with per-client sending-domain isolation. Automated WhatsApp requires consent per WhatsApp Business API policy. Lead discovery uses public business info only — no personal-account scraping, no purchased lists. The spec frames all of this as a sales pitch, not just risk-avoidance: **"we grow your business without getting you banned, blocked, or sued."**

### 13.6 Pre-approval quality gate (§10) — 7 checks
Plagiarism/duplication (Copyscape/Originality, threshold fail) · keyword usage & structure (title/H1/intro/meta placement, all blueprint H2s present, length ≥ target) · link validity (every link HTTP-checked) · tone match (embedding similarity vs. tenant tone profile) · image compliance (licensed sources, alt-text, WebP) · personalization sanity for outreach (no unresolved `{name}` placeholders, reason present, opt-out present) · sensitive-content flag (complaints/legal/medical topics always escalate to a human, never auto-send) · factual flags (dated claims/statistics highlighted on the approval card).

### 13.7 Architecture & stack (§11–12)
Four layers — PWA frontend → agent orchestration server → data layer → AI layer — plus a CDN-served embeddable chatbot widget. Frontend: Next.js+Tailwind+shadcn/ui PWA on Vercel. Realtime: Socket.io or Pusher for agent status/presence. Animation: Lottie for agent icons/Boss AI orb. Data: Supabase (Postgres, Row Level Security per tenant, Supabase Auth) + pgvector for niche/tone/RAG/internal-linking. Agent server: Node.js or FastAPI on Railway/Render, always-on paid instance. Queue: BullMQ + Upstash Redis. Orchestration: LangGraph or CrewAI for per-agent model assignment. Execution model: Nemotron 3.5 Lightning via NIM (self-host later if economics favor it). Writing model: frontier API behind an adapter. Plus DataForSEO (SEO/SERP), Google Places + Hunter/Apollo-class enrichment (leads), dedicated warmed sending infra (outreach email), Resend/Mailchimp (newsletter), GBP + Meta APIs (reviews/social), cron+PageSpeed (uptime/speed), FCM (push), Paddle/Lemon Squeezy (payments, merchant of record), Google Cloud STT+TTS (Phase 4 voice). Multi-tenancy is enforced at the database layer via RLS on every table — explicitly **not** left to per-query discipline — with signed site keys scoping chatbot-widget requests per tenant, encrypted-at-rest third-party credentials, and GDPR-style tenant-private/export/delete-able lead data.

### 13.8 SaaS website page plan (§13)
Landing (hero + live agent animation + outcome-led sections + pricing preview), Pricing (3 tiers + FAQ + regional currency), How it works, Use-case pages per vertical (SEO channel), a self-written Blog (dogfooding as a live demo), Docs/Help, Login/Signup, the App dashboard, Legal (AI-content disclosure, outreach compliance, privacy, refunds), and a Contact/Demo page for the Agency tier.

### 13.9 Onboarding flow (§14)
Sign up (email/Google + verification) → company profile (what/who/where — seeds Boss AI's persistent context) → add website (crawl capped at 500 pages, builds niche map + tone profile) → connect CMS (WordPress application password/plugin first) → connect Google (OAuth for Search Console + GA4 + Business Profile) → connect socials (skippable) → ICP interview for Growth-tier plans → tone questionnaire + publishing schedule → optional chatbot script-tag install → plan selection + 14-day trial (iPhone users guided through PWA home-screen install for push) → **first value in the first session**: Boss AI proposes 5 topics, plus (Growth tier) the first 10 scored leads.

### 13.10 Billing & pricing (§15) — differs from the current demo
Provider: Paddle or Lemon Squeezy as merchant of record, webhook-driven subscription state.
| Tier | Scope | Price |
|---|---|---|
| Starter | 1 site · 8 articles/mo · social auto-post · GBP · daily audit · analytics · chatbot | $79/mo |
| Growth | Everything in Starter + full Growth Module (leads, outreach, mini-CRM, reviews, newsletter, monthly report) · 20 articles/mo | $149–199/mo |
| Agency | 10 companies · pooled quotas · white-label reports · client workspaces | $399+/mo |

**Note the mismatch**: the currently-implemented frontend (`lib/store.tsx` `PLANS`, and the landing/billing pages) uses a simpler token-metered $0/$5/$15 model instead — that pricing structure is demo-era placeholder, not the spec's intended production pricing. Anyone wiring real billing should confirm which pricing model is current before implementing Paddle/Lemon Squeezy webhooks.

### 13.11 Operator admin panel (§16)
Tenant overview (plan, quotas, AI/API cost per tenant, sending-domain deliverability health, integration status), job monitor (queue depth, failure causes, one-click retry, an outreach-compliance dashboard tracking volumes/opt-outs/bounce rates), per-tenant agent prompt/config tuning + global per-agent-type kill-switch, revenue (MRR/trials/churn from payment webhooks), and logged read-only tenant impersonation for support.

### 13.12 Voice layer — Phase 4 (§17)
Google Cloud STT+TTS for hi-IN and mixed Hindi-English in/out (chosen over self-hosting to avoid GPU burden and keep one billing relationship; Nemotron 3.5 ASR is the noted self-host fallback). Loop: mic → STT → Lightning interprets intent → action → TTS spoken back through the Boss AI orb (which pulses while listening/speaking). Voice approval still resolves to the same tap-approval action underneath. Deliberately a faceless orb identity, no human avatar.

### 13.13 Phased roadmap with exit criteria (§18) — the source Build Guide follows
| Phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| 1 — Content core | 1–8 | Onboarding, Keyword Finder+trending, full SERP article pipeline, quality gate, approval cards, WordPress publish, basic calendar, email-fallback notifications. File Meta/LinkedIn/Google API applications immediately. | One real company running end-to-end; demo-ready; first paying pilot |
| 2 — Distribution & presence | 6–14 | Social auto-post+draft-assist, GBP management, chatbot widget+inbound capture, daily audit+health monitoring, real-time analytics, Web Push+PWA install, live agent-status UI | Full publish-and-distribute loop + inbound leads flowing |
| 3 — Growth Module | 12–22 | Lead discovery/enrichment/scoring, compliant outreach+sending infra, SMS/WhatsApp draft queue, warm-lead WhatsApp, mini-CRM, reviews+campaigns, comment triage, decay detection+refresh, newsletter, monthly report, daily digest, WhatsApp notifications, billing live, admin panel | 5+ paying clients; leads delivered weekly per client |
| 4 — Intelligence & voice | — | Competitor tracking, title A/B, lead magnets, service-page copy, voice loop+orb UX, agency tier, hardening+load tests | Voice demo; capacity 25+ tenants |

Phases deliberately overlap — platform API approvals (Meta/LinkedIn/Google) run in the background from week 1 because they gate Phase 2–3 features, which is why the Build Guide front-loads those applications into Step 0.

### 13.14 Cost model at ~5 clients (§19)
Vercel+Upstash+Supabase $0–25, always-on agent server $5–10, Lightning via NIM ~$0–low, frontier writing (~100 articles + outreach personalization) $3–10, DataForSEO $10–20, lead enrichment APIs $10–30, sending domains+email infra $10–20, plagiarism checks $5–10, plus X API tier once Phase 2 ships. **Total ≈ $45–125/month against $395–995 revenue at 5 clients.** The spec notes the dominant *non-cash* cost is platform-approval lead time, reinforcing the week-1-filing advice.

### 13.15 Competitive framing (§20)
vs. AI content tools (Jasper, SEObot, Koala): none bundle leads+reviews+GBP+chatbot+site-care — the bundle is the moat. vs. lead-gen tools (Apollo, Instantly): built for sales teams, not small-business non-marketers — this product's ICP interview + reason-per-lead makes lead-gen usable without a marketing background. vs. agencies: a fraction of the price, always-on, transparent live dashboard vs. a monthly PDF, client retains control via approvals. Sold as: human-approval-first, platform-safe automation, compliant outreach — "growth without getting banned, blocked, or sued."

### 13.16 Open decisions before launch (§21)
Target market (India-only vs. India+Pakistan — affects voice-language priority, currency/PPP pricing, WhatsApp rollout order), trial type (card-required vs. card-free), writer-model default (settle via the side-by-side test called out in Build Guide Step 11), blueprint-approval default (on/off for new clients), and pilot vertical (spec suggests picking one, e.g. local service businesses, for sharper ICP templates and marketing on the first 5 clients).

### 13.17 Appendix A — Isometric office UI architecture (§Appendix A) — how `Office.tsx` actually works
The spec includes a full technical writeup of the dashboard's animated-office technique, which the current `components/Office.tsx` already implements as a coded prototype:
- **No WebGL** — isometric is a rotated 2D plane: the whole scene is one div transformed `rotateX(55°) rotateZ(45°)`; rooms are rectangles on that plane; walls are 90°-folded strips.
- **Characters are billboarded sprites** — each character container carries the inverse rotation (`rotateZ(-45°) rotateX(-55°)`) so it stands upright facing the camera, the classic sprite-in-3D trick.
- **Only `transform`/`opacity` animate** — every animation (typing bob, chai-wala walk, camera zoom) runs on the GPU compositor with no layout/paint cost, holding 60fps even on low-end phones.
- **Camera** = one parent div's scale+translate with easing; clicking a room computes its projected position and centers it (exactly what `Office.tsx`'s `camStyle()` does today).
- **Responsive = scale-to-fit**, game-style — the whole scene scales as a unit (matches `Office.tsx`'s `scale` state).
- **State system**: each room has one state (working/idle/offline) driven in production by Socket.io events from the agent server; a state change is just a CSS class change (working = typing loop + monitor glow, idle = slow breathe + warm lamp, offline = dark room + sleeping character with Zzz) — this is exactly the `st: "w"|"i"|"o"` model already in `lib/store.tsx`'s `AgentState` type.
- **Delight layer**: the chai-wala walking on a timer between his stall and online agents' rooms, and the Boss AI cabin's glowing orb with speech bubbles surfacing orchestration events — both already implemented in the demo almost verbatim from spec.
- **Asset pipeline for production**: the coded layout/states/camera/routes are considered *final* — only the CSS-drawn shapes get replaced with real art. Layers must stay separate (room bases with no baked-in characters, character sprite sheets with 8–12 frame loops or Spine/DragonBones rigs, and effect overlays as their own layer) so states can switch independently. Sourcing: commission a layered illustration set (~$300–800, "cozy isometric night office" reference style) or AI-generate per-room art with manual cleanup, all WebP-compressed, total scene budget under ~1.5MB. Timing: Phase 1 ships with simple status cards; the full office UI is meant to land in Phase 2 once agents have genuine live states to visualize — meaning the current demo's Office.tsx is actually ahead of the spec's own suggested sequencing (it's already built and used from Phase-1-equivalent demo day one).
