import { env } from "../env.js";

/** Ported from the main app's lib/ai/embeddings.ts — same NVIDIA nv-embedqa-e5-v5 model,
 *  same 1024-dim contract as site_pages.embedding (supabase/migrations/002_embedding_dim.sql).
 *  Duplicated here (not imported cross-package) because agent-server is a separate
 *  package.json/deploy target from the main Next.js app — see crawl.ts for the same note. */
export async function embed(text: string): Promise<number[]> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nv-embedqa-e5-v5",
      input: [text.slice(0, 1800)], // 512-token cap — ~1800 chars of English is a safe margin
      input_type: "passage",
    }),
  });

  if (!res.ok) throw new Error(`NVIDIA NIM embeddings failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data: any = await res.json();
  const values: number[] = data?.data?.[0]?.embedding;
  if (!Array.isArray(values)) throw new Error("NVIDIA NIM embeddings: unexpected response shape");
  return values;
}
