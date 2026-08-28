/** Run: cd agent-server && npx tsx --test src/lib/costLedger.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

const { withCostLedger, recordUsage, costForTokens } = await import("./costLedger.js");

test("costForTokens uses the default $0.3/M price when NIM_PRICE_PER_M_TOKENS is unset", () => {
  delete process.env.NIM_PRICE_PER_M_TOKENS;
  assert.equal(costForTokens(1_000_000), 0.3);
  assert.equal(costForTokens(500_000), 0.15);
});

test("costForTokens honours NIM_PRICE_PER_M_TOKENS when set", () => {
  process.env.NIM_PRICE_PER_M_TOKENS = "1";
  assert.equal(costForTokens(1_000_000), 1);
  delete process.env.NIM_PRICE_PER_M_TOKENS;
});

test("costForTokens is 0 for zero, negative or non-finite input", () => {
  assert.equal(costForTokens(0), 0);
  assert.equal(costForTokens(-5), 0);
  assert.equal(costForTokens(NaN), 0);
});

test("recordUsage outside any ledger is a silent no-op", () => {
  assert.doesNotThrow(() => recordUsage(500));
});

test("withCostLedger attributes every recordUsage call made inside fn, tokens and call count both", async () => {
  const { result, tokens, calls, costUsd } = await withCostLedger(async () => {
    recordUsage(1000);
    recordUsage(2000);
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(tokens, 3000);
  assert.equal(calls, 2);
  assert.equal(costUsd, costForTokens(3000));
});

test("withCostLedger follows async chains — a call made by an awaited helper is still attributed", async () => {
  async function helper() {
    await new Promise((r) => setTimeout(r, 1));
    recordUsage(750);
  }
  const { tokens } = await withCostLedger(async () => {
    await helper();
  });
  assert.equal(tokens, 750);
});

test("two concurrent ledgers do not leak into each other", async () => {
  const barrier = { a: false, b: false };
  const runA = withCostLedger(async () => {
    recordUsage(100);
    await new Promise((r) => setTimeout(r, 10));
    barrier.a = true;
    recordUsage(50);
  });
  const runB = withCostLedger(async () => {
    recordUsage(9000);
    await new Promise((r) => setTimeout(r, 1));
    barrier.b = true;
  });
  const [resA, resB] = await Promise.all([runA, runB]);
  assert.equal(resA.tokens, 150, "ledger A must not see ledger B's usage");
  assert.equal(resB.tokens, 9000, "ledger B must not see ledger A's usage");
});

test("a thrown error still carries the partial spend on .costLedger", async () => {
  await assert.rejects(
    withCostLedger(async () => {
      recordUsage(400);
      throw new Error("boom");
    }),
    (e: any) => {
      assert.equal(e.message, "boom");
      assert.deepEqual(e.costLedger, { tokens: 400, calls: 1, costUsd: costForTokens(400) });
      return true;
    }
  );
});

test("a non-object thrown value does not crash the attribution", async () => {
  await assert.rejects(
    withCostLedger(async () => {
      recordUsage(10);
      throw "just a string";
    })
  );
});

test("recordUsage ignores non-positive or non-finite token counts", async () => {
  const { tokens, calls } = await withCostLedger(async () => {
    recordUsage(0);
    recordUsage(-10);
    recordUsage(NaN);
    recordUsage(50);
  });
  assert.equal(tokens, 50);
  assert.equal(calls, 1);
});
