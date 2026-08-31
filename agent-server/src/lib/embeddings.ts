import { env } from "../env.js";
import { nvidiaFetch } from "./nvidia.js";

/** Ported from the main app's lib/ai/embeddings.ts — same NVIDIA model, same dim contract as
 *  site_pages.embedding (supabase/migrations/002_embedding_dim.sql, superseded by 022).
 *  Duplicated here (not imported cross-package) because agent-server is a separate
 *  package.json/deploy target from the main Next.js app — see crawl.ts for the same note.
 *
 *  `nv-embedqa-e5-v5` reached end-of-life 2026-08-25 (HTTP 410 Gone) — NVIDIA gave no
 *  migration path to another 1024-dim model. Found live 2026-08-31 auditing the topic-planner
 *  chain: every embed() call had been silently failing since, which meant `agents/crawler.ts`
 *  indexed zero pages per crawl (each page's embed threw before its site_pages upsert) and
 *  `agents/analyst.ts`'s content_gaps/topic_clusters — the single strongest signal in
 *  agents/boss.ts's topic planning — fell back to an empty result with no error surfaced,
 *  because that block's per-query embed failures are caught and skipped by design (a single
 *  rate-limited call must not kill the whole gap scan). `nemotron-3-embed-1b` is the
 *  replacement verified live (200, 2048-dim) — see migration 022 for the column-width change
 *  this forces on every table that stores one of these vectors. */
export async function embed(text: string): Promise<number[]> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY missing");

  // Through the shared limiter: the crawler calls this once per page, up to ~300 times in a
  // row, which is the one place in this product that can outrun the account's rpm ceiling.
  const res = await nvidiaFetch("https://integrate.api.nvidia.com/v1/embeddings", {
    label: "embeddings",
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-embed-1b",
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
