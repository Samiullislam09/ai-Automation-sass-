/** Which model answers the chat, and what each one needs to be told.
 *
 *  MEASURED, 2026-08-27, on the same free NIM key (scratchpad/tools-nim.js, ttfb-nim.js):
 *
 *      message                              gpt-oss-120b      nemotron-3.5-lightning
 *      "isko publish mat karna"             no tool  503ms    write_article  7467ms   <- the live bug
 *      7 Hinglish orders, 3 tools           7/7  avg 743ms    6/7  avg 2221ms
 *      first streamed token ("hello")       ~600ms            1.8s - 19s
 *
 *  So the chat runs on gpt-oss-120b and falls back to Nemotron only if that call fails to
 *  open. The writer is NOT switched here — it is judged on quality, not first-token latency,
 *  and that comparison is a Phase 2 test (plan §18.4b), not a guess.
 *
 *  Each model has its own "don't think out loud" switch, and sending the wrong one is worse
 *  than sending none: gpt-oss without reasoning_effort:"low" spends the whole max_tokens on
 *  reasoning and returns an EMPTY content string (seen in ttfb-nim.js #1 and #3). Nemotron
 *  without chat_template_kwargs.thinking:false streams its scratchpad as the answer.
 */

export const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/** MEASURED AGAIN, 2026-09-18, and the brain moved as a result.
 *
 *  The 2026-08-27 table above chose gpt-oss-120b on first-token latency, and it won that on the
 *  numbers. What the table did not measure is whether the answers were RIGHT, and 148 real chat
 *  turns later the answer was no:
 *
 *      test                                 gpt-oss-120b (old)      nemotron-3-ultra (new)
 *      "isko publish mat karna"             called write_article    NO tool + "publish nahi karunga"
 *      "kitne agent hain" asked 5x          5 different answers     5/5 identical
 *      half-an-egg riddle (answer 4.5)      "9 ande"                "4.5 ande" + correct working
 *      streamed first chunk                 ~600ms                  855ms
 *
 *  The negation row is the one that decided it: reading "do not publish this" as an order to
 *  publish is the most expensive mistake this product can make, and it is the exact bug
 *  lib/chat-conversation.ts's header describes having had to fix by hand in the matcher. A model
 *  that gets it right natively is worth 255ms.
 *
 *  550B total, 55B active (MoE) — which is why it is not slower than the 120B it replaces.
 *  Streamed first chunk, four messages in a row: 621ms, 944ms, 617ms, 1232ms.
 *
 *  **`openai/gpt-oss-120b` IS DEAD ON NIM AND CANNOT BE THE FALLBACK.** Every call to it returns
 *  HTTP 410: "has reached its end of life on 2026-09-03T08:00:00Z and is no longer available."
 *  It is still listed by GET /v1/models, so the catalogue does not tell you — only a real call
 *  does. That end-of-life date is almost certainly the "I'm having trouble reaching my brain"
 *  replies that make up 11% of this product's entire chat history, all of them after 2026-09-03:
 *  the NIM path had been answering 410 for two weeks, and only lib/ai/fastChat.ts's Groq route
 *  (a different provider, unaffected) kept the chat working at all. Never restore this model
 *  here without calling it first.
 *
 *  The fallback is therefore nemotron-3-super-120b-a12b, which is alive and measurably faster to
 *  first chunk. It is NOT as good: asked "isko publish mat karna" it calls write_article, which
 *  ultra correctly refuses to do. That is acceptable for a fallback, because it is only reached
 *  when ultra cannot open a stream at all, and `wantsAutoPublish` in lib/chat-intent.ts is the
 *  code-side guard that stops a publish regardless of what any model decides. */
export const CHAT_MODEL = process.env.CHAT_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";
export const CHAT_FALLBACK_MODEL = process.env.CHAT_FALLBACK_MODEL || "nvidia/nemotron-3-super-120b-a12b";

/** The per-model request fields that keep the answer short and the reasoning off. */
export function modelParams(model: string): Record<string, unknown> {
  if (/gpt-oss/i.test(model)) return { reasoning_effort: "low" };
  if (/nemotron/i.test(model)) return { chat_template_kwargs: { thinking: false } };
  return {};
}

/** Primary first, fallback second — and never the same model twice. */
export function chatModelsInOrder(): string[] {
  return CHAT_MODEL === CHAT_FALLBACK_MODEL ? [CHAT_MODEL] : [CHAT_MODEL, CHAT_FALLBACK_MODEL];
}
