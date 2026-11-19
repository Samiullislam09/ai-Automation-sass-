import { test } from "node:test";
import assert from "node:assert/strict";
import { countContentItems } from "./content-list";

function fake(res: { count: number | null; error?: any }, seen: { head?: boolean; filters: Record<string, unknown> }) {
  const q: any = {
    select(_c: string, o?: any) { seen.head = o?.head === true; return q; },
    eq(k: string, v: unknown) { seen.filters[k] = v; return q; },
    then(r: any) { r({ count: res.count, error: res.error ?? null }); },
  };
  return { from: () => q } as any;
}

test("the sidebar badge reads a count only: a head query, scoped to the tenant and the status, never the rows", async () => {
  const seen: any = { filters: {} };
  assert.equal(await countContentItems(fake({ count: 7 }, seen), "t1"), 7);
  assert.equal(seen.head, true, "no rows are fetched");
  assert.deepEqual(seen.filters, { tenant_id: "t1", status: "awaiting_approval" });
});

test("it never promises more than the Approvals page lists (100), and an error is null, not a made-up 0", async () => {
  assert.equal(await countContentItems(fake({ count: 250 }, { filters: {} }), "t1"), 100);
  assert.equal(await countContentItems(fake({ count: null, error: { message: "x" } }, { filters: {} }), "t1"), null);
});
