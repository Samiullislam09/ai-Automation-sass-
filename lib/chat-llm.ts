/** lib/chat-llm.ts — small, fast model calls for the chat's own plumbing (reading a yes/no in any language, rewording a system message).
 *
 *  Phase 2 of the chat-intelligence plan: the chat used to read the customer's words with keyword lists (English and Hinglish only) and to answer
 *  with canned Hinglish sentences. A keyword list fails the first time someone writes in Spanish, Arabic or Bengali; the model does not. These
 *  calls are short (a JSON verdict, one reworded sentence), use the chat models in the order lib/chat-model.ts sets, and ALWAYS have a
 *  deterministic fallback at the call site, because the answer to "what did they mean" must never depend on a provider being up.
 *
 *  `fetchImpl` is injectable so tests run with no network. */
import { NVIDIA_URL, chatModelsInOrder, modelParams } from "@/lib/chat-model";
import { nvidiaKey } from "@/lib/ai/nvidiaKeys";

export type ChatLlmOptions = { timeoutMs?: number; maxTokens?: number; fetchImpl?: typeof fetch; apiKey?: string; temperature?: number };

function parseJson<T>(raw: string): T | null {
  const t = String(raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)) as T; } catch { return null; }
}

/** One short completion on the chat models, in order. Returns the text, or null if every model failed or said nothing. Never throws. */
export async function chatComplete(system: string, user: string, opts: ChatLlmOptions = {}): Promise<string | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  let key = opts.apiKey ?? "";
  if (!key) { try { key = nvidiaKey("chat"); } catch { key = process.env.NVIDIA_API_KEY ?? ""; } }
  if (!key) return null;
  for (const model of chatModelsInOrder()) {
    try {
      const res = await doFetch(NVIDIA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, stream: false, ...modelParams(model),
          temperature: opts.temperature ?? 0,
          max_tokens: opts.maxTokens ?? 300,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
      });
      if (!res.ok) { console.error(`[chat-llm] ${model} refused (${res.status})`); continue; }
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.trim()) return text;
    } catch (e: any) {
      console.error(`[chat-llm] ${model} failed:`, e?.message);
    }
  }
  return null;
}

/** A JSON verdict from the chat models, or null (unreachable, unparseable). The caller decides what null means — always the safe direction. */
export async function chatJson<T>(system: string, user: string, opts: ChatLlmOptions = {}): Promise<T | null> {
  const text = await chatComplete(system, user, opts);
  return text == null ? null : parseJson<T>(text);
}

export { parseJson as parseChatJson };
