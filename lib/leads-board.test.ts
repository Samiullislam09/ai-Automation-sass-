import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLeadsBoard } from "./leads-board";

/** A chainable fake of the few queries the board makes: every builder method returns itself and awaiting it yields the rows for that table. */
function fakeDb(tables: Record<string, { data?: any[]; error?: { message: string } | null }>) {
  const updates: any[] = [];
  const db: any = {
    from(table: string) {
      const t = tables[table] ?? { data: [] };
      const q: any = {
        select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
        update(patch: any) { updates.push({ table, patch }); const u: any = { eq() { return u; }, then(r: any) { r({ error: null }); } }; return u; },
        then(res: any) { res({ data: t.data ?? [], error: t.error ?? null }); },
      };
      return q;
    },
  };
  return { db, updates };
}

const LEADS = [
  { id: "a", company: "Alpha", stage: "approved", created_at: new Date().toISOString(), contacted_at: null, replied_at: null },
  { id: "b", company: "Beta", stage: "won", created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), contacted_at: null, replied_at: null },
  { id: "c", company: "Gamma", stage: "pending_approval", created_at: new Date().toISOString(), contacted_at: null, replied_at: null },
];

test("the board folds messages and meetings into each lead and totals them", async () => {
  const { db, updates } = fakeDb({
    leads: { data: LEADS.map((l) => ({ ...l })) },
    outreach_messages: { data: [
      { lead_id: "a", direction: "out", answered_by: "brain", body: "Hi there", created_at: "2026-11-18T10:00:00Z" },
      { lead_id: "a", direction: "in", answered_by: null, body: "Interested", created_at: "2026-11-18T11:00:00Z" },
    ] },
    jobs_log: { data: [] },
    lead_meetings: { data: [{ id: "m1", lead_id: "a", status: "scheduled", start_at: "2026-11-20T10:00:00Z", meet_link: "https://meet.google.com/x" }] },
  });
  const b: any = await loadLeadsBoard(db, "t1");
  assert.equal(b.ok, true);
  const a = b.leads.find((l: any) => l.id === "a");
  assert.equal(a.ai_messaged, true);
  assert.equal(a.messaged, true);
  assert.equal(a.last_in_body, "Interested");
  assert.equal(a.meeting.status, "scheduled");
  assert.equal(b.leads.find((l: any) => l.id === "b").converted, true);
  assert.equal(b.kpis.total, 3);
  assert.equal(b.kpis.client, 1);
  assert.equal(b.kpis.ai_messaged, 1);
  // a row left in the retired "pending_approval" stage is retired on read, once
  assert.equal(b.leads.find((l: any) => l.id === "c").stage, "approved");
  assert.equal(updates.filter((u) => u.table === "leads").length, 1);
  assert.equal(b.gen.running, false);
});

test("a database without the CRM tables, or any other error, is reported as a value, never thrown", async () => {
  const missing: any = await loadLeadsBoard(fakeDb({ leads: { error: { message: 'relation "leads" does not exist' } } }).db, "t1");
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 409);
  const broken: any = await loadLeadsBoard(fakeDb({ leads: { error: { message: "boom" } } }).db, "t1");
  assert.equal(broken.ok, false);
  assert.equal(broken.status, 500);
  assert.equal(broken.error, "boom");
});
