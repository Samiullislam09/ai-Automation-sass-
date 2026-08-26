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

export const CHAT_MODEL = process.env.CHAT_MODEL || "openai/gpt-oss-120b";
export const CHAT_FALLBACK_MODEL = process.env.CHAT_FALLBACK_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";

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
