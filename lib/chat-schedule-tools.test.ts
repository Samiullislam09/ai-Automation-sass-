/** The write tools: the guard that stops one timetable being rewritten when another was meant.
 *
 *  These assert the CONTRACT — schema, refusals, what the result block says — not the model's
 *  judgement. The judgement is the other half and has to be checked against the live model; what
 *  is recorded here is the sentence that broke it, so the next person does not have to find it
 *  again:
 *
 *      "ispe ek new task add karo ok mujhe har roz mere site ka audit rport batana ok possible ha"
 *
 *  Before 2026-09-28 that sentence reached `parseScheduleCommand`, which read "har roz" as
 *  frequency=daily, never saw the word "audit", and wrote it to the customer's ARTICLE row. They
 *  were told "Saved — every day … 2 articles per run" and their weekly schedule had become a
 *  daily one. The tests below are the structural reasons that cannot happen through the tool:
 *  `kind` is required, an unknown kind refuses instead of defaulting, and a successful write
 *  reports what it changed FROM as well as to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANAGE_SCHEDULE,
  WRITE_PREFIX,
  WRITE_TOOLS,
  isWriteTool,
  runWriteTool,
  writeResultBlock,
} from "./chat-schedule-tools";
import { isReadTool } from "./chat-data-tools";

const TENANT = "11111111-1111-1111-1111-111111111111";

/* ── a Supabase stand-in: only the two calls these tools make ───────────────────────────── */

type Row = Record<string, any>;

