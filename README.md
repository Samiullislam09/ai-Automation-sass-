# GrowthTeam AI — Next.js Frontend (production reference)

## Chalane ke liye
```bash
npm install
npm run dev      # http://localhost:3000
```
Build verified: `npm run build` — 17 routes, 0 errors.

## Kya READY hai (is repo mein)
- Landing (SEO: metadata, OG, JSON-LD FAQ+SoftwareApp, sitemap.ts, robots.ts, comparison table, FAQ)
- Auth pages (UI) · 5-click onboarding → learning animation → Who-am-I
- Dashboard: **animated isometric office** (live agent states, lights-off offline, chai-wala, click-zoom) + stats + create panel + agent-to-agent activity feed
- Full token/paywall/checkout/plan logic (Free 10 ⚡ / $5 = 120 ⚡ / $15 = 400 ⚡)
- Article pipeline modal (5 stages) · Approvals (approve/reject wired) · Daily Reports (auto, unread, detail)
- Memory (edit/add/delete) · Billing · Help system (? → tooltip → detail pages)
- **Boss AI chat: REAL streaming** via /api/chat (word-by-word, markdown) — NIM swap = one function

## Kya PENDING hai (Build Guide follow karo)
Har jagah code mein `TODO(backend)` marker hai: Supabase auth+DB (localStorage replace), real crawl+embeddings, agent-server+Socket.io (timers replace), NIM in /api/chat, Paddle/LemonSqueezy, editor, push/PWA.

## Docs
- `docs/AI_LOGIC.md` — kaunsa model kya karta hai, per feature
- `docs/COMPETITOR_ANALYSIS.md` — top 5 + hamari edge

## Claude Code ke liye pehla prompt
"Read README.md, docs/, and the TODO(backend) markers. Start Build Guide Step 2: create the Supabase schema and replace the localStorage persistence in lib/store.tsx with Supabase — keep every component's props/behavior identical."
