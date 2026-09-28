/** Run: cd agent-server && npx tsx --test src/agents/analyst.test.ts
 *
 *  No network, no database — same env-then-dynamic-import pattern as seo.test.ts (env.ts throws
 *  on a missing DATABASE_URL, so it is set before the import runs).
 *
 *  WHAT THESE COVER, AND WHY THESE. Migration 026 stopped the analyst from pulling every
 *  vector(2048) embedding out of Postgres on every run — measured at 3366 KB of float text per run
 *  against 810 KB of real page text, which is what kept exhausting the 5 GB/month free egress
 *  allowance in under a week with three users.
 *  Two of the three claims that change rests on are pure functions and are asserted here:
 *
 *    1. analyst_page_vectors() rounds every component to 5 decimals before it leaves the
 *       database. That is only safe if it cannot move a page into a different topic.
 *    2. Cluster reuse is exact rather than approximate, which is true only because
 *       buildClusters() is deterministic — the property its own comment claims but nothing
 *       verified until now.
 *
 *  The third claim (1 - (embedding <=> q) is the cosine similarity the old dot product computed)
 *  is SQL and cannot be asserted from here. It was verified against the live database instead, in
 *  a rolled-back transaction on 2026-09-27: analyst_nearest_page() handed a page's own stored
 *  vector returned that same page at similarity exactly 1.0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { buildClusters } = await import("./analyst.js");
type Vectored = { url: string; title: string; embedding: number[] };

const DIM = 2048; // vector(2048) since migration 022

/** A deterministic pseudo-random generator, so a failure is reproducible and re-running the
 *  suite cannot turn a red into a green. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One page's vector: a topic direction plus noise, unit length — the same shape the embedding
 *  model produces, and the shape analyst_page_vectors() rounds. `spread` controls how much the
 *  pages within a topic differ; at 0.35 the topics are separable but not trivially so. */
function pageVector(topic: number, n: number, rand: () => number, spread = 0.35): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (let i = 0; i < DIM; i++) {
    // Each topic owns a contiguous band of dimensions, which is what makes it a topic.
    const inBand = i >= topic * 256 && i < (topic + 1) * 256;
    v[i] = (inBand ? 1 : 0) + spread * (rand() - 0.5) + n * 1e-4 * (rand() - 0.5);
  }
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function corpus(topics: number, perTopic: number, seed = 7): Vectored[] {
  const rand = rng(seed);
  const pages: Vectored[] = [];
  for (let t = 0; t < topics; t++) {
    for (let n = 0; n < perTopic; n++) {
      pages.push({
        url: `https://example.test/t${t}/page-${n}`,
        title: `Topic ${t} page ${n}`,
        embedding: pageVector(t, n, rand),
      });
    }
  }
  return pages;
}

/** Exactly what migration 026's `round(v::numeric, 5)` does to each component. */
function roundTo5(pages: Vectored[]): Vectored[] {
  return pages.map((p) => ({ ...p, embedding: p.embedding.map((v) => Number(v.toFixed(5))) }));
}

/** Clusters compared the only way that matters to the user: which pages ended up together.
 *  Cluster ORDER and cluster NAMES are not part of this — order is by size and the name comes
 *  from an LLM call that is not in play here. */
function grouping(clusters: { page_urls: string[] }[]): string[] {
  return clusters.map((c) => [...c.page_urls].sort().join("|")).sort();
}

test("clustering is deterministic — the property cluster reuse depends on", () => {
  const pages = corpus(3, 8);
  const first = buildClusters(pages);
  const second = buildClusters(pages.map((p) => ({ ...p, embedding: [...p.embedding] })));

  assert.ok(first.length >= 2, `expected the three planted topics to form clusters, got ${first.length}`);
  assert.deepEqual(grouping(second), grouping(first));
  // Centroids too, not just the grouping: they are stored in the profile and a moving centroid
  // would show the user a changed topic on an unchanged site.
  assert.deepEqual(second.map((c) => c.centroid), first.map((c) => c.centroid));
});

test("rounding every component to 5 decimals does not move a page between topics", () => {
  const pages = corpus(3, 8);
  const exact = buildClusters(pages);
  const rounded = buildClusters(roundTo5(pages));

  assert.ok(exact.length >= 2, "nothing to compare if the exact run found no clusters");
  assert.deepEqual(grouping(rounded), grouping(exact));
});

test("rounding holds on a harder corpus: more topics, pages that overlap more", () => {
  // spread 0.6 puts the topics much closer together, which is where a quantisation error would
  // actually show up if 1e-5 were too coarse.
  const rand = rng(23);
  const pages: Vectored[] = [];
  for (let t = 0; t < 5; t++) {
    for (let n = 0; n < 6; n++) {
      pages.push({
        url: `https://example.test/t${t}/p${n}`,
        title: `T${t} P${n}`,
        embedding: pageVector(t, n, rand, 0.6),
      });
    }
  }

  assert.deepEqual(grouping(buildClusters(roundTo5(pages))), grouping(buildClusters(pages)));
});

test("rounded vectors drift by less than the 4th decimal anything is compared at", () => {
  // The claim in 026's comment, measured rather than argued. Worst drift over 40 seeded corpora
  // was 1.5e-5, so the bound here is 1e-4: the precision the product actually compares at, since
  // nearest_similarity is stored as toFixed(4). A first attempt at this asserted < 1e-5 and
  // failed at 1.25e-5 — the estimate in 026's comment was an order-of-magnitude guess and this
  // is the number that replaced it.
  const pages = corpus(2, 6, 99);
  const rounded = roundTo5(pages);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

  let worst = 0;
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      worst = Math.max(worst, Math.abs(dot(pages[i].embedding, pages[j].embedding) - dot(rounded[i].embedding, rounded[j].embedding)));
    }
  }
  assert.ok(worst < 1e-4, `worst similarity drift was ${worst}, expected < 1e-4`);
});

test("too few pages is not a cluster of one — the guard still holds after the retype", () => {
  // CLUSTER_MIN_PAGES is 6. Five pages must produce nothing rather than a topic called "the site".
  assert.deepEqual(buildClusters(corpus(1, 5)), []);
});
