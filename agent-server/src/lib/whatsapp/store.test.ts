/** Run: cd agent-server && npx tsx --test src/lib/whatsapp/store.test.ts
 *
 *  These cover the two things in the WhatsApp store that are logic rather than plumbing, and both
 *  are things that go wrong quietly: matching an inbound number to the right lead across two
 *  systems' formatting, and never letting a message status or a lead stage move backward. The
 *  socket wiring itself needs a real phone and is not unit-tested here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { linkIncoming, recordSentStatus, recordOutgoing } = await import("./store.js");

/** A tiny Supabase stand-in recording what each table was asked to do. Enough for these three
 *  functions: select().eq() chains that resolve to seeded rows, insert/update/upsert captured. */
function fakeDb(seed: { leads?: any[]; messages?: any[] } = {}) {
  const state = { leads: seed.leads ?? [], messages: seed.messages ?? [], inserts: [] as any[], updates: [] as any[] };
  const db: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        _filters: {} as Record<string, any>,
        _in: null as null | { col: string; vals: any[] },
        select() { return q; },
        eq(col: string, val: any) { q._filters[col] = val; return q; },
        is(col: string, _v: null) { q._filters[col] = "__null__"; return q; },
        in(col: string, vals: any[]) { q._in = { col, vals }; return q; },
        maybeSingle() { return Promise.resolve({ data: rowsFor(q)[0] ?? null, error: null }); },
        then(resolve: any) { resolve({ data: rowsFor(q), error: null }); },
        insert(row: any) { state.inserts.push({ table, row }); (table === "leads" ? state.leads : state.messages).push({ ...row }); return Promise.resolve({ error: null }); },
        update(patch: any) {
          // Real Supabase returns a filter builder from .update(), so .eq()/.in() chain AFTER
          // it. Apply on the next tick (await), reading the filters set by those chained calls.
          state.updates.push({ table, patch, filters: q._filters, in: q._in });
          // A PLAIN thenable, not a real Promise: await unwraps a native Promise via its internal
          // slot and ignores a monkey-patched .then, so the chained .eq()/.in() would set filters
          // that the patch application never saw. A bare object with .then lets await use ours.
          const p2: any = {
            eq(c: string, v: any) { q._filters[c] = v; return p2; },
            in(c: string, v: any[]) { q._in = { col: c, vals: v }; return p2; },
            then(resolve: any) { for (const r of rowsFor(q)) Object.assign(r, patch); resolve({ error: null }); },
          };
          return p2;
        },
        upsert(row: any) { state.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
      };
      const rowsFor = (qq: any) => {
        let rows = table === "leads" ? state.leads : table === "outreach_messages" ? state.messages : [];
        for (const [c, v] of Object.entries(qq._filters)) {
          rows = rows.filter((r: any) => (v === "__null__" ? r[c] == null : r[c] === v));
        }
        if (qq._in) rows = rows.filter((r: any) => qq._in.vals.includes(r[qq._in.col]));
        return rows;
      };
      return q;
    },
  };
  return { db, state };
}

const TENANT = "t1";

test("an inbound number matches its lead across different phone formatting", async () => {
  const { db, state } = fakeDb({
    leads: [{ id: "L1", tenant_id: "t1", stage: "contacted", whatsapp: "+971 50 123 4567", phone: null }],
  });
  await linkIncoming(db, TENANT, { phone: "971501234567", text: "haan bhejo", waMessageId: "W1" });

  const stored = state.inserts.find((i) => i.table === "outreach_messages");
  assert.ok(stored, "the inbound message was stored");
  assert.equal(stored.row.lead_id, "L1");
  assert.equal(stored.row.direction, "in");
  const lead = state.leads[0];
  assert.equal(lead.stage, "replied", "a contacted lead that replies moves to replied");
});

test("an inbound from an unknown number is not forced onto some other lead", async () => {
  const { db, state } = fakeDb({ leads: [{ id: "L1", tenant_id: "t1", stage: "contacted", whatsapp: "+971500000001" }] });
  await linkIncoming(db, TENANT, { phone: "919999999999", text: "who is this", waMessageId: "W2" });
  assert.equal(state.inserts.length, 0, "no message stored against a wrong lead");
});

test("a reply never drags a lead backward from a later stage", async () => {
  const { db, state } = fakeDb({ leads: [{ id: "L1", tenant_id: "t1", stage: "won", whatsapp: "971501234567" }] });
  await linkIncoming(db, TENANT, { phone: "971501234567", text: "thanks", waMessageId: "W3" });
  assert.equal(state.leads[0].stage, "won", "a won lead stays won");
});

test("read receipt beats delivered, and a late delivered cannot undo a read", async () => {
  const { db, state } = fakeDb({
    messages: [{ id: "M1", tenant_id: "t1", status: "sent", lead_id: "L1", wa_message_id: "W1" }],
  });
  await recordSentStatus(db, TENANT, "W1", "read");
  assert.equal(state.messages[0].status, "read");
  await recordSentStatus(db, TENANT, "W1", "delivered"); // arrives late, out of order
  assert.equal(state.messages[0].status, "read", "read is not overwritten by a late delivered");
});

test("first outbound moves an approved lead to contacted and stamps it", async () => {
  const { db, state } = fakeDb({ leads: [{ id: "L1", tenant_id: "t1", stage: "approved", contacted_at: null, follow_up_count: 0 }] });
  await recordOutgoing(db, TENANT, "L1", "namaste", "W9", "human");

  const out = state.inserts.find((i) => i.table === "outreach_messages");
  assert.equal(out.row.direction, "out");
  assert.equal(out.row.answered_by, "human");
  assert.equal(state.leads[0].stage, "contacted");
  assert.ok(state.leads[0].contacted_at, "contacted_at stamped on first message");
});

test("a second outbound counts a follow-up instead of re-contacting", async () => {
  const { db, state } = fakeDb({
    leads: [{ id: "L1", tenant_id: "t1", stage: "replied", contacted_at: "2026-09-30T00:00:00Z", follow_up_count: 0 }],
  });
  await recordOutgoing(db, TENANT, "L1", "reminder", "W10", "human");
  assert.equal(state.leads[0].stage, "replied", "already-contacted lead keeps its stage");
  assert.equal(state.leads[0].follow_up_count, 1, "the follow-up is counted");
});
