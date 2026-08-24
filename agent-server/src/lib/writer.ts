import { env } from "../env.js";
import { nvidiaFetch } from "./nvidia.js";

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

/** A full article is the longest single generation in this product. 60s was the old value
 *  and it was simply too tight — every retry burned another minute and the user watched
 *  three identical timeouts stack up in the office. */
const WRITER_TIMEOUT_MS = Number(process.env.WRITER_TIMEOUT_MS) || 180_000;

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

  let res: Response;
  try {
    res = await nvidiaFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    label: "writer",
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: false,
      // THE reason articles kept dying on "The operation was aborted due to timeout".
      // "detailed thinking off" in the system prompt is only a soft hint to this Nemotron
      // hybrid-reasoning model — it happily ignored it and spent minutes generating
      // reasoning_content before writing a word. chat_template_kwargs.thinking:false is the
      // actual API-level switch. The chat route found this months ago; the writer, which is
      // by far the longest generation in the product, never got it. DO NOT remove.
      chat_template_kwargs: { thinking: false },
      // An 1800-word article is roughly 2,600 tokens; without an explicit ceiling the
      // endpoint's default could cut the draft off mid-sentence.
      max_tokens: 4096,
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
    signal: AbortSignal.timeout(WRITER_TIMEOUT_MS),
    });
  } catch (e: any) {
    // undici's own wording ("The operation was aborted due to timeout") gave no clue which
    // call died or how long it waited — that message went straight to the user's dashboard.
    if (e?.name === "TimeoutError" || /aborted|timeout/i.test(e?.message ?? "")) {
      throw new Error(`Mr. Writer's model did not answer within ${Math.round(WRITER_TIMEOUT_MS / 1000)}s. The draft was not written — nothing was saved.`);
    }
    throw e;
  }

  if (!res.ok) throw new Error(`NVIDIA writer call failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data: any = await res.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error("NVIDIA writer: no content in response");
  // A truncated draft passes nothing useful downstream — it would fail the quality gate and
  // land in Approvals as a half article. Fail loudly here instead.
  if (choice?.finish_reason === "length") {
    throw new Error("Mr. Writer's draft was cut off by the model's token limit before it finished.");
  }
  return text;
}
