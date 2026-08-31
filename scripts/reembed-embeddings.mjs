#!/usr/bin/env -S npx tsx
/**
 * Re-embed every `site_pages` row after migration 022 nulled it.
 *
 * WHY THIS EXISTS. NVIDIA retired nv-embedqa-e5-v5 (1024-dim) on 2026-08-25 with no 1024-dim
 * replacement. Every embedding this product has stored was produced by that dead model and is
 * useless at any width, so migration 022 nulls `site_pages.embedding` / `content_items.embedding`
 * / `knowledge_chunks.embedding` and widens the columns to vector(2048) for the replacement
 * model (nemotron-3-embed-1b, verified live 2026-08-31). `content_items.embedding` and
 * `knowledge_chunks.embedding` have no writer today (Phase 2's semantic duplicate lock and
 * Phase 3's RAG, both still unbuilt — see lib/dedupe.ts's own TODO) — nulling them is enough,
 * nothing to backfill. `site_pages.embedding` is the one column real features read TODAY
 * (agents/analyst.ts's topic_clusters + content_gaps, boss.ts's strongest topic-planning
 * signal), so it is the one this script re-fills — every page, every tenant, without a full
 * re-crawl (the crawled text is already in `content_text`; only the vector was lost).
 *
 * USAGE (repo root; needs NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * NVIDIA_API_KEYS_BG (comma-separated pool, preferred) or NVIDIA_API_KEY (single fallback) —
 * .env.local, .env, or the shell environment. Run through `tsx` so `.mjs` top-level await and
 * the dynamic env loader below both work under plain `node` too, but tsx is what the rest of
 * this repo's scripts use — kept consistent, not required here.
 *
 *   npx tsx scripts/reembed-embeddings.mjs --confirm                    # every tenant
 *   npx tsx scripts/reembed-embeddings.mjs --confirm --tenant <uuid>    # one tenant first
 *
 * --confirm is required and does nothing else — this makes real, billable-where-not-free
 * NVIDIA calls the moment it runs, one per page, so it never fires by accident. Idempotent:
 * only rows where `embedding is null` are picked up, so a crash halfway can simply be re-run.
 * Throttled to under 1 request/second PER KEY in the pool — each key's own rpm ceiling (30-40)
 * is respected independently. NVIDIA_API_KEYS_BG is dedicated background-work capacity, never
 * shared with live chat's keys (NVIDIA_API_KEYS_CHAT) — see agent-server/src/lib/nvidia.ts and
 * lib/ai/nvidiaKeys.ts — so this script can run flat-out without slowing chat down at all.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const CONFIRM = process.argv.includes("--confirm");
const tenantArgIdx = process.argv.indexOf("--tenant");
const ONLY_TENANT = tenantArgIdx >= 0 ? process.argv[tenantArgIdx + 1] : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// A pool, not one key: this script drew from the SAME single NVIDIA_API_KEY as live chat on
// 2026-08-31, ate the account's whole rpm budget, and chat sat on "…" for tens of seconds
// with no way to tell slow from dead. NVIDIA_API_KEYS_BG (comma-separated) is agent-server's
// dedicated background-work pool — see agent-server/src/lib/nvidia.ts and
// lib/ai/nvidiaKeys.ts, which have the fuller story — never the keys chat reserves for
// itself, so this script can run flat-out without touching chat's budget at all.
const NVIDIA_KEYS = (process.env.NVIDIA_API_KEYS_BG || process.env.NVIDIA_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

function die(msg) {
  console.error("✕ " + msg);
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) die("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.");
if (!NVIDIA_KEYS.length) die("NVIDIA_API_KEY (or NVIDIA_API_KEYS_BG) is required.");
if (!CONFIRM) die("Pass --confirm to actually run this — it makes real NVIDIA calls and writes to site_pages. Nothing was touched.");

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const rest = (p, init) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });

// Round-robin across the pool — each key stays well under its own ~40rpm ceiling (see
// PER_KEY_SLEEP_MS below) while wall-clock throughput scales with how many keys are set.
let keyCursor = 0;
function nextKey() {
  const k = NVIDIA_KEYS[keyCursor % NVIDIA_KEYS.length];
  keyCursor++;
  return k;
}

// Same call agent-server/src/lib/embeddings.ts and lib/ai/embeddings.ts make — duplicated
// rather than imported, same reason those two duplicate each other: this script has no
// agent-server env (DATABASE_URL etc.) to satisfy, and no Next.js build to run inside.
async function embed(text) {
  const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nextKey()}` },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-embed-1b",
      input: [text.slice(0, 1800)],
      input_type: "passage",
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA embeddings failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = await res.json();
  const values = data?.data?.[0]?.embedding;
  if (!Array.isArray(values)) throw new Error("NVIDIA embeddings: unexpected response shape");
  return values;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// < 1 req/s PER KEY (well under the ~40rpm ceiling each key gets); spread across the pool so
// e.g. 4 keys means one call roughly every 275ms wall-clock instead of every 1.1s.
const PER_KEY_SLEEP_MS = 1100 / NVIDIA_KEYS.length;

async function main() {
  let total = 0;
  let failed = 0;
  // Cursor on `id`, not a re-query of `embedding=is.null` — a row that fails embed() stays
  // null forever, and re-querying the same filter would hand it straight back next page,
  // looping on it forever. Advancing past it by id means a failure is reported once and the
  // run moves on; a full re-run (idempotent, only null rows match) is how you retry it.
  let cursor = "00000000-0000-0000-0000-000000000000";

  for (;;) {
    let query = `site_pages?select=id,tenant_id,title,content_text,embedding&order=id.asc&limit=500&id=gt.${cursor}`;
    if (ONLY_TENANT) query += `&tenant_id=eq.${ONLY_TENANT}`;

    const res = await rest(query);
    if (!res.ok) die(`site_pages read failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      if (row.embedding) continue; // already re-embedded (e.g. a prior --tenant run)
      const text = `${row.title ?? ""}\n\n${row.content_text ?? ""}`.trim();
      if (!text) {
        // Nothing to embed — leave it null rather than embedding an empty string.
        continue;
      }
      try {
        const vector = await embed(text);
        const upd = await rest(`site_pages?id=eq.${row.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ embedding: vector }),
        });
        if (!upd.ok) throw new Error(`write failed (${upd.status}): ${await upd.text()}`);
        total++;
        if (total % 25 === 0) console.log(`  ${total} pages re-embedded so far...`);
      } catch (e) {
        failed++;
        console.error(`  ✕ ${row.id} (${row.title ?? "untitled"}): ${e.message}`);
      }
      await sleep(PER_KEY_SLEEP_MS);
    }

    if (rows.length < 500) break; // last page
  }

  console.log(`\nDone: ${total} page(s) re-embedded, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main();
