import { env } from "../env.js";

/** One door for every NVIDIA call this server makes, with a speed limit on it.
 *
 *  The account has a REQUESTS-PER-MINUTE cap (shown on build.nvidia.com — 40 rpm on the free
 *  tier), not a credit balance: the API returns no quota headers at all, so nothing can be
 *  measured after the fact. The only way to stay inside it is not to exceed it.
 *
 *  This matters most for the crawler, which walks up to ~300 pages and embeds each one in a
 *  tight sequential loop — comfortably 60-120 requests a minute on a fast site, i.e. straight
 *  through a 40 rpm ceiling. It then swallowed each 429 as "embed failed for <url>" and
 *  carried on, so the knowledge base quietly ended up with holes in it.
 *
 *  A sliding window, not a token bucket: the limit is "40 in any 60 seconds", and a bucket
 *  that refills smoothly still allows a burst of 40 in the first second followed by a 429.
 *
 *  In-process only, which is correct here — agent-server is one process. The Next.js side
 *  makes its own calls (chat, article revisions) and can't share this; those are one request
 *  per human action, so they're nowhere near the ceiling.
 */

const WINDOW_MS = 60_000;
// Well below the account's ceiling (free tier: 40/min), for two reasons.
//
// One: the window is measured from when WE send and the provider counts when it receives, so
// a limiter sitting exactly on the line trips anyway.
//
// Two, and the bigger one: the rate limit belongs to the API KEY, not to this process. The
// Next.js app calls NVIDIA with the same key for chat and article revisions, and it cannot
// share an in-process limiter with a different deployment. If this server used the whole
// budget during a long crawl, the user chatting at the same time would be the one who got
// the 429 — the interactive path punished for the background one. 30 leaves ~10/min for the
// side of the product a human is actually waiting on.
const RPM = Math.max(1, Number(env.NVIDIA_RPM) || 30);

const sent: number[] = [];
let chain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until sending now keeps us inside the window. Serialised through a promise chain so
 *  two concurrent workers can't both look at the same free slot and both take it. */
async function reserve(): Promise<void> {
  const mine = chain.then(async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= WINDOW_MS) sent.shift();
      if (sent.length < RPM) { sent.push(now); return; }
      // +25ms so we wake up just after the oldest call leaves the window, not exactly on it.
      await sleep(WINDOW_MS - (now - sent[0]) + 25);
    }
  });
  chain = mine.catch(() => {});
  return mine;
}

export type NvidiaFetchOptions = RequestInit & {
  /** Retries for 429 and 5xx only. A 400 is a bad request and repeating it just burns rpm. */
  retries?: number;
  label?: string;
};

export async function nvidiaFetch(url: string, init: NvidiaFetchOptions = {}): Promise<Response> {
  const { retries = 3, label = "nvidia", ...rest } = init;

  for (let attempt = 1; ; attempt++) {
    await reserve();
    const res = await fetch(url, rest);

    if (res.status !== 429 && res.status < 500) return res;
    if (attempt > retries) return res;

    // Retry-After is authoritative when the provider sends it; otherwise back off, because
    // retrying a rate limit immediately is how a limiter turns into a hammer.
    const header = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(header) && header > 0 ? header * 1000 : Math.min(30_000, 2 ** attempt * 1000);
    console.warn(`[${label}] ${res.status} from NVIDIA — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${retries})`);
    // The body has to be drained or the socket leaks.
    await res.text().catch(() => "");
    await sleep(waitMs);
  }
}

/** For the dashboard/logs: how much of the window is currently spoken for. Not a quota — the
 *  provider exposes none — just what this process has sent in the last 60 seconds. */
export function nvidiaWindow(): { usedLastMinute: number; limitPerMinute: number } {
  const now = Date.now();
  while (sent.length && now - sent[0] >= WINDOW_MS) sent.shift();
  return { usedLastMinute: sent.length, limitPerMinute: RPM };
}
