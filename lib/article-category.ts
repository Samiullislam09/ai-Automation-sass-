/** An article's category and its neighbours, worked out on the SERVER with the article, so the reviewer opens complete.
 *
 *  They used to be filled in 900 ms after the page painted by two browser requests: the WHOLE content list (/api/content?status=all, up to 100 rows) just to find the previous and
 *  next id, and the WHOLE Site Brain profile (/api/site-brain, with every cluster's vectors) just to read a category name. */

export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

/** A trimmed port of agent-server's nearestCluster() — the same token-overlap idea. Real Site Brain data in, real answer out; "no match" is null (shown as Uncategorized), never a guess. */
export function nearestCategory(primary: string | null, clusters: { name: string; page_urls: string[] }[]): string | null {
  if (!primary || !clusters.length) return null;
  const wanted = new Set(tokens(primary));
  let best: string | null = null;
  let bestScore = 0;
  for (const c of clusters) {
    const have = new Set(tokens(`${c.name} ${(c.page_urls ?? []).slice(0, 8).join(" ")}`));
    let score = 0;
    wanted.forEach((w) => { if (have.has(w)) score++; });
    if (score > bestScore) { bestScore = score; best = c.name; }
  }
  return bestScore > 0 ? best : null;
}

/** The ids on either side of `id` in the content list (newest first, the order the Content page shows). Null on a side with no neighbour. */
export function neighboursOf(ids: string[], id: string): { prev: string | null; next: string | null } {
  const i = ids.indexOf(id);
  if (i === -1) return { prev: null, next: null };
  return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null };
}
