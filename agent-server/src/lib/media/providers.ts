/** Where an actual picture comes from, in order, and what happens when none of them can give
 *  one (MASTER_PLAN §19.4.4).
 *
 *  The ladder, and why it is in this order:
 *    1. Cloudflare Workers AI (lib/media/cloudflare.ts) — 3.7s, and a pool of accounts so one
 *       account's daily quota is not the platform's daily quota.
 *    2. NVIDIA NIM — the same FLUX model on the key this server already has. Measured at over
 *       120s on the free queue (§19.1), so it is only tried when the caller says there is time.
 *    3. Stock (Unsplash, then Pexels) — a real photograph, for the businesses where an AI
 *       image is the wrong answer anyway (a clinic, a restaurant). Attribution comes back with
 *       it and is stored, because those licences ask for it.
 *    4. — there is no rung 4 here. The template card is lib/media/render.ts's job and it needs
 *       nothing from the network, so it belongs to the caller, not to this file. That
 *       separation is what makes "an image is always produced" true by construction.
 *
 *  Nothing here throws for a missing key or an empty pool: an absent provider is a rung that
 *  is skipped, and the reason is returned so the run log can say which rungs were tried.
 */

import { env } from "../../env.js";
import { cloudflarePool, AllAccountsBusy } from "./cloudflare.js";
import { nvidiaFetch } from "../nvidia.js";

export type Provider = "cloudflare" | "nvidia" | "unsplash" | "pexels";

export type GeneratedImage = {
  /** JPEG or PNG bytes, whatever the provider returned. render.ts turns it into WebP. */
  bytes: Buffer;
  provider: Provider;
  /** Which account of the Cloudflare pool answered (1-based). Null for every other provider. */
  account: number | null;
  /** What the provider itself said it cost. 0 for stock. */
  neurons: number;
  /** Photographer credit, when the licence asks for one. */
  attribution: string | null;
  ms: number;
};

export type GenerateOptions = {
  /** Try NVIDIA when Cloudflare cannot answer. Only for jobs that can wait two minutes. */
  allowSlow?: boolean;
  /** Let a real photograph stand in for a generated one. Set for `photo` style, not for
   *  illustrations — a stock photo where an illustration was wanted looks like a mistake. */
  allowStock?: boolean;
  /** What to search stock for, if it comes to that: the plan's `depicts`, which is in the
   *  article's own words, rather than the full prompt (which is full of negative terms). */
  stockQuery?: string;
  fetchImpl?: typeof fetch;
};

/** Every rung that was tried and why it did not answer — so a run can say "Cloudflare is out
 *  of quota for today, NVIDIA was not allowed on this job, no stock key" instead of "failed". */
export class NoProviderAnswered extends Error {
  constructor(public readonly tried: string[]) {
    super(`No image provider could produce an image — ${tried.join("; ")}`);
    this.name = "NoProviderAnswered";
  }
}

const NVIDIA_IMAGE_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell";
const NVIDIA_TIMEOUT_MS = 120_000;
const STOCK_TIMEOUT_MS = 15_000;

