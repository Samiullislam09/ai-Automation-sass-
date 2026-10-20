# MrLxwa — Core Features: End-to-End Verification Plan & Status

**Date:** 2026-10-17 · **Rule:** CORE-FIRST FREEZE — koi UI/UX ya naya feature tab tak nahi jab tak ye core features **live, end-to-end 100%** na ho jaayein. "Tests pass" ≠ "works live." Verify sirf asli tenant (heysamiul09 / wca-global.com) pe.

---

## 0. Foundation blockers (ye pehle — warna kuch bhi nahi dikhega)
| Check | Kaise | Pass criteria |
|---|---|---|
| **NVIDIA (LLM) reachable** | agent-server se ek chhota completion; Railway logs me NVIDIA error dekho | Ek LLM call text return kare (abhi "could not reach the provider" aa raha = FAIL) |
| **agent-server latest code** | `<AGENT_SERVER_URL>/version` ya Railway last-deploy commit | Latest commit (aaj ka) dikhe, purana nahi |
| **Migrations 031–037 applied** | Supabase pe tables maujood (`wa_outbound_queue`, `lead_meetings`, `whatsapp_admins`…) | Saari tables + naye stages exist |

**Jab tak ye teeno green nahi, baaki kuch test karna bekaar hai.**

---

## 1. Article → Publish (content engine) — THE core loop
**E2E test:** Chat se "write an article about <topic> and publish" → topic → keyword → writer → SEO → image → **quality gate** → WordPress pe live.
**Pass:** Real article gate **pass** kare aur wca-global.com pe live dikhe, ≥2 images + sahi SEO fields. **Measure:** 5 article chala ke gino — kitne gate pass, kitne fail, aur FAIL ka exact reason (jobs_log se).
**Known issue:** gate deterministic/strict hai; real model output pe tune nahi hua. NVIDIA down = abhi 0 chalega.
**Needs:** NVIDIA up + gate ko real output pe calibrate.

## 2. High-quality images
**E2E test:** article ke images professional + relevant lagein.
**Pass bar:** owner "acceptable" bole.
**Reality:** free Cloudflare flux hi hai (quality ceiling). **High quality = paid image model (budget decision).** Ye code bug nahi.
**Needs:** 💰 **budget faisla** (paid image model) — iske bina ye item close nahi ho sakta.

## 3. WhatsApp-reachable buyer leads
**E2E test:** lead gen chalao → leads (a) sahi buyers hon, (b) **WhatsApp mobile** hon (onWhatsApp = true).
**Pass:** generated leads me se **≥ X% WhatsApp pe** (abhi Google Maps se zyada tar landline → bahut kam). **Measure:** 1 run ke baad % nikaalo.
**Reality:** Google Maps businesses = mostly landline. WhatsApp-first product ke liye source galat hai.
**Needs:** 🔀 **behtar lead source faisla** (mobile/WhatsApp-reachable numbers dene wala) — iske bina ye item close nahi ho sakta.

## 4. WhatsApp auto engine (P1–P9, naya)
**E2E test (asli number se):**
1. Auto-replies ON → inbound pe delayed smart reply.
2. Approved WhatsApp lead → **Timeline** pe slot dikhe → apne time pe cold message jaaye.
3. "meeting chahiye" → Google slots / Calendly link.
4. "invoice bhejo" → lead auto **Client** + hot alert.
5. Human khud reply kare → us chat pe AI pause.
**Pass:** har step aankhon ke saamne live ho.
**Needs:** redeploy + NVIDIA + ek WhatsApp-reachable test lead (point 3 se juda).

## 5. Scheduling (user apni service schedule kare)
**E2E test:** Schedule page → "roz 9am article" (ya audit/leads) set → us waqt **khud fire** ho → output bane.
**Pass:** ek scheduled run asli tenant pe fire + complete ho.
**Known issue:** aadha wired, reliably nahi chalta — jad find karni hai (scheduler tick + enqueue + agent).

---

## Order of execution (strict)
**0 (blockers) → 1 (article) → 4 (WhatsApp) → 5 (schedule) → 2 & 3 (budget + source faisle ke baad).**
Har item pe: asli tenant pe test → fail ka exact reason (evidence) → fix → dobara test → tabhi ✅.

