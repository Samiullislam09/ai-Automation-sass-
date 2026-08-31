import "@/lib/dns-fix";
import { nvidiaKey } from "@/lib/ai/nvidiaKeys";

/** Provider-agnostic embeddings adapter (Build Guide Step 5).
 *  Default: NVIDIA NIM `nemotron-3-embed-1b` — same free build.nvidia.com account/key the
 *  guide already has you create in Step 0 (and reuses for Lightning/Mr Lxwa in Step 7),
 *  so there's no second AI account to sign up for. Its 2048 dimensions must match the
 *  `vector(2048)` column on `site_pages` — see supabase/migrations/022_embedding_dim_2048.sql.
 *  (The original `nv-embedqa-e5-v5`, 1024-dim, reached end-of-life 2026-08-25 — HTTP 410 with
 *  no migration path. Found live 2026-08-31: every embed() call here and in agent-server's
 *  twin had been failing silently since, so `/api/onboarding/crawl` indexed zero pages.)
 *  Swap providers by changing EMBEDDINGS_PROVIDER in .env — call sites never change. */

export async function embed(text: string): Promise<number[]> {
  const provider = process.env.EMBEDDINGS_PROVIDER || "nvidia";
  switch (provider) {
    case "nvidia":
      return embedNvidia(text);
    case "gemini":
      return embedGemini(text);
    default:
      throw new Error(`Unknown EMBEDDINGS_PROVIDER: ${provider}`);
  }
}

async function embedNvidia(text: string): Promise<number[]> {
  // Onboarding's crawl is a background, one-off job — draws from the "bg" pool
  // (NVIDIA_API_KEYS_BG), never the keys reserved for live chat. See lib/ai/nvidiaKeys.ts.
  const key = nvidiaKey("bg");

  const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      // 512-token cap — ~1800 chars of English is a safe margin
      model: "nvidia/nemotron-3-embed-1b",
      input: [text.slice(0, 1800)],
      input_type: "passage", // "passage" = indexing content (this), "query" = search-time lookups
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`NVIDIA NIM embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const values: number[] = data?.data?.[0]?.embedding;
  if (!Array.isArray(values)) throw new Error("NVIDIA NIM embeddings: unexpected response shape");
  return values;
}

/** Kept as a fallback option — Google AI Studio's text-embedding-004 (768-dim, needs its own
 *  key + a 768-dim column if you switch to it). */
async function embedGemini(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing in .env.local");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 8000) }] },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const values: number[] = data?.embedding?.values;
  if (!Array.isArray(values)) throw new Error("Gemini embeddings: unexpected response shape");
  return values;
}
