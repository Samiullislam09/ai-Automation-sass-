import { env } from "../env.js";
import { recordUsage } from "./costLedger.js";

/** One door for every NVIDIA call this server makes, with a speed limit on it — and, since
 *  2026-08-31, the key itself.
 *
 *  The account has a REQUESTS-PER-MINUTE cap (shown on build.nvidia.com — 40 rpm on the free
 *  tier), not a credit balance: the API returns no quota headers at all, so nothing can be
 *  measured after the fact. The only way to stay inside it is not to exceed it. And the limit
 *  belongs to the API KEY, not the process — a fixed rpm ceiling is fixed PER KEY.
 *
 *  This matters most for the crawler, which walks up to ~300 pages and embeds each one in a
 *  tight sequential loop — comfortably 60-120 requests a minute on a fast site, i.e. straight
 *  through a single key's 40 rpm ceiling. It then swallowed each 429 as "embed failed for
 *  <url>" and carried on, so the knowledge base quietly ended up with holes in it.
 *
 *  Found live 2026-08-31: a standalone backfill script hitting the SAME key as this server and
 *  the Next.js app's live chat ate the shared rpm budget end to end — chat sat on "…" for tens
 *  of seconds with no way to tell slow from dead. A single shared key cannot fix that by being
 *  throttled harder; it can only trade whose turn gets starved. The actual fix is separate key
 *  pools per traffic class: NVIDIA_API_KEYS_BG here (this server's background/bulk work —
 *  crawler, keyword, writer, seo, analyst, and the standalone reembed script) is now
 *  STRUCTURALLY separate from NVIDIA_API_KEYS_CHAT (Next.js's live chat + article revise,
 *  lib/ai/nvidiaKeys.ts) — no background job can ever starve chat again, no matter its load,
 *  because they physically cannot draw from the same bucket.
 *
 *  A sliding window per key, not a token bucket: the limit is "40 in any 60 seconds", and a
 *  bucket that refills smoothly still allows a burst of 40 in the first second followed by a
 *  429.
 *
 *  In-process only, which is correct here — agent-server is one process.
 */

const WINDOW_MS = 60_000;
// A small safety margin under the account's per-key ceiling (free tier: 40/min) — the window
// is measured from when WE send and the provider counts when it receives, so a limiter sitting
// exactly on the line trips anyway. NOT "leave headroom for chat" anymore — chat has its own
// separate keys now (see file header) — so this can sit much closer to the real ceiling than
// the old single-shared-key default of 30.
const RPM = Math.max(1, Number(env.NVIDIA_RPM) || 35);