export async function generateImage(prompt: string, seed: number, opts: GenerateOptions = {}): Promise<GeneratedImage> {
  const tried: string[] = [];

  // ── 1 · Cloudflare ────────────────────────────────────────────────────────────────────
  const pool = cloudflarePool();
  if (pool.size === 0) {
    tried.push("Cloudflare: no account configured");
  } else {
    try {
      const r = await pool.image(prompt, seed, { fetchImpl: opts.fetchImpl });
      return { bytes: r.jpeg, provider: "cloudflare", account: r.account, neurons: r.neurons, attribution: null, ms: r.ms };
    } catch (e: any) {
      tried.push(e instanceof AllAccountsBusy ? `Cloudflare: ${e.message}` : `Cloudflare: ${e?.message ?? e}`);
    }
  }

  // ── 2 · NVIDIA, only where the wait is affordable ─────────────────────────────────────
  if (!opts.allowSlow) {
    tried.push("NVIDIA: not tried (this job cannot wait two minutes for the free queue)");
  } else if (!env.NVIDIA_API_KEY && !env.NVIDIA_API_KEYS_BG) {
    tried.push("NVIDIA: no key configured");
  } else {
    const started = Date.now();
    try {
      const res = await nvidiaFetch(NVIDIA_IMAGE_URL, {
        label: "image",
        method: "POST",
        retries: 1,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ prompt: prompt.slice(0, 1000), seed: seed % 4_294_967_295, steps: 4 }),
        signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS),
      });
      const body: any = await res.json().catch(() => ({}));
      const b64 = body?.artifacts?.[0]?.base64 ?? body?.image ?? body?.images?.[0];
      if (res.ok && typeof b64 === "string" && b64) {
        return { bytes: Buffer.from(b64, "base64"), provider: "nvidia", account: null, neurons: 0, attribution: null, ms: Date.now() - started };
      }
      tried.push(`NVIDIA: ${res.status}${body?.detail ? ` ${String(body.detail).slice(0, 80)}` : " no image in the reply"}`);
    } catch (e: any) {
      tried.push(`NVIDIA: ${String(e?.message ?? e).slice(0, 90)}`);
    }
  }

  // ── 3 · a real photograph ─────────────────────────────────────────────────────────────
  if (!opts.allowStock) {
    tried.push("stock: not allowed for this style");
  } else {
    const query = (opts.stockQuery ?? "").trim();
    if (!query) {
      tried.push("stock: nothing to search for");
    } else {
      const stock = await fromStock(query, opts.fetchImpl);
      if ("bytes" in stock) return stock;
      tried.push(stock.why);
    }
  }

  throw new NoProviderAnswered(tried);
}

/** Unsplash first (its licence is the friendliest), then Pexels. Returns the reason it could
 *  not, rather than throwing, so the ladder above can report every rung it tried. */
async function fromStock(query: string, fetchImpl: typeof fetch = fetch): Promise<GeneratedImage | { why: string }> {
  const reasons: string[] = [];

  if (env.UNSPLASH_ACCESS_KEY) {
    const started = Date.now();
    try {
      const res = await fetchImpl(`https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
        signal: AbortSignal.timeout(STOCK_TIMEOUT_MS),
      });
      const body: any = await res.json().catch(() => ({}));
      const hit = body?.results?.[0];
      if (res.ok && hit?.urls?.regular) {
        const img = await fetchImpl(hit.urls.regular, { signal: AbortSignal.timeout(STOCK_TIMEOUT_MS) });
        if (img.ok) {
          const bytes = Buffer.from(await img.arrayBuffer());
          const who = hit?.user?.name ?? "an Unsplash photographer";
          return { bytes, provider: "unsplash", account: null, neurons: 0, attribution: `Photo by ${who} on Unsplash`, ms: Date.now() - started };
        }
      }
      reasons.push(`Unsplash: ${res.status}${hit ? " (image download failed)" : " (no match)"}`);
    } catch (e: any) {
      reasons.push(`Unsplash: ${String(e?.message ?? e).slice(0, 60)}`);
    }
  } else {
    reasons.push("Unsplash: no key");
  }

  if (env.PEXELS_API_KEY) {
    const started = Date.now();
    try {
      const res = await fetchImpl(`https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`, {
        headers: { Authorization: env.PEXELS_API_KEY },
        signal: AbortSignal.timeout(STOCK_TIMEOUT_MS),
      });
      const body: any = await res.json().catch(() => ({}));
      const hit = body?.photos?.[0];
      if (res.ok && hit?.src?.large) {
        const img = await fetchImpl(hit.src.large, { signal: AbortSignal.timeout(STOCK_TIMEOUT_MS) });
        if (img.ok) {
          const bytes = Buffer.from(await img.arrayBuffer());
          return { bytes, provider: "pexels", account: null, neurons: 0, attribution: `Photo by ${hit?.photographer ?? "a Pexels photographer"} on Pexels`, ms: Date.now() - started };
        }
      }
      reasons.push(`Pexels: ${res.status}${hit ? " (image download failed)" : " (no match)"}`);
    } catch (e: any) {
      reasons.push(`Pexels: ${String(e?.message ?? e).slice(0, 60)}`);
    }
  } else {
    reasons.push("Pexels: no key");
  }

  return { why: reasons.join(", ") };
}
