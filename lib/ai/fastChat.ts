/** The chat's first-word problem, and the plan's own answer to it (MASTER_PLAN §18.2, §18.4).
 *
 *  §18.1 measured the free NIM endpoint on the exact model this chat uses: the same request,
 *  same code, same message, answered in anywhere from 0.5s to 19s — because it is a shared
 *  free queue, and the queue's load is not this code's to control. §18.2's five fixes are
 *  ranked cheapest-to-priciest; the do-channel UI and function-calling (items 3 and 4) are
 *  done elsewhere (the brain, and the instant system card). This file is item 1: "provider
 *  badlo sirf chat ke liye" — Cerebras or Groq, dedicated inference hardware, TTFB ~200-400ms,
 *  instead of NIM's shared queue, for the one call the user actually watches scroll past.
 *
 *  WHY THIS IS SEPARATE FROM lib/chat-model.ts. That file answers "which model" on NIM,
 *  measured against NIM's own catalogue. This file answers "which provider, before NIM at
 *  all" — and it is written to cost nothing and change nothing when the answer is "none
 *  configured". §18.4b's own measurement found Cerebras returning 402 (no free quota on the
 *  account that tested it) — still true as of 2026-08-28 (re-checked with a live key). Until a
 *  provider is configured, chat behaves exactly as it does today: NIM, unchanged, in
 *  `lib/chat-model.ts`.
 *
 *  BOTH PROVIDERS' OLD DEFAULT MODELS WERE RETIRED. This file originally defaulted to
 *  `llama-3.3-70b-versatile` (Groq) and `llama-3.3-70b` (Cerebras) per §18.3's measurement —
 *  both now 404 "model not found" (checked live 2026-08-28). Groq's chat catalogue today is
 *  `openai/gpt-oss-120b`/`-20b`, Qwen 3, and their own `compound` models — no Llama chat model
 *  remains. Both providers now default to gpt-oss-120b (Groq: `openai/gpt-oss-120b`, Cerebras:
 *  `gpt-oss-120b` — no prefix, different naming convention on the same model), which happens to
 *  MATCH `lib/chat-model.ts`'s own NIM primary — one fewer thing to reason about when NIM and a
 *  fast provider disagree on tone. Reuses `modelParams()` from chat-model.ts for the same reason
 *  it exists there: gpt-oss without `reasoning_effort:"low"` spends the completion budget on
 *  hidden reasoning tokens and returns an EMPTY content string at low max_tokens (reproduced
 *  live against Groq 2026-08-28) — Nemotron's `thinking:false` switch would apply the same way
 *  if a provider ever serves it. A model overridden via `*_CHAT_MODEL` still gets whichever
 *  params match ITS name, not the default's — the regex looks at the model actually being sent.
 *
 *  WHY SEQUENTIAL, NOT HEDGED. §18.2 item 2 (send to two providers, take whichever answers
 *  first, abort the loser) is the next upgrade once TWO fast providers are actually
 *  configured and the extra ~1.3x token cost is worth paying for a p95 win. With at most one
 *  fast provider realistically set today, hedging has nothing to hedge against — this tries
 *  the fast provider, and falls straight through to NIM on any failure (network error,
 *  non-2xx, or simply not configured). One extra `fetch` in the failure case, never two in
 *  the success case.
 *
 *  FORMAT COMPATIBILITY IS THE WHOLE POINT. Groq, Cerebras and NIM all speak the same
 *  OpenAI-style `POST /chat/completions`, the same SSE `data: {choices:[{delta:{content}}]}`
 *  framing, and the same tool-calling shape. `app/api/chat/route.ts`'s `relay()` already
 *  parses exactly that framing and needs zero changes — the plan's own line 18.5: "aaj ka
 *  code OpenAI-compatible hai — 10 line ka badlaav".
 */

import { modelParams } from "@/lib/chat-model";

export type FastProvider = {
  id: string;
  baseUrl: string;
  /** The FIRST key env var. A second, third, ... account's key on the SAME provider is read
   *  from `${apiKeyEnv}_2`, `_3`, ... (see keyEnvsFor) — for the day one free-tier account's
   *  daily/per-minute cap runs out before the other configured providers even get a turn. This
   *  is a second account on the SAME service, not a different provider: it does nothing for a
   *  Groq outage (every key on Groq fails alike), only for a Groq QUOTA running out — an
   *  outage is what the next PROVIDER (Cerebras, then NIM) in FAST_PROVIDERS is for. */
  apiKeyEnv: string;
  /** Model catalogues on free tiers change monthly (the plan's own words: "NIM ne kal 2
   *  models hataye, kal aur hata sakta hai") — override with the matching env var below
   *  rather than editing this file when a provider retires one. Shared by every key on this
   *  provider: two accounts on the same service run the same model. */
  modelEnv: string;
  defaultModel: string;
};