## 2 faisle jo owner ko dene hain (core inke bina adhoora rahega)
1. **💰 Paid LLM + image model ka budget?** (free tier pe article reliability + "high quality image" nahi aayega)
2. **🔀 WhatsApp-reachable lead source?** (Google Maps landlines se WhatsApp outreach nahi chalega)

## Status log (yahan har verify ke baad likhenge)
- 2026-10-17: Plan banaya. Foundation blocker: **NVIDIA "could not reach the provider"** (article fail) + Railway redeploy confirm pending. Pehla kaam: 0 ko green karna.
- 2026-10-17: **Root cause mila (live test, local NVIDIA key se):** key + network theek hain. Configured model `nvidia/nemotron-3-ultra-550b-a55b` **persistent HTTP 503 "Service temporarily overloaded"** (3/3) — isiliye sab LLM fail. Serving models test: `nemotron-3-super-120b-a12b` ✅ 200, `nemotron-3.5-super-vl-120b-a12b` ✅ 200, nano-3 ❌ 404. **Fix shipped:** har jagah model default ultra-550b → **super-120b**, aur agent-server + web ab **env-driven** (`NVIDIA_MODEL` / `CHAT_MODEL`) taaki agli baar model swap sirf Railway variable ho, code nahi. Files: agent-server llm.ts (naya `AGENT_MODEL` export) + writerPipeline.ts; web chat-model.ts (primary→super-120b, fallback→3.5-super-vl), lib/ai/llm.ts, content/revise route, nvidia-chat/server.js. Tests: agent 716/716, web chat 20/20, dono tsc clean. **PENDING: Railway redeploy** (purana code env ignore karta hai; naye code ke baad hi super-120b chalega) + Vercel auto. Uske baad item 1 (article E2E) test.
- 2026-10-20: **Big progress day (all committed up to `5ec1bb4`; agent-server ones PENDING Railway deploy — billing paused).**
  - **Foundation (0):** NVIDIA model availability is **per-account** — Railway account 404'd super-120b. Added a **per-account model fallback** (`lib/llm.ts completeJson`: tries a candidate list, caches the first that answers, logs `[llm] using model:`). Clean error mapping for the 404/"no candidate" case (no raw JSON on the dashboard). A run with a failed step no longer shows "Done".
  - **#1 Writer slow + gate stuck:** writer now resolves the **strongest available** model best-first (340b → 253b → super-120b → ultra; `WRITER_MODEL` env; logs `[writer] using model:`); **review loop runs on a FAST model** (`nimCompleteFast`, logs `[review] using model:`) since its rewrites are tiny tasks; **REVIEW_MAX_ROUNDS 5→3** (env `REVIEW_MAX_ROUNDS`). Quality bar 40-58 words UNCHANGED. **True "premium" prose/quality still needs a stronger model = budget.**
  - **#3 Images:** stopped gibberish — prompt forbids document/certificate/stamp/chart/screen subjects (flux renders text as gibberish); thumbnail directed as premium magazine-cover hero. **True premium-HD = paid image model (budget);** free flux-1-schnell is the ceiling.
  - **#5 / chat:** per-step chat narration spam removed (was wrong + cost an LLM call each); keyword screen no longer bleeds "No keywords produced" onto every agent panel; keyword shows full (no 2-line clamp).
  - **#2 (web/Vercel, LIVE):** image preview no longer blinks on chat keystroke (`useFollowLatest` stable ref callback). **#4** writer panel no longer retypes on every open.
  - **Cost:** Supabase Log Ingestion throttle (WhatsApp scheduler ticks slowed; WhatsApp polls pause on hidden tab).
  - **BLOCKER:** **Railway deploys paused (trial credit ~$3.92 left)** → none of the agent-server fixes are live yet. Owner must add Railway billing, then ONE redeploy brings it all live. Web fixes already live on Vercel.
  - **2 owner decisions still open:** 💰 paid LLM + image model budget; 🔀 WhatsApp-reachable lead source.
