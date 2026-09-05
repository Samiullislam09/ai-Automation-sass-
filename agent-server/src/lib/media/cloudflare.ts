/** Cloudflare Workers AI — the image generator behind Mr. Image (MASTER_PLAN §19.4.1).
 *
 *  ONE ACCOUNT IS NOT ENOUGH, AND THAT IS THE WHOLE DESIGN HERE.
 *  A free account gets 10,000 neurons a day. One FLUX.1-schnell image cost 172.8 of them when
 *  this was measured live (2026-09-05: 200 OK, 3.7s, 1024×1024 JPEG), so one account is about
 *  57 images a day — for every tenant on the platform, not per tenant. So the owner's own
 *  instruction (2026-09-05): "agar ek ka limit khatam to 2nd shuru, agar 2nd ka khatam to
 *  3rd". This file is that: an ordered pool of accounts, each used until its daily quota is
 *  gone, all of them back at 00:00 UTC when Cloudflare resets.
 *
 *  A Cloudflare credential is a PAIR — a token only works against the account it was made for
 *  — which is why the pool is parsed from `accountId:token` entries rather than a list of
 *  keys like the NVIDIA pool next door (lib/nvidia.ts).
 *
 *  What counts as "this account is done":
 *   · the documented daily-quota error (code 4006, or any message that says the neuron limit
 *     is exhausted) — that account is out until the next UTC midnight;
 *   · a 429 — treated as busy, not empty: the account is rested for RATE_LIMIT_REST_MS and the
 *     next one is tried straight away.
 *  Everything else (a bad prompt, a 5xx) is that REQUEST's problem, not the account's, and is
 *  reported as such — retrying it on three accounts would just spend three accounts' time.
 */

import { env } from "../../env.js";

export type CloudflareAccount = { id: string; token: string };

export type ImageResult = {
  jpeg: Buffer;
  /** Which account in the pool produced it (1-based) — the run log says so, so a bill or an
   *  exhausted account can be traced to the image that spent it. */
  account: number;
  /** What Cloudflare said this cost. Real number from the response, never an estimate. */
  neurons: number;
  ms: number;
};

const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const TIMEOUT_MS = 60_000;
const RATE_LIMIT_REST_MS = 60_000;
/** Cloudflare's own code for "daily free neuron limit exceeded". */
const QUOTA_CODE = 4006;
const QUOTA_TEXT = /neuron|quota|daily limit|limit exceeded|out of credit/i;

/** Parses `CLOUDFLARE_ACCOUNTS` ("id:token, id:token"), falling back to the single pair. An
 *  entry that is not a pair is skipped with a warning rather than throwing — one typo in a
 *  three-account list must not take image generation down entirely. */
export function parseAccounts(pool: string, singleId = "", singleToken = ""): CloudflareAccount[] {
  const out: CloudflareAccount[] = [];
  for (const entry of pool.split(",").map((e) => e.trim()).filter(Boolean)) {
    // Split on the FIRST colon only: a token may legitimately contain one.
    const at = entry.indexOf(":");
    const id = at === -1 ? "" : entry.slice(0, at).trim();
    const token = at === -1 ? "" : entry.slice(at + 1).trim();
    if (!id || !token) {
      console.warn(`[cloudflare] CLOUDFLARE_ACCOUNTS entry ignored (expected "accountId:token"): ${entry.slice(0, 12)}…`);
      continue;
    }
    out.push({ id, token });
  }
  if (singleId && singleToken && !out.some((a) => a.id === singleId)) out.unshift({ id: singleId, token: singleToken });
  return out;
}

/** Midnight UTC after `now` — when Cloudflare hands every account its 10,000 neurons back. */
export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

type AccountState = {
  account: CloudflareAccount;
  /** Epoch ms until which this account is skipped — quota (next UTC midnight) or a 429 rest. */
  restingUntil: number;
  /** Why it is resting, for the log and for /version. */
  reason: string;
  /** Neurons this process has seen this account spend since it last reset. */
  neuronsSeen: number;
  images: number;
};

export class AllAccountsBusy extends Error {
  constructor(public readonly detail: string) {
    super(`Every Cloudflare account is out of daily image quota — ${detail}`);
    this.name = "AllAccountsBusy";
  }
}

export class CloudflarePool {
  private states: AccountState[];
  private cursor = 0;

  constructor(accounts: CloudflareAccount[]) {
    this.states = accounts.map((account) => ({ account, restingUntil: 0, reason: "", neuronsSeen: 0, images: 0 }));
  }

  get size(): number {
    return this.states.length;
  }

  /** What each account has spent and whether it is resting — for the run log and /version.
   *  Ids are truncated: an account id is not a secret, but a full one in a log is still noise. */
  status(now = Date.now()) {
    return this.states.map((s, i) => ({
      account: i + 1,
      id: s.account.id.slice(0, 8) + "…",
      resting: s.restingUntil > now,
      until: s.restingUntil > now ? new Date(s.restingUntil).toISOString() : null,
      reason: s.restingUntil > now ? s.reason : "",
      neurons: Math.round(s.neuronsSeen),
      images: s.images,
    }));
  }

