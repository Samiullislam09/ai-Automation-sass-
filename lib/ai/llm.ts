import "@/lib/dns-fix";

/** Provider-agnostic LLM adapter (Build Guide Step 5 niche-summary, and reused for
 *  Mr Lxwa in Step 7 — see the fetch call already documented in app/api/chat/route.ts).
 *  Default: NVIDIA NIM `nemotron-3.5-lightning` — same account/key as the embeddings
 *  adapter, one AI account for the whole "Lightning" tier instead of a separate one.
 *  Swap providers by changing LLM_PROVIDER in .env — call sites never change. */

export async function complete(prompt: string): Promise<string> {
  const provider = process.env.LLM_PROVIDER || "nvidia";
  switch (provider) {
    case "nvidia":
      return completeNvidia(prompt);
    case "gemini":
      return completeGemini(prompt);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}

async function completeNvidia(prompt: string): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing in .env.local");

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`NVIDIA NIM chat completion failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("NVIDIA NIM: unexpected response shape (no text)");
  return text;
}

/** Same as complete(), but asks the model for JSON and parses it (stripping ```json fences
 *  if the model wraps its answer in one, which Gemini/most chat models sometimes do). */
export async function completeJson<T = any>(prompt: string): Promise<T> {
  const raw = await complete(prompt);
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

async function completeGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing in .env.local");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini generateContent failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: unexpected response shape (no text)");
  return text;
}