function fakeDb(rows: Row[] = [], opts: { upsertError?: string } = {}) {
  const state = { rows: [...rows], upserts: [] as Row[] };
  const db = {
    from() {
      const q: any = {
        _kind: undefined as string | undefined,
        select() { return q; },
        eq(col: string, val: string) { if (col === "kind") q._kind = val; return q; },
        limit() {
          return Promise.resolve({ data: state.rows.filter((r) => r.kind === q._kind), error: null });
        },
        upsert(row: Row) {
          if (opts.upsertError) return Promise.resolve({ error: { message: opts.upsertError } });
          state.upserts.push(row);
          const i = state.rows.findIndex((r) => r.kind === row.kind);
          if (i >= 0) state.rows[i] = { ...state.rows[i], ...row };
          else state.rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { db: db as any, state };
}

/** The customer's real timetable on the morning this broke: two articles, every Monday, 9am. */
const WEEKLY_ARTICLES: Row = {
  tenant_id: TENANT, kind: "article", enabled: true, frequency: "weekly", day_of_week: 1,
  time_of_day: "09:00", timezone: "Asia/Calcutta", count: 2, auto_publish: false,
};

/* ── shape ───────────────────────────────────────────────────────────────────────────────── */

test("every write tool is named like one, and is never mistaken for a read", () => {
  assert.ok(WRITE_TOOLS.length >= 1);
  for (const t of WRITE_TOOLS) {
    assert.ok(t.function.name.startsWith(WRITE_PREFIX), `${t.function.name} is not prefixed`);
    assert.equal(isWriteTool(t.function.name), true);
    assert.equal(isReadTool(t.function.name), false, "a write must never route as a read");
  }
  for (const name of ["lookup_content", "lookup_schedule", "write_article", "answer_question"]) {
    assert.equal(isWriteTool(name), false, `${name} must not route as a write`);
  }
});

test("kind is the one required field — the model cannot write a schedule without naming it", () => {
  const spec = WRITE_TOOLS.find((t) => t.function.name === MANAGE_SCHEDULE)!;
  assert.deepEqual(spec.function.parameters.required, ["kind"]);
  const kind = spec.function.parameters.properties.kind as any;
  assert.ok(Array.isArray(kind.enum) && kind.enum.includes("article") && kind.enum.includes("audit"));
});

test("the description says it is the repeating timetable, not a one-off run", () => {
  const spec = WRITE_TOOLS.find((t) => t.function.name === MANAGE_SCHEDULE)!;
  assert.match(spec.function.description, /NOT A ONE-OFF/);
  // and it carries the customer's own Hinglish, not only English
  assert.match(spec.function.description, /har roz|roz subah/i);
});

/* ── the refusals, which are the whole point ─────────────────────────────────────────────── */

test("a kind this product cannot schedule REFUSES — it never falls back to the article row", async () => {
  const { db, state } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(MANAGE_SCHEDULE, { kind: "leads", frequency: "daily" }, db, TENANT);

  assert.equal(res.ok, false);
  assert.match(res.note!, /not something this product can put on a timetable/);
  assert.match(res.note!, /article/);
  assert.match(res.note!, /audit/);
  assert.equal(state.upserts.length, 0, "a refused kind must write NOTHING");
  assert.equal(state.rows[0].frequency, "weekly", "the article timetable must be untouched");
});

test("a missing kind refuses too, rather than defaulting to whatever row exists", async () => {
  const { db, state } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(MANAGE_SCHEDULE, { frequency: "daily" }, db, TENANT);
  assert.equal(res.ok, false);
  assert.match(res.note!, /No kind of schedule was named/);
  assert.equal(state.upserts.length, 0);
  assert.equal(state.rows[0].frequency, "weekly");
});

test("THE 2026-09-28 SENTENCE: a daily audit leaves the weekly article schedule alone", async () => {
  const { db, state } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(
    MANAGE_SCHEDULE,
    { kind: "audit", frequency: "daily", time_of_day: "09:00" },
    db,
    TENANT
  );

  assert.equal(res.ok, true);
  const article = state.rows.find((r) => r.kind === "article")!;
  assert.equal(article.frequency, "weekly", "the article row is what was wrongly rewritten before");
  assert.equal(article.count, 2);

  const audit = state.rows.find((r) => r.kind === "audit")!;
  assert.equal(audit.frequency, "daily");
  assert.equal(audit.enabled, true, "setting a time turns a timetable on");
});

test("an audit schedule never reports an article count, because it writes no articles", async () => {
  const { db } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(
    MANAGE_SCHEDULE,
    { kind: "audit", frequency: "daily", time_of_day: "09:00", count: 2, auto_publish: true },
    db,
    TENANT
  );
  const d = res.data as any;
  assert.equal(d.after.articles_per_run, undefined);
  assert.equal(d.after.goes_to, undefined);
  // …and the fields that could not apply are said out loud rather than dropped in silence.
  assert.ok(d.ignored_because_they_do_not_apply?.length);
  assert.match(JSON.stringify(d.ignored_because_they_do_not_apply), /count/);
});

test("a bad time or frequency changes nothing and says which value was wrong", async () => {
  const { db, state } = fakeDb([WEEKLY_ARTICLES]);

  const badTime = await runWriteTool(MANAGE_SCHEDULE, { kind: "article", time_of_day: "9am" }, db, TENANT);
  assert.equal(badTime.ok, false);
  assert.match(badTime.note!, /9am/);

  const badFreq = await runWriteTool(MANAGE_SCHEDULE, { kind: "article", frequency: "fortnightly" }, db, TENANT);
  assert.equal(badFreq.ok, false);
  assert.match(badFreq.note!, /fortnightly/);

  assert.equal(state.upserts.length, 0);
});

/* ── reporting what moved ────────────────────────────────────────────────────────────────── */

test("a successful change reports what it was BEFORE, not only what it is now", async () => {
  const { db } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(MANAGE_SCHEDULE, { kind: "article", frequency: "daily" }, db, TENANT);
  const d = res.data as any;

  assert.match(d.before.when, /every Monday/);
  assert.match(d.after.when, /every day/);
  assert.deepEqual(d.changed, ["weekly → daily"]);
});

test("a change that changes nothing says so instead of confirming a save", async () => {
  const { db } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(MANAGE_SCHEDULE, { kind: "article", frequency: "weekly", day_of_week: 1 }, db, TENANT);
  assert.deepEqual((res.data as any).changed, []);
  assert.match(writeResultBlock(res), /If `changed` is empty/);
});

test("a failed write forbids saying it was saved", async () => {
  const { db } = fakeDb([WEEKLY_ARTICLES], { upsertError: "permission denied" });
  const res = await runWriteTool(MANAGE_SCHEDULE, { kind: "article", frequency: "daily" }, db, TENANT);
  const block = writeResultBlock(res);

  assert.equal(res.ok, false);
  assert.match(block, /NOTHING WAS CHANGED/);
  assert.match(block, /Do NOT say saved, done, set, ho gaya, kar diya/);
});

test("a database still missing migration 027 names the migration rather than blaming the customer", async () => {
  const { db } = fakeDb([], { upsertError: 'new row violates check constraint "schedules_kind_check"' });
  const res = await runWriteTool(MANAGE_SCHEDULE, { kind: "audit", frequency: "daily" }, db, TENANT);
  assert.equal(res.ok, false);
  assert.match(res.note!, /027_schedule_audit_kind\.sql/);
});

test("the result block forbids claiming the work itself ran", async () => {
  const { db } = fakeDb([WEEKLY_ARTICLES]);
  const res = await runWriteTool(MANAGE_SCHEDULE, { kind: "audit", frequency: "daily", time_of_day: "09:00" }, db, TENANT);
  const block = writeResultBlock(res);
  assert.match(block, /STANDING instruction/);
  assert.match(block, /audit kar diya/);
  assert.match(block, /naming WHICH schedule this was and WHAT MOVED/);
});
