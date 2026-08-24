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

/** Everything we actually know about the business, read from its own row + crawled pages
 *  (see agents/writer.ts). Without this the writer produced generic small-business filler
 *  that could have been about anyone — the single biggest quality problem in the pipeline. */
export type WriterContext = {
  businessName?: string | null;
  websiteUrl?: string | null;
  niche?: string | null;
  audience?: string | null;
  tone?: string | null;
  /** Real crawled pages, used for internal links — never invented URLs. */
  pages?: { title: string; url: string }[];
  /** Pre-rendered block of measured Search Console / GA4 facts about this site
   *  (agent-server/src/lib/insights.ts). Empty string when Google isn't connected. */
  searchEvidence?: string;
};

export async function writeArticle(topic: string, blueprint?: string, context?: WriterContext): Promise<string> {
  const provider = process.env.WRITER_PROVIDER || "nvidia";
  switch (provider) {
    case "nvidia":
      return writeWithNvidia(topic, blueprint, context);
    case "deepseek":
      throw new Error("WRITER_PROVIDER=deepseek not implemented yet — add DEEPSEEK_API_KEY handling here before production");
    default:
      throw new Error(`Unknown WRITER_PROVIDER: ${provider}`);
  }
}

/** The rules every article is held to. They are written down here (and checked afterwards by
 *  lib/qualityGate.ts) rather than living in someone's head, so "how does it guarantee a good
 *  article?" has an actual answer — and so the UI can show the same list to the user. */
export const WRITING_RULES = [
  "Answer the primary keyword in the first 100 words — no throat-clearing intro.",
  "One ## section per related query in the blueprint, in descending search volume order.",
  "Write for the business's stated audience, in its stated tone.",
  "Use only facts present in the business context or in the blueprint. Never invent statistics, prices, awards, client names or dates.",
  "Link to the business's own crawled pages where genuinely relevant, using their real URLs.",
  "Never print a Search Console impression, click, position or session count in the article — that data shapes what you write, it is not content for the reader.",
  "Short paragraphs (2-4 sentences), no filler, no 'in today's fast-paced world' openings.",
  "End with one concrete next step the reader can take.",
  "1200-1800 words, starting with a single '# Title' line.",
];

function contextBlock(context?: WriterContext): string {
  if (!context) return "";
  const bits: string[] = [];
  if (context.businessName) bits.push(`Business: ${context.businessName}`);
  if (context.websiteUrl) bits.push(`Website: ${context.websiteUrl}`);
  if (context.niche) bits.push(`What they do: ${context.niche}`);
  if (context.audience) bits.push(`Audience: ${context.audience}`);
  if (context.tone) bits.push(`Brand tone: ${context.tone}`);
  if (context.pages?.length) {
    bits.push(
      "Their existing pages (use as internal links where relevant, exact URLs only):",
      ...context.pages.slice(0, 12).map((p) => `- ${p.title} -> ${p.url}`)
    );
  }
  return bits.length ? `BUSINESS CONTEXT (everything you may treat as true):\n${bits.join("\n")}\n\n` : "";
}

async function writeWithNvidia(topic: string, blueprint?: string, context?: WriterContext): Promise<string> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const prompt = [
    contextBlock(context),
    `Write a complete, well-structured SEO article on "${topic}".`,
    blueprint ? `\nBLUEPRINT (from real keyword research):\n${blueprint}` : "",
    `\nRULES (all of them apply):\n${WRITING_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    `\nOutput markdown only — no preamble, no explanation of what you wrote.`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "detailed thinking off\n\nYou are Mr. Writer, a content writer for a small business's own blog. " +
            "You write ONLY from the business context and blueprint you are given: if a fact is not there, you do not state it.",
        },
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