  /** Generates one image, walking the pool until an account answers. Round-robins the starting
   *  point so a long run does not always exhaust account 1 first while 2 and 3 sit idle.
   *
   *  `seed` was meant to make an image reproducible (§19.4.3) — same article + slot, same
   *  picture. FLUX-1-schnell does not accept one (see the request body below), so on this rung
   *  it is recorded, not obeyed: asking again gives a DIFFERENT picture. That costs us nothing,
   *  because re-use never went back to Cloudflare anyway — a generated image is stored once and
   *  read back from the `media` table (lib/media/store.ts). The seed still matters to the
   *  providers below Cloudflare on the ladder, which do honour it. */
  async image(prompt: string, seed: number, opts: { steps?: number; fetchImpl?: typeof fetch; now?: () => number } = {}): Promise<ImageResult> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const now = opts.now ?? Date.now;
    if (!this.states.length) throw new AllAccountsBusy("no Cloudflare account is configured (CLOUDFLARE_ACCOUNTS / CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)");

    const skipped: string[] = [];
    // Fixed at the top: `this.cursor` moves inside the loop when an account turns out to be
    // spent, and reading it each turn made the walk jump over the very next account.
    const start = this.cursor;
    for (let tried = 0; tried < this.states.length; tried++) {
      const index = (start + tried) % this.states.length;
      const state = this.states[index];
      if (state.restingUntil > now()) {
        skipped.push(`#${index + 1} ${state.reason}`);
        continue;
      }

      const started = now();
      let res: Response;
      try {
        res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${state.account.id}/ai/run/${MODEL}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${state.account.token}`, "Content-Type": "application/json" },
          // NO `seed` HERE, deliberately. FLUX-1-schnell's input schema on Workers AI is
          // { prompt, steps } and nothing else: sending a seed makes Cloudflare reject the
          // whole request with 5006 "Additional or unevaluated properties '/seed' at '/' not
          // allowed" (measured live, 2026-09-06). The parameter stays on this method because
          // the ladder's other rungs honour it and because the run log records it.
          body: JSON.stringify({ prompt, steps: Math.min(8, Math.max(1, opts.steps ?? 4)) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e: any) {
        // A network failure is this account's connection, not its quota — rest it briefly and
        // let the next account answer rather than failing the whole image.
        state.restingUntil = now() + RATE_LIMIT_REST_MS;
        state.reason = `network error (${String(e?.message ?? e).slice(0, 60)})`;
        skipped.push(`#${index + 1} ${state.reason}`);
        continue;
      }

      const body: any = await res.json().catch(() => ({}));
      const errors: { code?: number; message?: string }[] = Array.isArray(body?.errors) ? body.errors : [];
      const errorText = errors.map((e) => `${e?.code ?? ""} ${e?.message ?? ""}`).join("; ");

      // Quota BEFORE rate limit: Cloudflare returns the daily-quota error as a 429 carrying
      // code 4006, so testing the status first would rest a spent account for a minute and
      // then ask it again all day (caught by cloudflare.test.ts, not in production).
      const outOfQuota = errors.some((e) => e?.code === QUOTA_CODE) || (!res.ok && QUOTA_TEXT.test(errorText));
      if (!outOfQuota && (res.status === 429 || errors.some((e) => e?.code === 4004))) {
        state.restingUntil = now() + RATE_LIMIT_REST_MS;
        state.reason = "rate limited";
        skipped.push(`#${index + 1} rate limited`);
        continue;
      }

      if (outOfQuota) {
        state.restingUntil = nextUtcMidnight(now());
        state.reason = "daily neuron quota spent";
        console.log(`[cloudflare] account #${index + 1} is out of daily image quota — moving to the next one (${this.states.length - index - 1} left today)`);
        skipped.push(`#${index + 1} quota spent`);
        // The next account starts the next call, not this one — no point asking an empty one first.
        this.cursor = (index + 1) % this.states.length;
        continue;
      }

      if (!res.ok || body?.success === false) {
        // This request's own problem (a rejected prompt, a 5xx). Repeating it on every account
        // would spend the pool on the same failure.
        throw new Error(`Cloudflare ${res.status}${errorText ? ` — ${errorText}` : ""}`);
      }

      const b64 = body?.result?.image;
      if (typeof b64 !== "string" || !b64) throw new Error("Cloudflare returned no image");
      const neurons = Number(body?.result?.usage?.neurons) || 0;
      state.neuronsSeen += neurons;
      state.images += 1;
      this.cursor = index; // stay on the account that is working
      return { jpeg: Buffer.from(b64, "base64"), account: index + 1, neurons, ms: now() - started };
    }

    throw new AllAccountsBusy(skipped.join(", ") || "all accounts resting");
  }
}

let shared: CloudflarePool | null = null;

/** The process-wide pool, built from env on first use. */
export function cloudflarePool(): CloudflarePool {
  if (!shared) shared = new CloudflarePool(parseAccounts(env.CLOUDFLARE_ACCOUNTS, env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN));
  return shared;
}
