import { env } from "../env.js";
import { recordUsage } from "./costLedger.js";
import { buildLanes } from "./keyPool.js";

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

// A small safety margin under the account's per-key ceiling (free tier: 40/min) — the window
// is measured from when WE send and the provider counts when it receives, so a limiter sitting
// exactly on the line trips anyway.
const RPM = Math.max(1, Number(env.NVIDIA_RPM) || 35);

function parseKeys(raw: string): string[] {
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

const BG_KEYS = parseKeys(env.NVIDIA_API_KEYS_BG).length
  ? parseKeys(env.NVIDIA_API_KEYS_BG)
  : env.NVIDIA_API_KEY
    ? [env.NVIDIA_API_KEY]
    : [];

/** TWO LANES (see lib/keyPool.ts for the full reason).
 *   "bg" — everything this server does in the background: crawler, keyword, writer, leads, audit…
 *   "wa" — a customer's WhatsApp reply, the one call where a person is waiting on the answer.
 *  With NVIDIA_API_KEYS_WA set the reply lane has keys of its own. Without it, replies share the
 *  background keys but background work may only fill (rpm - NVIDIA_WA_RESERVE) of each key's window,
 *  so the last NVIDIA_WA_RESERVE requests a minute are always free for a customer. */
const lanes = buildLanes({
  bgKeys: BG_KEYS,
  waKeys: parseKeys(env.NVIDIA_API_KEYS_WA),
  rpm: RPM,
  reserve: Number(env.NVIDIA_WA_RESERVE) || 8,
});
export const llmLanes = lanes;

export type NvidiaLane = "bg" | "wa";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Every key staying saturated this long means demand has genuinely outrun the pool (many
// concurrent tasks, system-wide) — not a bug, but silently queuing forever behind it looks
// identical to a hang. Failing with a clear reason after a bounded wait turns that into a real,
// reported error the task can act on. A customer's reply has far less patience than a crawl: it
// waits seconds, then the caller falls back to a holding message and a human.
const MAX_WAIT_MS: Record<NvidiaLane, number> = { bg: 5 * 60_000, wa: 8_000 };

async function reserve(lane: NvidiaLane, maxWaitMs?: number): Promise<string> {
  const l = lane === "wa" ? lanes.wa : lanes.bg;
  try {
    return await l.pool.reserve(l.limit, maxWaitMs ?? MAX_WAIT_MS[lane]);
  } catch (e: any) {
    if (e?.name === "PoolSaturated") {
      throw new Error(`NVIDIA key pool (${lane}) has been at its rate limit for ${Math.round((e.waitedMs ?? 0) / 1000)}s — too many requests at once, not a hang`);
    }
    if (/No API key/.test(String(e?.message))) {
      throw new Error("No NVIDIA key configured — set NVIDIA_API_KEYS_BG or NVIDIA_API_KEY");
    }
    throw e;
  }
}

export type NvidiaFetchOptions = RequestInit & {
  /** Retries for 429 and 5xx only. A 400 is a bad request and repeating it just burns rpm. */
  retries?: number;
  label?: string;
  /** Which rate-limit lane to draw from. Default "bg". Customer replies use "wa". */
  lane?: NvidiaLane;
  /** Per-request timeout. Default 90 s (a writer section); a customer reply asks for far less. */
  timeoutMs?: number;
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
  const { retries = 3, label = "nvidia", headers, signal, lane = "bg", timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init;

  for (let attempt = 1; ; attempt++) {
    const key = await reserve(lane);
    let res: Response;
    try {
      res = await fetch(url, {
        ...rest,
        headers: { ...headers, Authorization: `Bearer ${key}` },
        // A caller's own signal (if any) still wins for cancellation; the timeout is added
        // alongside it, not instead of it.
        signal: signal ?? AbortSignal.timeout(timeoutMs),
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
  return { usedLastMinute: lanes.bg.pool.used(), limitPerMinute: RPM * lanes.bg.pool.size };
}
