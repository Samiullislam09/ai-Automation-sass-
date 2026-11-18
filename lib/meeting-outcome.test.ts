import { test } from "node:test";
import assert from "node:assert/strict";
import { runManageMeetingOutcome, MEETING_OUTCOME_TOOLS, MANAGE_MEETING_OUTCOME } from "./meeting-outcome";
import { WRITE_TOOLS, isWriteTool } from "./chat-schedule-tools";

/** A tiny fake of the queries the tool makes. Records every update. */
function fakeDb(opts: { leads: any[]; meetings: any[] }) {
  const updates: { table: string; patch: any }[] = [];
  const db: any = {
    from(table: string) {
      const rows = table === "lead_meetings" ? opts.meetings : opts.leads;
      const q: any = {
        select() { return q; },
        eq() { return q; },
        neq() { return q; },
        order() { return q; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
        update(patch: any) { updates.push({ table, patch }); const u: any = { eq() { return u; }, then(res: any) { res({ error: null }); } }; return u; },
        then(res: any) { res({ data: rows, error: null }); },
      };
      return q;
    },
  };
  return { db, updates };
}

test("the owner says the lead did not come: the call is recorded as a no-show and the lead is flagged for a new time", async () => {
  const { db, updates } = fakeDb({ leads: [{ id: "L1", company: "Sainiul Traders", name: "Sainiul", stage: "meeting_done" }], meetings: [{ id: "M1", status: "done", start_at: "2026-11-16T15:00:00Z", outcome: "unconfirmed" }] });
  const r: any = await runManageMeetingOutcome(db, "t", { who: "sainul", outcome: "no_show" }); // a typo, still found
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.before, { status: "done", outcome: "unconfirmed", lead_stage: "meeting_done" });
  assert.deepEqual(r.data.after, { status: "no_show", outcome: "no_show", lead_stage: "in_conversation" });
  const meet = updates.find((u) => u.table === "lead_meetings")!.patch;
  assert.equal(meet.status, "no_show");
  assert.equal(meet.outcome, "no_show");
  const lead = updates.find((u) => u.table === "leads")!.patch;
  assert.equal(lead.stage, "in_conversation");
  assert.equal(lead.needs_attention, true);
  assert.match(lead.needs_attention_reason, /new time/);
});

test("attended is recorded too; and a missing outcome, a missing name, no match or two matches refuse instead of guessing", async () => {
  const one = fakeDb({ leads: [{ id: "L1", company: "Alpha Co", stage: "meeting_scheduled" }], meetings: [{ id: "M1", status: "scheduled", outcome: null }] });
  const ok: any = await runManageMeetingOutcome(one.db, "t", { who: "alpha co", outcome: "attended" });
  assert.equal(ok.data.after.lead_stage, "meeting_done");
  assert.equal(one.updates.find((u) => u.table === "leads")!.patch.needs_attention, false);
  assert.equal((await runManageMeetingOutcome(one.db, "t", { who: "alpha co" })).ok, false);
  assert.equal((await runManageMeetingOutcome(one.db, "t", { outcome: "no_show" })).ok, false);
  assert.match((await runManageMeetingOutcome(one.db, "t", { who: "zzzzzzzz", outcome: "no_show" })).note!, /No lead matches/);
  const two = fakeDb({ leads: [{ id: "1", company: "Falcon Mechanical" }, { id: "2", company: "Falcon Aerospace" }], meetings: [] });
  const amb = await runManageMeetingOutcome(two.db, "t", { who: "falcon", outcome: "no_show" });
  assert.equal(amb.ok, false);
  assert.match(amb.note!, /Ask which one/);
  assert.equal(two.updates.length, 0, "nothing was changed on an ambiguous name");
  const none = fakeDb({ leads: [{ id: "1", company: "Alpha Co" }], meetings: [] });
  assert.match((await runManageMeetingOutcome(none.db, "t", { who: "alpha", outcome: "no_show" })).note!, /no booked call/);
});

test("the tool is a write tool the router can reach, and it is not offered for questions", () => {
  assert.ok(WRITE_TOOLS.some((t) => t.function.name === MANAGE_MEETING_OUTCOME));
  assert.equal(isWriteTool(MANAGE_MEETING_OUTCOME), true);
  const d = MEETING_OUTCOME_TOOLS[0].function.description;
  for (const w of ["sainiul meeting me aya nahi", "no vino a la llamada", "he did not join"]) assert.ok(d.includes(w), w);
  assert.match(d, /NOT for asking whether a call happened/);
});