function parseKeys(raw: string): string[] {
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

const KEYS = parseKeys(env.NVIDIA_API_KEYS_BG).length
  ? parseKeys(env.NVIDIA_API_KEYS_BG)
  : env.NVIDIA_API_KEY
    ? [env.NVIDIA_API_KEY]
    : [];

type KeyState = { key: string; sent: number[] };
const keyStates: KeyState[] = KEYS.map((key) => ({ key, sent: [] }));
let cursor = 0;
let chain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Picks a key with room in its own window and reserves a slot on it; waits (and retries) if
 *  every key in the pool is currently full. Round-robins the starting point each call so load
 *  spreads evenly across the pool instead of filling keyStates[0] before ever touching [1].
 *  Serialised through a single promise chain — cheap, in-memory bookkeeping only, never the
 *  actual HTTP call — so two concurrent workers can't both see the same free slot and both
 *  take it. */
async function reserve(): Promise<string> {
  const mine = chain.then(reserveLocked);
  chain = mine.then(
    () => {},
    () => {},
  );
  return mine;
}

// Every key staying saturated this long means demand has genuinely outrun the pool (many
// concurrent tasks, system-wide) — not a bug, but silently queuing forever behind it looks
// identical to a hang from the live canvas's point of view. Failing with a clear reason after a
// bounded wait turns that into a real, reported error the task can act on (retry, or the owner
// adding capacity) instead of a task that just never seems to move.
const MAX_RESERVE_WAIT_MS = 5 * 60_000;

async function reserveLocked(): Promise<string> {
  if (keyStates.length === 0) {
    throw new Error("No NVIDIA key configured — set NVIDIA_API_KEYS_BG or NVIDIA_API_KEY");
  }
  const waitStarted = Date.now();
  for (;;) {
    const start = cursor++ % keyStates.length;
    for (let i = 0; i < keyStates.length; i++) {
      const state = keyStates[(start + i) % keyStates.length];
      const now = Date.now();
      while (state.sent.length && now - state.sent[0] >= WINDOW_MS) state.sent.shift();
      if (state.sent.length < RPM) {
        state.sent.push(now);
        return state.key;
      }
    }
    if (Date.now() - waitStarted >= MAX_RESERVE_WAIT_MS) {
      throw new Error(`NVIDIA key pool has been at its rate limit for ${Math.round(MAX_RESERVE_WAIT_MS / 60_000)} minutes straight — too many jobs running at once, not a hang`);
    }
    // Every key in the pool is full — wait for whichever frees up soonest, then recheck.
    const now = Date.now();
    const soonestFree = Math.min(...keyStates.map((s) => s.sent[0] ?? now));
    await sleep(Math.max(0, WINDOW_MS - (now - soonestFree) + 25));
  }
}

export type NvidiaFetchOptions = RequestInit & {
  /** Retries for 429 and 5xx only. A 400 is a bad request and repeating it just burns rpm. */
  retries?: number;
  label?: string;
};

// No per-request timeout existed here at all until now — a stalled NVIDIA connection (dead
// socket, provider-side hang) blocked forever, with nothing to retry because `fetch` itself
// never rejected or resolved. Found live 2026-09-12 (owner, screenshot): a writer task sat on
// "Writing the outline…" for 11+ minutes, no section ever landing — every section's own call
// shares this one door. 90s is generous for a real completion (writer.ts's own sections rarely
// take more than 15-20s) but short enough that a genuine hang fails fast instead of eating the
// whole task.
const REQUEST_TIMEOUT_MS = 90_000;

export async function nvidiaFetch(url: string, init: NvidiaFetchOptions = {}): Promise<Response> {
  const { retries = 3, label = "nvidia", headers, signal, ...rest } = init;

  for (let attempt = 1; ; attempt++) {
    const key = await reserve();
    let res: Response;
    try {
      res = await fetch(url, {
        ...rest,
        headers: { ...headers, Authorization: `Bearer ${key}` },
        // A caller's own signal (if any) still wins for cancellation; the timeout is added
        // alongside it, not instead of it.
        signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      // A hang/timeout or a dropped connection — retried exactly like a 429/5xx below (same
      // backoff schedule), because from here it looks the same: "try again shortly." Only once
      // retries are exhausted does this actually fail the caller, which is a real, reported
      // failure — not a silent multi-minute stall that looks identical to "still working."
      if (attempt > retries) throw e;
      const waitMs = Math.min(30_000, 2 ** attempt * 1000);
      console.warn(`[${label}] request failed (${e?.name ?? "error"}: ${e?.message ?? e}) — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${retries})`);
      await sleep(waitMs);
      continue;
    }

    if (res.status !== 429 && res.status < 500) {
      // Fire-and-forget on a CLONE — the real `res` is handed back untouched (its body is a
      // single-use stream, and every caller here reads it themselves via res.json()). Never
      // lets a cost-tracking hiccup affect, slow down or fail the actual LLM call.
      if (res.ok) void captureUsage(res.clone(), label);
      return res;
    }
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

/** Every OpenAI-compatible NIM response carries `usage.total_tokens` — this is the only place
 *  that ever reads it, feeding MASTER_PLAN §13 Phase 4's cost dashboard via costLedger.ts.
 *  Swallows everything: a non-JSON body, a missing usage field, a parse error — recording cost
 *  is strictly additive and must never be the reason an LLM call's caller sees a problem. */
async function captureUsage(res: Response, label: string): Promise<void> {
  try {
    const data: any = await res.json();
    const tokens = data?.usage?.total_tokens;
    if (typeof tokens === "number" && tokens > 0) recordUsage(tokens);
  } catch (e: any) {
    console.error(`[${label}] cost capture failed (article/response unaffected):`, e?.message);
  }
}

/** For the dashboard/logs: how much of the pool's combined window is currently spoken for.
 *  Not a quota — the provider exposes none — just what this process has sent, summed across
 *  every key in the pool, in the last 60 seconds. */
export function nvidiaWindow(): { usedLastMinute: number; limitPerMinute: number } {
  const now = Date.now();
  let used = 0;
  for (const state of keyStates) {
    while (state.sent.length && now - state.sent[0] >= WINDOW_MS) state.sent.shift();
    used += state.sent.length;
  }
  return { usedLastMinute: used, limitPerMinute: RPM * keyStates.length };
}
