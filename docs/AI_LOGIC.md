# AI LOGIC — Kaunsa AI kya karta hai (per feature)

Do-tier model strategy (Spec v3.0 §5): **Lightning** = sasta execution 90% kaam; **Frontier model** = sirf quality-critical writing.

| Feature | Model | Kyun / kaise |
|---|---|---|
| Boss AI orchestration (task routing, plans) | Nemotron 3.5 Lightning (NIM) | Tool-calling/routing = Lightning ka design goal; near-zero cost |
| Boss AI chat (dashboard + landing) | Lightning, streaming | `/api/chat` already streams; brain() ko NIM call se replace karo (route file mein exact TODO likha hai) |
| Topic scoring (Keyword Finder) | Lightning `generateJson` | Volume x difficulty x relevance scoring — classification-class task |
| Top-10 SERP competitor analysis | Lightning | Headings/gaps extraction = summarization/structure task |
| Blueprint generation | Lightning | Structured JSON output (titles, H2/H3, targets) |
| **Article writing** | **Frontier API (DeepSeek/Gemini/Claude, adapter)** | Ranking-quality long-form — Lightning yahan use NAHI karna (Spec finding #1) |
| Quality gate checks | Lightning + APIs | Keyword/length/links = validation; plagiarism = Copyscape API |
| Tone matching | Embeddings (pgvector) | Onboarding crawl ka tone profile vs draft similarity |
| Site crawl → niche map | Embedding model + pgvector | Onboarding "learning" — Build Guide Step 5 |
| Social captions, GBP posts | Lightning | Short-form platform copy |
| Comment/review triage | Lightning classify() | spam/question/complaint/praise |
| Daily report writing | Lightning | jobs_log → short summary (abhi template; prod mein Lightning summarize) |
| Lead scoring + reasons | Lightning `generateJson` | ICP-fit score + one-line reason per lead |
| Outreach first-touch personalization | Frontier API | Conversion-critical — writing tier |
| Chatbot widget (client sites) | Lightning RAG | pgvector retrieval + answer |
| Voice (Phase 4) | Google STT/TTS + Lightning | Speech in/out; Lightning interprets commands |

**Env vars:** `NVIDIA_API_KEY` (Lightning), `WRITER_PROVIDER` + provider key (writing), embeddings provider key. Sab adapters `lib/ai/` pattern pe — model swap = env change.