/** How many numbered keys (`_2`, `_3`, ...) are checked per provider before giving up on it.
 *  A cap, not a promise anyone needs that many — reading five unset env vars costs nothing, and
 *  a fixed number here means adding a third key later is a docs/MANUAL_STEPS.md + env var
 *  change, never a code change. */
const MAX_KEYS_PER_PROVIDER = 5;

/** Cerebras is listed second, not first, on purpose: §18.4b measured the account that tested
 *  this plan getting HTTP 402 (no free quota) from Cerebras — re-checked live 2026-08-28,
 *  still 402. It may work on a different account or once billing is sorted — the code supports
 *  it — but Groq is the one with a reported-working free tier (§18.3: ~1k req/day, 30 RPM, no
 *  card), so it tries first. */
export const FAST_PROVIDERS: FastProvider[] = [
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_CHAT_MODEL",
    defaultModel: "openai/gpt-oss-120b",
  },
  {
    id: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    apiKeyEnv: "CEREBRAS_API_KEY",
    modelEnv: "CEREBRAS_CHAT_MODEL",
    defaultModel: "gpt-oss-120b",
  },
];

/** `apiKeyEnv`, `apiKeyEnv_2`, `apiKeyEnv_3`, ... up to MAX_KEYS_PER_PROVIDER — see the field
 *  comment on FastProvider for why a provider can have more than one. */
function keyEnvsFor(p: FastProvider): string[] {
  const envs = [p.apiKeyEnv];
  for (let i = 2; i <= MAX_KEYS_PER_PROVIDER; i++) envs.push(`${p.apiKeyEnv}_${i}`);
  return envs;
}

/** Every account configured for this provider, in try-order, each with the one model this
 *  provider uses (env override or default — same for every key, since it is the same service). */
function configuredKeys(p: FastProvider): { key: string; model: string; envVar: string }[] {
  const model = process.env[p.modelEnv] || p.defaultModel;
  return keyEnvsFor(p)
    .map((envVar) => ({ envVar, key: process.env[envVar] }))
    .filter((x): x is { envVar: string; key: string } => !!x.key)
    .map((x) => ({ ...x, model }));
}

/** Which providers have at least one key set, in try-order. Exported so a status page or a log
 *  line can say plainly "chat is running on Groq today" instead of the guess being invisible. */
export function activeFastProviders(): string[] {
  return FAST_PROVIDERS.filter((p) => configuredKeys(p).length > 0).map((p) => p.id);
}

export type FastChatResult = { stream: ReadableStream<Uint8Array>; provider: string; model: string };

/** Tries each configured fast provider in order; returns null (never throws) when none is
 *  configured or all of them failed before a single byte came back — the caller's job is to
 *  fall back to NIM in that case, exactly as it does today.
 *
 *  `fetchImpl` is injectable so this is testable without a real key (see fastChat.test.ts) —
 *  the same pattern as lib/leads/sources.ts's `fetchImpl`. */
export async function openFastChatStream(
  messages: unknown[],
  opts: { temperature?: number; max_tokens?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<FastChatResult | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  for (const p of FAST_PROVIDERS) {
    // Every configured key on THIS provider first — a second Groq account is only worth having
    // if it is tried before falling all the way through to Cerebras or NIM, which are slower
    // (Cerebras) or much slower under load (NIM, §18.1). Only once every key on this provider
    // is exhausted does the next provider get a turn.
    for (const c of configuredKeys(p)) {
      try {
        const res = await fetchImpl(p.baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
          body: JSON.stringify({
            model: c.model,
            stream: true,
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.max_tokens ?? 260,
            messages,
            // gpt-oss without this returns an EMPTY content string at low max_tokens — the
            // model spends the budget on hidden reasoning instead (see the file header).
            ...modelParams(c.model),
          }),
          signal: opts.signal,
        });

        if (res.ok && res.body) return { stream: res.body, provider: p.id, model: c.model };

        // A non-2xx here is the provider's own answer (rate limit, bad model id, billing) — log
        // it, with WHICH key so a rate-limited first key vs. a genuinely misconfigured second one
        // are distinguishable, but never let it reach the customer: the next key (or provider,
        // or NIM) gets the request instead.
        console.warn(
          `[fastChat] ${p.id} (${c.envVar}) refused (${res.status}) — falling through`,
          (await res.text().catch(() => "")).slice(0, 200)
        );
      } catch (e: any) {
        console.warn(`[fastChat] ${p.id} (${c.envVar}) unreachable — falling through:`, e?.message);
      }
    }
  }

  return null;
}
