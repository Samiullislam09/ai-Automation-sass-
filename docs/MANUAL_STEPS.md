# Manual steps — jo sirf aap kar sakte hain

Main (Claude) code likh sakta hoon, test chala sakta hoon, commit/push kar sakta hoon.
Ye neeche wale kaam **sirf aap** kar sakte ho: inme password/secret dalna hota hai, ya kisi
service ke dashboard me login chahiye, ya paisa/legal decision hai.

**Padhne ka tarika:** upar wale sabse zaroori. Har item me: *kyun chahiye*, *kahan*, *kya karna*.
Jo ho jaye uske aage `[x]` laga dena.

---

## 🔴 Abhi ke abhi (inke bina naya code live nahi hoga)

### 1. Migration 018 + 019 chalao — [ ]
**Kyun:** eval set (`intent_eval`) aur Site Brain (`site_profiles`, duplicate locks) ke tables.
Inke bina `/app/eval` page aur naya keyword/writer flow DB error dega.
**Kahan:** Supabase → aapka project → **SQL Editor** → New query.
**Kya:** repo se ye files kholo aur poora content paste karke **Run**, ek-ek karke, isi order me:
1. `supabase/migrations/018_intent_eval.sql`
2. `supabase/migrations/019_site_brain.sql` *(jab main ise bana dunga — is file me neeche "Status" section dekho)*

Dono idempotent hain — galti se dobara chala do to kuch nahi bigdega.

### 2. Encryption key rotate karo — [ ]
**Kyun:** purani `CREDENTIALS_ENCRYPTION_KEY` chat me paste hui thi = leaked. Wo key har customer
ka WordPress password kholti hai.
**Kahan:** apne computer pe terminal, repo folder me.
**Kya:** `scripts/rotate-credentials-key.mjs` file kholo — sabse upar comment me 6 step likhe hain,
wahi follow karo (naya key banao → dry run → `--apply` → Vercel + Railway pe naya key → `--verify`).

### 3. Supabase DB password reset karo — [ ]
**Kyun:** wo bhi chat me aa gaya tha.
**Kahan:** Supabase → Settings → Database → **Reset database password**.
**Uske baad:** GitHub → repo → Settings → Secrets → `SUPABASE_DB_URL` → pencil ✏️ → **Session pooler**
wali nayi string (naye password ke saath) → Update. Phir Actions → db-backup → Run workflow (green aana chahiye).
Vercel/Railway pe kuch nahi badalta (wo API keys use karte hain, DB password nahi).

### 4. Railway ka deploy check karo (naya code atka hua hai) — [ ]
**Kyun:** live agent-server abhi commit `ec5d154` chala raha hai, par naya keyword code `e4036b3`
me hai. Maine local pe build chala kar dekh liya — **build bilkul theek hai**, matlab Railway ne
deploy uthaya hi nahi (webhook miss, ya deploy fail/queued).
**Kahan:** Railway → project → agent-server service → **Deployments** tab.
**Kya:** sabse upar wale deploy ka status dekho.
- "Success" par purana commit → sabse upar **⋮ → Redeploy** (ya Settings → GitHub → repo dobara connect).
- "Failed" → log ka aakhri 20 line mujhe bhej dena, main theek kar dunga.
- Deploy ke baad ye chala kar confirm karna: browser me `https://<aapka-railway-url>/version` —
  usme `"commit"` naya hona chahiye.

**Note:** Railway pe `23 days or $4.42 left` dikh raha tha — credit khatam hone se pehle top-up ya
free plan ka intezaam dekh lena, warna agent-server band ho jayega.

### 5. Railway se DataForSEO ke variables hata do — [ ]
**Kyun:** account unverified hai (`40104`), har keyword run me ~2s waste hota hai. Ab code me ye
provider **optional** hai — na ho to seedha free chain (Search Console → Google Autocomplete → AI) chalti hai.
**Kahan:** Railway → agent-server service → Variables → `DATAFORSEO_LOGIN` aur `DATAFORSEO_PASSWORD` → ⋮ → Delete.
**Baad me:** koi client paid account de to yahi do variables wapas daal dena — code apne aap unhe use karne lagega.

---

## 🟡 Is hafte (kaam chal jaayega, par ye pending rahega)

### 6. `THIRD_PARTY_LICENSES.md` ke 3 TODO bharo — [ ]
**Kyun:** kaymen99 (Mr. Lead ka skeleton) ki permission ka proof file me hona chahiye — 10 saal baad
koi poochhe to jawab ready ho.
**Kahan:** repo root → `THIRD_PARTY_LICENSES.md`, pehla section.
**Kya:** teen line: **Proof** (author ka message ka link/screenshot + date), **Scope granted**
(kya karne ki ijazat mili), **Attribution required** (haan/nahi + exact wording).

### 7. Eval set review karo (10 minute) — [ ]
**Kyun:** naya "dimaag" (intent engine) isi set pe pass hoga tabhi deploy hoga. AI ne label laga
diye hain; aapko sirf haan/na karna hai.
**Kahan:** app me **Eval** page (`/app/eval`).
**Kya:** har message pe label sahi ho to `A` (Accept), galat ho to theek karke Save, samajh na aaye to `K` (Skip).
Migration 018 lagne ke baad main labels bhar dunga — phir ye page bhar jayega.

---

## 🟢 Baad me (Phase ke hisaab se)

### 8. Google Search Console + Analytics connect — [ ]
**Kyun:** "quick wins" (position 8-20 wale keywords) aur article ke baad ka result isi se aata hai.
**Kahan:** app → Connect page → Google.

### 9. WordPress connect (agar site WordPress pe hai) — [ ]
**Kyun:** publish, aur chatbot ka 1-click install.

### 10. npm account (contract package publish ke liye) — [ ]
**Kyun:** har agent apne repo me hoga; sabko `@mrlxwa/agent-contract` chahiye. Railway sirf
`agent-server/` folder build karta hai, isliye local `file:../packages/...` wahan kaam nahi karega.
**Kya:** npmjs.com pe free account → organization/scope `@mrlxwa` → mujhe batana, main publish command
ready kar dunga (`npm publish --access public`). Tab tak code chalta rahega (in-process adapter se).

### 11. Meta (Facebook) App Review — Phase 3 se pehle — [ ]
**Kyun:** social posting ke liye Meta ka review hafton leta hai; line lambi hai to jaldi lagana behtar.

---

## Status — main kya kar chuka hoon

Ye section main update karta rahunga (aakhri update sabse upar).

| Date | Kya hua |
|---|---|
| 2026-08-27 raat | **Phase 1 ka core ban gaya.** Brain zinda hai: registry (9 agents, boot pe hi galat setup mana kar deta hai), planner (code, LLM nahi — target se peeche chalta hai), orchestrator (parallel join, retry 1/4/16, crash ke baad resume, double-click = ek task), live event channel, aur 6 HTTP routes. Site Brain (migration 019 + Mr. Analyst + duplicate lock) bhi. Mr. Publish ab asli hai — publish karke page ko fetch karke check bhi karta hai. **Test count: 68 brain + 26 site brain + 29 contract + 14 chat-events + 85 purane.** |
| 2026-08-27 | Phase 0 poora: contract package + echo agent round-trip, eval set, do-channel UI, free keyword chain. |
