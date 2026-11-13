/** A rate-limited pool of API keys — the part of lib/nvidia.ts that decides WHICH key a request may
 *  use and WHEN, pulled out so it can be tested with a fake clock and shared by more than one lane.
 *
 *  WHY THERE ARE NOW TWO LANES. Every LLM call this server makes used to draw from ONE pool
 *  (NVIDIA_API_KEYS_BG, 35 requests/min per key). Customer WhatsApp replies shared it with the
 *  leads, crawler, analyst, writer and audit jobs — 15-60 minute jobs making dozens of calls each.
 *  When those were busy a customer's reply queued behind them, for up to the pool's five-minute
 *  patience, and the customer who had just written in waited with no sign anything was happening
 *  (client chat, 2026-11-13). A person's reply and a background crawl are not the same kind of
 *  work, and they must not queue in the same line.
 *
 *  Two ways to keep them apart, and the pool supports both:
 *   - DEDICATED keys for the reply lane (NVIDIA_API_KEYS_WA): the lane has its own windows, so
 *     nothing a background job does can touch it. The right setup for production.
 *   - SHARED keys with a RESERVE: with no dedicated keys, replies still draw from the same keys but
 *     background work is only allowed to fill `rpm - reserve` of each key's window, so the last
 *     `reserve` requests a minute are ALWAYS free for a customer. Not as strong as separate keys
 *     (the provider's own limit is still per key), but it removes the starvation, and it works with
 *     the keys already configured.
 *
 *  A sliding window per key, not a token bucket: the provider's limit is "N in any 60 seconds", and
 *  a bucket that refills smoothly still allows a burst of N in the first second followed by a 429.
 *  In-process only, which is correct: agent-server is one process. */

export type KeyState = { key: string; sent: number[] };

export type PoolClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const realClock: PoolClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export class PoolSaturated extends Error {
  constructor(public readonly waitedMs: number) {
    super(`every key in the pool has been at its rate limit for ${Math.round(waitedMs / 1000)}s`);
    this.name = "PoolSaturated";
  }
}

export class KeyPool {
  readonly states: KeyState[];
  private cursor = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    keys: string[],
    private readonly rpm: number,
    private readonly windowMs = 60_000,
    private readonly clock: PoolClock = realClock,
  ) {
    this.states = keys.map((key) => ({ key, sent: [] }));
  }

  get size(): number { return this.states.length; }

  private prune(s: KeyState, now: number) {
    while (s.sent.length && now - s.sent[0] >= this.windowMs) s.sent.shift();
  }

  /** Take a slot on a key that has room under `limit` (per key, per window), or null if none has. */
  tryReserve(limit: number): string | null {
    if (!this.states.length) return null;
    const start = this.cursor++ % this.states.length;
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[(start + i) % this.states.length];
      const now = this.clock.now();
      this.prune(s, now);
      if (s.sent.length < limit) {
        s.sent.push(now);
        return s.key;
      }
    }
    return null;
  }

  /** How long until some key has room under `limit`. */
  private msUntilRoom(limit: number): number {
    const now = this.clock.now();
    let soonest = Infinity;
    for (const s of this.states) {
      this.prune(s, now);
      if (s.sent.length < limit) return 0;
      // The (sent.length - limit + 1)-th oldest entry must age out before a slot opens.
      const idx = s.sent.length - limit;
      soonest = Math.min(soonest, this.windowMs - (now - s.sent[idx]) + 25);
    }
    return Number.isFinite(soonest) ? Math.max(0, soonest) : this.windowMs;
  }

  /** Wait (up to `maxWaitMs`) for a slot under `limit`. Serialised through one chain — cheap,
   *  in-memory bookkeeping only, never the HTTP call — so two concurrent callers can never both see
   *  the same free slot and both take it. Throws PoolSaturated if the wait runs out: a bounded wait
   *  that fails loudly beats a request that silently queues forever. */
  reserve(limit: number, maxWaitMs: number): Promise<string> {
    const run = () => this.reserveLocked(limit, maxWaitMs);
    const mine = this.chain.then(run, run);
    this.chain = mine.then(() => {}, () => {});
    return mine;
  }

  private async reserveLocked(limit: number, maxWaitMs: number): Promise<string> {
    if (!this.states.length) throw new Error("No API key configured for this pool");
    const started = this.clock.now();
    for (;;) {
      const key = this.tryReserve(limit);
      if (key) return key;
      const waited = this.clock.now() - started;
      if (waited >= maxWaitMs) throw new PoolSaturated(waited);
      await this.clock.sleep(Math.min(this.msUntilRoom(limit), Math.max(50, maxWaitMs - waited)));
    }
  }

  /** Requests this pool has sent in the last window, summed across keys. */
  used(): number {
    const now = this.clock.now();
    let n = 0;
    for (const s of this.states) { this.prune(s, now); n += s.sent.length; }
    return n;
  }
}

/** The two lanes over the configured keys.
 *  `bg`  — background/bulk work. Capped at `rpm - reserve` per key when the lanes share keys.
 *  `wa`  — customer replies. Dedicated keys when given, otherwise the shared keys at the full `rpm`. */
export function buildLanes(opts: {
  bgKeys: string[];
  waKeys: string[];
  rpm: number;
  /** Requests per key per minute held back for the reply lane when it shares keys with background work. */
  reserve: number;
  windowMs?: number;
  clock?: PoolClock;
}) {
  const { bgKeys, waKeys, rpm, windowMs, clock } = opts;
  const bgPool = new KeyPool(bgKeys, rpm, windowMs, clock);
  const dedicated = waKeys.length > 0;
  const waPool = dedicated ? new KeyPool(waKeys, rpm, windowMs, clock) : bgPool;
  // A reserve only makes sense when the lanes share keys and there is something to share; and it
  // can never be so large that background work gets no budget at all.
  const reserve = dedicated ? 0 : Math.min(Math.max(0, Math.floor(opts.reserve)), Math.max(0, rpm - 1));
  return {
    dedicated,
    reserve,
    bg: { pool: bgPool, limit: rpm - reserve },
    wa: { pool: waPool, limit: rpm },
  };
}
