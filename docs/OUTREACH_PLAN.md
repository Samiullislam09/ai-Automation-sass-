# Mr. Lead + Mr. WhatsApp + CRM — the plan

A plain-language map of the whole flow, so a non-technical person can follow it, and a build
checklist under it. Written 2026-09-30.

## The flow, in one picture

```
   NEW CLIENT (wca-global, triptravelingguide, koi bhi)
        │  sirf website deta hai
        ▼
   ┌─────────────────────────────────────────────────────┐
   │  Mr. Lead  — roz apne aap chalta hai (schedule)     │
   │  · website padhke samajhta hai: kya bechte ho,      │
   │    kisko bechte ho (ICP)                            │
   │  · leads dhundta hai (OpenStreetMap aaj, aur source │
   │    baad me), phone/website ke saath                 │
   │  · har lead ko score deta hai + ek line wajah       │
   │  · kachra (score kam) andar aata hi nahi            │
   └─────────────────────────────────────────────────────┘
        │  achhe leads → CRM me "APPROVAL ka intezaar"
        ▼
   ┌─────────────────────────────────────────────────────┐
   │  CRM (leads table) — WhatsApp jaisa board           │
   │  har lead ek card: naam, phone, score, kahan se     │
   │  mila (evidence link), abhi kis stage pe hai        │
   └─────────────────────────────────────────────────────┘
        │  TUM (ya client) har lead APPROVE/REJECT karte ho
        ▼  ── sirf approved lead aage jaate hain ──
   ┌─────────────────────────────────────────────────────┐
   │  Mr. WhatsApp — TUMHARA apna WhatsApp, QR se juda   │
   │  (bilkul WhatsApp Web jaisa)                        │
   │                                                     │
   │  · approved lead ka message DRAFT karta hai         │
   │  · CRM me WhatsApp jaisa chat khulta hai            │
   │  · TUM padhte ho, chahe to badalte ho, SEND dabate  │
   │    ho — message TAB jaata hai, khud nahi            │
   │  · lead reply kare → chat me aata hai               │
   │  · reply ka jawab Mr. Brain DRAFT karta hai, phir   │
   │    bhi tum hi SEND dabate ho                        │
   └─────────────────────────────────────────────────────┘
        │  har cheez record hoti hai
        ▼
   ┌─────────────────────────────────────────────────────┐
   │  Mr. Lxwa (chat) — sab pata hai                     │
   │  "kitne leads aaye? kisko msg gaya? kaun reply       │
   │   diya? kitne convert hue?" — chat se poocho         │
   └─────────────────────────────────────────────────────┘
```

## The one rule that keeps a number safe

**Message TAB hi jaata hai jab ek insaan SEND dabata hai.** Koi robot apne aap message nahi
bhejta. Ye sirf ek achhi aadat nahi — code me pakka hai: bhejne ka rasta (`POST /whatsapp/send`)
sirf ek logged-in insaan ke click se chalta hai, aur kahin koi background worker nahi hai jo
queue se uthake timer pe bheje. Isi liye number ban nahi hota: WhatsApp ki nazar me ye ek insaan
apne phone se baat kar raha hai, jo hai bhi.

Mr. Brain reply DRAFT karta hai (taaki tumhe likhna na pade), par bhejta insaan hi hai.

## What each thing is

| Naam | Ye kya hai | Kahan chalta hai |
|---|---|---|
| **Mr. Lead** | leads dhundne wala agent | agent-server (bana hua) |
| **Mr. WhatsApp** | tumhara WhatsApp yahan se chalane wala | agent-server (Baileys) |
| **CRM** | leads ka table + board | Supabase `leads` + dashboard |
| **Baileys** | wo library jo tumhare WhatsApp se jodti hai | `@whiskeysockets/baileys` |
| **Twenty CRM** | ek alag, poora CRM app | abhi nahi chal sakta — neeche |

## Twenty CRM ke baare me ek seedhi baat

Twenty ek behtareen CRM hai aur plan me hai. Par wo ek alag app hai jise **~2 GB RAM** ka apna
server chahiye, aur abhi hamare paas wo server nahi hai (Railway ka trial khatam ho raha, Oracle
abhi aaya nahi). Isliye:

- **Abhi:** CRM ka asli data hamare apne `leads` table me rahega (jo ban chuka hai). Poora board,
  approve/reject, WhatsApp chat — sab isi pe chalega.
- **Oracle aane ke baad:** Twenty ko wahan chalayenge aur apna data uspe **mirror** kar denge, uske
  saare features (deal pipeline, views) ke saath. Kuch khoyega nahi — hamara table source of
  truth rahega, Twenty uska sundar chehra.

Ye Twenty ko chhodne wali baat nahi hai — ye "pehle wo cheez jo aaj chal sakti hai" wali baat hai.

## Build checklist (tick as they land)

- [x] **A** — CRM tables + approval gate + settings + leads-schedule (migration 028, commit b7c9604)
- [x] **B** — `lookup_outreach` chat tool (commit d2d9fd1)
- [ ] **C** — Baileys session: QR pair tumhara WhatsApp, session save, reconnect
- [ ] **D** — receive: incoming message → CRM me store → lead se jodo (phone se)
- [ ] **E** — send (MANUAL): `POST /whatsapp/send`, sirf human click se; status sent→delivered→read
- [ ] **F** — Mr. WhatsApp agent: approved lead ka pehla message DRAFT (bhejta nahi)
- [ ] **G** — Mr. Brain reply draft on incoming (bhejta nahi — human sends)
- [ ] **H** — Dashboard: WhatsApp-jaisa chat UI + QR connect screen + CRM board + approve buttons
- [ ] **I** — settings UI: Mr. Lead / Mr. WhatsApp enable + caps
- [ ] **J** — Twenty CRM sync adapter (Oracle ke baad activate)

## What I cannot verify from here (you test it)

Baileys ek asli phone se QR scan maangta hai aur ek zinda WhatsApp connection banata hai. Main
code likh sakta hoon, tests likh sakta hoon, par **QR scan karke asli message bhejna tumhe hi
karna hoga** — wo cheez sirf tumhare phone se hoti hai. Jab UI ready ho, tum scan karke ek test
message bhejoge, aur tab pata chalega end-to-end chal raha hai.
