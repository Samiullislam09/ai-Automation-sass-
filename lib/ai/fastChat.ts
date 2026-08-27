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
 *  configured", because that is true today: §18.4b's own measurement found Cerebras returning
 *  402 (no free quota on the account that tested it), and nobody has a Groq key yet either.
 *  So every export here is inert until GROQ_API_KEY (or another provider below) is set —
 *  docs/MANUAL_STEPS.md has the "get a free key" step. Until then, chat behaves exactly as it
 *  does today: NIM, unchanged, in `lib/chat-model.ts`.
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

export type FastProvider = {
  id: string;
  baseUrl: string;
  apiKeyEnv: string;
  /** Model catalogues on free tiers change monthly (the plan's own words: "NIM ne kal 2
   *  models hataye, kal aur hata sakta hai") — override with the matching env var below
   *  rather than editing this file when a provider retires one. */
  modelEnv: string;
  defaultModel: string;
};

/** Cerebras is listed second, not first, on purpose: §18.4b measured the account that tested
 *  this plan getting HTTP 402 (no free quota) from Cerebras on 2026-08-27. It may work on a
 *  different account or once billing is sorted — the code supports it — but Groq is the one
 *  with a reported-working free tier (§18.3: ~1k req/day, 30 RPM, no card), so it tries first. */
export const FAST_PROVIDERS: FastProvider[] = [
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_CHAT_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    id: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    apiKeyEnv: "CEREBRAS_API_KEY",
    modelEnv: "CEREBRAS_CHAT_MODEL",
    defaultModel: "llama-3.3-70b",
  },
];

function configured(p: FastProvider): { key: string; model: string } | null {
  const key = process.env[p.apiKeyEnv];
  if (!key) return null;
  return { key, model: process.env[p.modelEnv] || p.defaultModel };
}

/** Which providers have a key set, in try-order. Exported so a status page or a log line can
 *  say plainly "chat is running on Groq today" instead of the guess being invisible. */
export function activeFastProviders(): string[] {
  return FAST_PROVIDERS.filter((p) => configured(p)).map((p) => p.id);
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
    const c = configured(p);
    if (!c) continue;

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
        }),
        signal: opts.signal,
      });

      if (res.ok && res.body) return { stream: res.body, provider: p.id, model: c.model };

      // A non-2xx here is the provider's own answer (rate limit, bad model id, billing) — log
      // it so a wrong GROQ_CHAT_MODEL is diagnosable, but never let it reach the customer:
      // the next provider (or NIM) gets the request instead.
      console.warn(`[fastChat] ${p.id} refused (${res.status}) — falling through`, (await res.text().catch(() => "")).slice(0, 200));
    } catch (e: any) {
      console.warn(`[fastChat] ${p.id} unreachable — falling through:`, e?.message);
    }
  }

  return null;
}
