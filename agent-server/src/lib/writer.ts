import { env } from "../env.js";

/** Provider-agnostic Writer adapter (Build Guide Step 11).
 *
 * ⚠️ TEMPORARY: WRITER_PROVIDER defaults to "nvidia" (same Lightning-tier key/model
 * used everywhere else) so the pipeline works end-to-end without signing up for a
 * third AI service right now. This is explicitly NOT the guide's intended setup —
 * the guide calls for a separate "Frontier tier" model (DeepSeek / Gemini / Claude)
 * specifically for long-form article quality, since Lightning models are tuned for
 * cheap/fast classification, not publish-quality writing.
 * BEFORE PRODUCTION: sign up for platform.deepseek.com (or Gemini), set
 * WRITER_PROVIDER=deepseek and DEEPSEEK_API_KEY in Railway, and implement the
 * "deepseek" case below (stubbed — throws until then). See docs/AI_LOGIC.md. */

export async function writeArticle(topic: string, blueprint?: string): Promise<string> {
  const provider = process.env.WRITER_PROVIDER || "nvidia";
  switch (provider) {
    case "nvidia":
      return writeWithNvidia(topic, blueprint);
    case "deepseek":
      throw new Error("WRITER_PROVIDER=deepseek not implemented yet — add DEEPSEEK_API_KEY handling here before production");
    default:
      throw new Error(`Unknown WRITER_PROVIDER: ${provider}`);
  }
}

async function writeWithNvidia(topic: string, blueprint?: string): Promise<string> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const prompt = blueprint
    ? `Write a complete, well-structured SEO article on "${topic}".\n\nFollow this blueprint:\n${blueprint}\n\nUse clear H2/H3 headings (markdown), short paragraphs, and a natural, helpful tone. 1200-1800 words.`
    : `Write a complete, well-structured SEO article on "${topic}". Use clear H2/H3 headings (markdown), short paragraphs, and a natural, helpful tone aimed at a small-business audience. 1200-1800 words.`;

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: false,
      messages: [
        { role: "system", content: "detailed thinking off\n\nYou are Mr. Writer, a skilled content writer for small-business marketing articles." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`NVIDIA writer call failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("NVIDIA writer: no content in response");
  return text;
}
