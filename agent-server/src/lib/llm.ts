import { env } from "../env.js";
import { nvidiaFetch } from "./nvidia.js";

/** Ported from the main app's lib/ai/llm.ts, for the crawler's niche/topics summary.
 *  Includes chat_template_kwargs.thinking:false (the main app's lib didn't have this yet
 *  when this was ported) — see app/api/chat/route.ts's comment for why: without it this
 *  Nemotron model burns wildly variable, sometimes very large amounts of reasoning tokens
 *  even for a "reply with only JSON" instruction, live-tested to matter a lot for latency. */
export async function completeJson<T = any>(prompt: string): Promise<T> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const res = await nvidiaFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    label: "llm",
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      chat_template_kwargs: { thinking: false },
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`NVIDIA NIM chat completion failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data: any = await res.json();
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("NVIDIA NIM: unexpected response shape (no text)");

  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}
