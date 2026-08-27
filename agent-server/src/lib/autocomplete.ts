/** Google Autocomplete as a free keyword source.
 *
 *  DataForSEO is paid, and a student-run install has no account on it. Google's suggest
 *  endpoint is free, needs no key, and answers with the completions Google itself shows in
 *  the search box — which are, by construction, phrases real people type. It gives no volume
 *  number, and nothing here pretends otherwise: every result is `searchVolume: null`.
 *
 *  Two rules keep it from getting us blocked:
 *   - one request per second, process-wide (a queue, not a sleep in each caller);
 *   - a 24-hour cache per query, so a re-run of the same topic costs zero requests.
 *
 *  The cache is in-memory on purpose: one Railway instance, and a restart simply refetches.
 *  If we ever run two instances, move it to a table — it is a Map with a timestamp, nothing
 *  cleverer, so that is a ten-line change. */

const SUGGEST_URL = "https://suggestqueries.google.com/complete/search";
const MIN_GAP_MS = 1000;
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; items: string[] }>();

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

/** Serialises every call and spaces them ≥ MIN_GAP_MS apart. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Raw completions for one query, cached 24h. Empty array on any failure — the caller
 *  decides whether "nothing" is an error, this layer never throws at a keyword job. */
export async function suggest(q: string, lang = "en"): Promise<string[]> {
  const key = `${lang}:${q.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;

  const items = await throttled(async () => {
    try {
      const url = `${SUGGEST_URL}?client=firefox&hl=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MrLxwaKeyword/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Shape: ["query", ["completion", ...], ...]
      const json: any = await res.json();
      const list = Array.isArray(json?.[1]) ? json[1] : [];
      return list.map((s: unknown) => String(s ?? "").trim()).filter(Boolean);
    } catch (e: any) {
      console.warn(`[autocomplete] "${q}" failed:`, e?.message);
      return [] as string[];
    }
  });

  cache.set(key, { at: Date.now(), items });
  return items;
}

export type AutocompleteKeyword = { keyword: string; searchVolume: null; source: "autocomplete"; rank: number };

/** Related queries around a topic: the seed's own completions first (Google orders those
 *  roughly by popularity, which is the only ranking signal we get), then question and
 *  intent prefixes. Six requests at most, so ~6 seconds cold and instant when cached. */
export async function autocompleteRelated(topic: string, max = 12, lang = "en"): Promise<AutocompleteKeyword[]> {
  const t = topic.trim();
  const probes = [t, `how ${t}`, `what ${t}`, `best ${t}`, `${t} for`, `${t} vs`];

  const seen = new Set<string>([t.toLowerCase()]);
  const out: AutocompleteKeyword[] = [];
  for (const p of probes) {
    if (out.length >= max) break;
    const list = await suggest(p, lang);
    for (const s of list) {
      const k = s.toLowerCase();
      // Keep only completions that still contain the topic's first word — "best pizza"
      // for "pizza oven" is fine, "best" alone or an unrelated pivot is not.
      const stem = t.toLowerCase().split(/\s+/)[0];
      if (seen.has(k) || !k.includes(stem) || k.length < 3) continue;
      seen.add(k);
      out.push({ keyword: s, searchVolume: null, source: "autocomplete", rank: out.length + 1 });
      if (out.length >= max) break;
    }
  }
  return out;
}
