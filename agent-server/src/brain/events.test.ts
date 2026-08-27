/** What the live channel must never get wrong.
 *
 *  Two of these tests are really product rules wearing a test's clothes:
 *   - an agent's own words never become the user's sentence (`log` and `data` render nothing);
 *   - nothing but the fields we list reaches `payload`, so an agent returning a customer's
 *     credentials in its output cannot leak them into an event row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureEvents, emit, flush, userMessage, type LiveEvent } from "./events.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const TASK = "22222222-2222-2222-2222-222222222222";
const AT = "2026-08-27T10:00:00.000Z";

type Captured = { table: string; rows: any[] };

/** A Supabase stand-in that records inserts and never talks to a network. */
function fakeClient() {
  const inserts: Captured[] = [];
  const client: any = {
    from(table: string) {
      return {
        insert(rows: any[]) {
          inserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
      };
    },
    channel() {
      throw new Error("channelFor must not be used when a broadcast hook is injected");
    },
  };
  return { client, inserts };
}

function setup() {
  const { client, inserts } = fakeClient();
  const broadcasts: { tenantId: string; event: LiveEvent }[] = [];
  configureEvents({ client, broadcast: (tenantId, event) => broadcasts.push({ tenantId, event }) });
  return { inserts, broadcasts };
}

const agentEvent = (over: Partial<any> = {}): LiveEvent =>
  ({
    type: "data",
    run_id: "run_1",
    tenant_id: TENANT,
    agent_id: "keyword",
    at: AT,
    task_id: TASK,
    kind: "keyword",
    payload: { kw: "solar panel cost dubai", vol: 1200 },
    ...over,
  }) as LiveEvent;

test("an event is broadcast immediately and persisted on flush", async () => {
  const { inserts, broadcasts } = setup();

  emit(agentEvent());
  assert.equal(broadcasts.length, 1, "broadcast happens synchronously, not on the flush timer");
  assert.equal(broadcasts[0].tenantId, TENANT);
  assert.equal(inserts.length, 0, "nothing is written until the batch flushes");

  await flush();
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "task_events");
  assert.equal(inserts[0].rows.length, 1);
  assert.equal(inserts[0].rows[0].kind, "data");
  assert.equal(inserts[0].rows[0].task_id, TASK);
});

test("many events become one insert, not one insert each", async () => {
  const { inserts } = setup();
  for (let i = 0; i < 12; i++) emit(agentEvent({ payload: { kw: `kw ${i}` } }));
  await flush();
  assert.equal(inserts.length, 1, "12 events, 1 round trip");
  assert.equal(inserts[0].rows.length, 12);
});

test("agent chatter never becomes a user-facing sentence", () => {
  // The whole point of the do-channel rule: only the system says what happened.
  const silent: LiveEvent[] = [
    agentEvent({ type: "log", level: "info", message_dev: "calling NIM with 4 messages" } as any),
    agentEvent({ type: "data", kind: "section", payload: { h2: "Cost" } }),
    agentEvent({ type: "run_started", action: "find_keywords" } as any),
    agentEvent({ type: "step_finished", step_id: "research", ms: 900 } as any),
    agentEvent({ type: "run_finished", output: {}, ms: 10, cost_units: 1, llm_calls: 1, tokens_in: 5, tokens_out: 6 } as any),
  ];
  for (const e of silent) assert.equal(userMessage(e), null, `${e.type} must render no sentence`);
});

test("the sentences a user does read come from the system's own fields", () => {
  assert.equal(
    userMessage({ type: "task_created", task_id: TASK, tenant_id: TENANT, at: AT, echo: "1 article on solar, Approvals me", outline: [] }),
    "1 article on solar, Approvals me",
  );
  assert.equal(
    userMessage({ type: "task_scheduled", task_id: TASK, tenant_id: TENANT, at: AT, run_at: AT, human: "kal subah 9 baje" }),
    "Booked — kal subah 9 baje",
  );
  assert.equal(userMessage({ type: "task_started", task_id: TASK, tenant_id: TENANT, at: AT, steps: 1 }), "On it — 1 step");
  assert.equal(userMessage({ type: "task_started", task_id: TASK, tenant_id: TENANT, at: AT, steps: 4 }), "On it — 4 steps");
  assert.equal(
    userMessage({ type: "task_finished", task_id: TASK, tenant_id: TENANT, at: AT, status: "published", ms: 1 }),
    "Live on your site",
  );
  assert.equal(
    userMessage({ type: "task_finished", task_id: TASK, tenant_id: TENANT, at: AT, status: "done", ms: 1 }),
    "Done",
  );
});

test("payload carries only the fields we name — an agent cannot smuggle its output into the log", async () => {
  const { inserts } = setup();

  emit(
    agentEvent({
      type: "run_finished",
      output: { wordpressPassword: "hunter2", body: "…3000 words…" },
      ms: 1200,
      cost_units: 40,
      llm_calls: 6,
      tokens_in: 900,
      tokens_out: 1500,
    } as any),
  );
  await flush();

  const row = inserts[0].rows[0];
  assert.deepEqual(Object.keys(row.payload).sort(), ["cost_units", "llm_calls", "ms", "tokens_in", "tokens_out"]);
  const serialised = JSON.stringify(row);
  assert.equal(serialised.includes("hunter2"), false, "the agent's output must not reach the event row");
  assert.equal(serialised.includes("3000 words"), false);
});

test("a data event keeps its kind so the UI can pick a renderer", async () => {
  const { inserts } = setup();
  emit(agentEvent({ kind: "keyword", payload: { kw: "solar", vol: 90 } }));
  await flush();
  assert.deepEqual(inserts[0].rows[0].payload, { data_kind: "keyword", payload: { kw: "solar", vol: 90 } });
});

test("a failing database never breaks the work being described", async () => {
  const broadcasts: unknown[] = [];
  const client: any = {
    from: () => ({ insert: () => Promise.resolve({ error: { message: "connection reset" } }) }),
    channel() {
      throw new Error("not used");
    },
  };
  configureEvents({ client, broadcast: (_t, e) => broadcasts.push(e) });

  emit(agentEvent());
  await flush(); // must resolve, not reject
  assert.equal(broadcasts.length, 1);
});

test("an event with no tenant is dropped rather than written to nobody", async () => {
  const { inserts, broadcasts } = setup();
  emit(agentEvent({ tenant_id: "" }));
  await flush();
  assert.equal(broadcasts.length, 0);
  assert.equal(inserts.length, 0);
});
