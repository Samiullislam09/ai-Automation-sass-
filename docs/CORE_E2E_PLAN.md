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
