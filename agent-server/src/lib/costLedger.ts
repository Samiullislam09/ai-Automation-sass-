import { AsyncLocalStorage } from "node:async_hooks";

/** MASTER_PLAN §13 Phase 4's "cost dashboard" — the capture half. §12's own estimate was
 *  "$0.3-1/M tokens" (DeepSeek-class pricing on NIM); NIM_PRICE_PER_M_TOKENS lets that number
 *  be corrected once real invoiced pricing is known, without touching code.
 *
 *  Attribution works via AsyncLocalStorage rather than threading a "record this cost"
 *  parameter through every agent's own LLM calls (writer's 6 calls, keyword's several,
 *  seo's, leads', ...): nvidia.ts is already the one door every NVIDIA call goes through
 *  (see its own header comment), so recordUsage() there is enough — whichever job's
 *  withCostLedger() is currently on the call stack (however many awaits deep) is the one
 *  that gets it, because AsyncLocalStorage follows the async chain, not the literal call site.
 *
 *  A call made with no ledger open (a one-off script, a request outside a job) simply isn't
 *  recorded — cost tracking is additive, never a requirement to run.
 */

const DEFAULT_PRICE_PER_M = 0.3;

function pricePerMillionTokens(): number {
  const raw = Number(process.env.NIM_PRICE_PER_M_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PRICE_PER_M;
}

export function costForTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1_000_000) * pricePerMillionTokens();
}

type Ledger = { tokens: number; calls: number };

const storage = new AsyncLocalStorage<Ledger>();

export type CostSnapshot = { tokens: number; calls: number; costUsd: number };

function snapshot(ledger: Ledger): CostSnapshot {
  return { tokens: ledger.tokens, calls: ledger.calls, costUsd: costForTokens(ledger.tokens) };
}

/** Runs `fn` with a fresh ledger open. On success, the snapshot covers every NVIDIA call made
 *  anywhere inside `fn` (including ones made by code it calls, however deep). On failure, the
 *  partial snapshot — whatever was actually spent before the throw — is attached to the
 *  rethrown error as `.costLedger`, so a caller logging the failure can still report it: a job
 *  that fails on its last LLM call still spent money on the ones before it. */
export async function withCostLedger<T>(fn: () => Promise<T>): Promise<{ result: T } & CostSnapshot> {
  const ledger: Ledger = { tokens: 0, calls: 0 };
  try {
    const result = await storage.run(ledger, fn);
    return { result, ...snapshot(ledger) };
  } catch (e: any) {
    if (e && typeof e === "object") e.costLedger = snapshot(ledger);
    throw e;
  }
}

/** Called from nvidia.ts after every successful NVIDIA response that carries a `usage.
 *  total_tokens` field. A no-op outside any withCostLedger() — see the file header. */
export function recordUsage(tokens: number): void {
  const ledger = storage.getStore();
  if (!ledger || !Number.isFinite(tokens) || tokens <= 0) return;
  ledger.tokens += tokens;
  ledger.calls += 1;
}
