/**
 * lib/live.test.ts — the guard on the workspace's state machine.
 *
 *   npx tsx --test lib/live.test.ts
 *
 * `foldEvents` is pure on purpose: no React, no Supabase, no browser. Everything the live
 * panel shows is a function of these assertions, and three of them are honesty rules from
 * MASTER_PLAN §24.5 rather than correctness rules:
 *
 *   - a `log` event produces NO user-visible sentence (the do-channel rule: agents write
 *     developer strings, the system writes what a person reads);
 *   - `lastEventAt` moves only when an event actually arrives, because that number is the
 *     only thing gating every animation in the UI;
 *   - an unknown `data.kind` renders, it does not throw — the panel must never be blank
 *     because an agent shipped something new.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldEvents,
  foldAll,
  hydrateTask,
  eventFromRow,
  userMessage,
  emptyLive,
  isFlowing,
  elapsedMs,
  clock,
  STALL_MS,
  type IncomingEvent,
  type LiveState,
  type RecordedRow,
} from "./live";

const TASK = "task-1";
const TENANT = "tenant-1";
const T0 = Date.parse("2026-08-27T10:00:00.000Z");

const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

/** An agent event, with the fields the contract requires already filled in. */
function ev(partial: any, offsetMs = 0): IncomingEvent {
  return {
    run_id: "run-1",
    tenant_id: TENANT,
    agent_id: "keyword",
    task_id: TASK,
    at: iso(offsetMs),
    ...partial,
  } as IncomingEvent;
}

/** A task-level event (no run_id / agent_id — a task exists before an agent is chosen). */
function tev(partial: any, offsetMs = 0): IncomingEvent {
  return { tenant_id: TENANT, task_id: TASK, at: iso(offsetMs), ...partial } as IncomingEvent;
}

const one = (s: LiveState) => s.byTask[TASK];

/* ── 1 · Out-of-order arrival ────────────────────────────────────────────────────────────
 * Broadcast is fire-and-forget: nothing guarantees order. A finish that overtakes its start
 * must leave the step finished, and the late start may only fill in what it was carrying. */

test("out of order: step_finished before step_started leaves the step done", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "step_finished", step_id: "s1", ms: 4200 }, 5000));
  s = foldEvents(s, ev({ type: "step_started", step_id: "s1", label: "Top 10 pages padh raha hun" }, 1000));

  const step = one(s).steps[0];
  assert.equal(step.status, "done", "the late start must not rewind a finished step");
  assert.equal(step.label, "Top 10 pages padh raha hun", "but it still contributes its label");
  assert.equal(step.ms, 4200);
  assert.equal(step.startedAt, T0 + 1000);
});

test("out of order: a stale progress event never rewinds the bar", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "step_started", step_id: "s1", label: "Research" }, 0));
  s = foldEvents(s, ev({ type: "progress", step_id: "s1", fraction: 0.8, label: "8/10 pages" }, 4000));
  s = foldEvents(s, ev({ type: "progress", step_id: "s1", fraction: 0.4, label: "4/10 pages" }, 2000));

  const step = one(s).steps[0];
  assert.equal(step.fraction, 0.8);
  assert.equal(step.progressLabel, "8/10 pages");
});

test("out of order: data items are placed by their own timestamp, not by arrival", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "data", kind: "keyword", payload: { kw: "solar panel cost dubai", vol: 1200 } }, 3000));
  s = foldEvents(s, ev({ type: "data", kind: "keyword", payload: { kw: "solar panel price uae", vol: 480 } }, 1000));

  assert.deepEqual(
    one(s).items.map((i: any) => i.payload.kw),
    ["solar panel price uae", "solar panel cost dubai"],
    "the table reads chronologically even when the network did not",
  );
});

test("out of order: a terminal task status is never resurrected by a later event", () => {
  let s = emptyLive;
  s = foldEvents(s, tev({ type: "task_finished", status: "published", ms: 60000 }, 9000));
  s = foldEvents(s, tev({ type: "task_started", steps: 4 }, 1000));

  assert.equal(one(s).status, "published");
  assert.equal(one(s).totalSteps, 4, "the late event still contributes the facts it carried");
});

/* ── 2 · Duplicates ──────────────────────────────────────────────────────────────────────
 * A cold start hydrates from `task_events` while the broadcast is already arriving, so every
 * event genuinely does show up twice. Identity is content-addressed — deliberately NOT the
 * timestamp, because `task_events.at` is the insert time, not the event time. */

test("duplicates: the same event twice is a no-op, by reference", () => {
  const e = ev({ type: "data", kind: "keyword", payload: { kw: "iso 27001 cost", vol: null } }, 1000);
  const s1 = foldEvents(emptyLive, e);
  const s2 = foldEvents(s1, e);

  assert.equal(s2, s1, "an unchanged fold must return the identical object so React can skip it");
  assert.equal(one(s1).items.length, 1);
});

test("duplicates: the recorded copy of a live event collapses into it despite a different `at`", () => {
  // Same keyword, same agent, same step — but the recording's `at` is the insert time.
  const live = ev({ type: "data", step_id: "s1", kind: "keyword", payload: { kw: "iso 9001 audit", vol: 90 } }, 1000);
  const recorded: RecordedRow = {
    id: 17,
    at: iso(1480), // 480ms later: the batch flush
    kind: "data",
    agent_id: "keyword",
    step_id: "s1",
    message_user: null,
    message_dev: null,
    payload: { data_kind: "keyword", payload: { kw: "iso 9001 audit", vol: 90 } },
  };

  let s = foldEvents(emptyLive, live);
  s = foldEvents(s, eventFromRow(recorded, TASK, TENANT)!);

  assert.equal(one(s).items.length, 1, "one keyword, one row — not two");
});

test("duplicates: key order inside a payload does not create a second item", () => {
  let s = foldEvents(emptyLive, ev({ type: "data", kind: "keyword", payload: { kw: "a", vol: 10 } }, 1000));
  s = foldEvents(s, ev({ type: "data", kind: "keyword", payload: { vol: 10, kw: "a" } }, 1000));
  assert.equal(one(s).items.length, 1);
});

test("duplicates: the same sentence is only shown once", () => {
  let s = foldEvents(emptyLive, tev({ type: "task_failed", message: "WordPress ne 401 wapas kiya." }, 1000));
  s = foldEvents(s, tev({ type: "task_failed", message: "WordPress ne 401 wapas kiya." }, 2000));
  assert.equal(one(s).lines.length, 1);
});

/* ── 3 · A task that fails mid-way ──────────────────────────────────────────────────────── */

test("failure: the task stops, the step is red, and the reason is a message_user", () => {
  let s = emptyLive;
  s = foldEvents(s, tev({ type: "task_created", echo: "Solar pe article likhunga", outline: ["Keyword", "Writer", "Publish"] }, 0));
  s = foldEvents(s, tev({ type: "task_started", steps: 3 }, 1000));
  s = foldEvents(s, ev({ type: "step_started", step_id: "s1", label: "Keywords dhoondh raha hun" }, 1200));
  s = foldEvents(s, ev({ type: "step_finished", step_id: "s1", ms: 3000 }, 4200));
  s = foldEvents(s, ev({ type: "step_started", step_id: "s2", label: "Article likh raha hun", agent_id: "writer", run_id: "run-2" }, 4300));
  s = foldEvents(s, tev({ type: "task_failed", message: "Model ne jawab nahi diya — dobara koshish karein.", step_no: 2 }, 9000));

  const t = one(s);
  assert.equal(t.status, "needs_attention", "the workspace says the word the database says");
  assert.equal(t.reason, "Model ne jawab nahi diya — dobara koshish karein.");
  assert.equal(t.finishedAt, T0 + 9000, "the elapsed timer freezes here");

  const failedLine = t.lines.find((l) => l.tone === "err");
  assert.ok(failedLine, "a failure is a sentence the user reads");
  assert.equal(failedLine!.text, "Model ne jawab nahi diya — dobara koshish karein.");
  assert.equal(failedLine!.text, userMessage(tev({ type: "task_failed", message: "Model ne jawab nahi diya — dobara koshish karein." }) as any));

  // A finished run before the failure keeps its own status: only what broke is red.
  assert.equal(t.steps.find((x) => x.step_id === "s1")!.status, "done");
  assert.equal(t.steps.find((x) => x.step_id === "s2")!.status, "running", "no step_no match yet — nothing is falsely blamed");
});

test("failure: run_error marks the one running step of that agent and nothing else", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "step_started", step_id: "s1", label: "Keywords" }, 0));
  s = foldEvents(s, ev({ type: "step_started", step_id: "s2", label: "Writing", agent_id: "writer", run_id: "run-2" }, 100));
  s = foldEvents(s, ev({ type: "run_error", agent_id: "writer", run_id: "run-2", message: "Writer ruk gaya — rate limit.", retryable: true, ms: 500 }, 900));

  const t = one(s);
  assert.equal(t.steps.find((x) => x.step_id === "s2")!.status, "failed");
  assert.equal(t.steps.find((x) => x.step_id === "s2")!.reason, "Writer ruk gaya — rate limit.");
  assert.equal(t.steps.find((x) => x.step_id === "s1")!.status, "running", "another agent's step is untouched");
  assert.equal(t.agents.find((a) => a.agent_id === "writer")!.status, "failed");
});

test("failure: a retry re-opens the failed step", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "step_started", step_id: "s2", label: "Writing", agent_id: "writer", run_id: "run-2" }, 0));
  s = foldEvents(s, ev({ type: "run_error", agent_id: "writer", run_id: "run-2", message: "Rate limit.", retryable: true, ms: 100 }, 100));
  s = foldEvents(s, ev({ type: "run_started", agent_id: "writer", run_id: "run-3", action: "write_article" }, 30000));

  const step = one(s).steps.find((x) => x.step_id === "s2")!;
  assert.equal(step.status, "running");
  assert.equal(step.reason, null, "the old reason does not linger over a step that is going again");
});

/* ── 4 · An optional step skipped ────────────────────────────────────────────────────────
 * §24.5 says show decisions. A skipped image step is a decision, and it has a reason. */

test("optional step skipped: amber, not red, and it carries its why", () => {
  let s = emptyLive;
  s = foldEvents(s, tev({ type: "task_started", steps: 3 }, 0));
  s = foldEvents(s, tev({ type: "step_skipped", step_no: 2, agent_id: "image", why: "aaj ka image budget khatam" }, 3000));
  s = foldEvents(s, tev({ type: "task_finished", status: "awaiting_approval", ms: 40000 }, 9000));

  const t = one(s);
  const skipped = t.steps.find((x) => x.agent_id === "image")!;
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.optional, true);
  assert.equal(skipped.reason, "aaj ka image budget khatam");
  assert.equal(t.status, "awaiting_approval", "an optional step failing does not fail the order");

  const line = t.lines.find((l) => l.tone === "warn")!;
  assert.equal(line.text, "Skipped image — aaj ka image budget khatam", "the sentence comes from userMessage(), not from the agent");
});

/* ── 5 · An unknown data kind ───────────────────────────────────────────────────────────
 * A new agent will ship a kind this build has never heard of. That is a rendering decision,
 * never a crash and never a blank panel. */

test("unknown kind: it is kept, tabbed and attributed like any other item", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "data", agent_id: "leads", run_id: "r9", kind: "lead", payload: { company: "Acme", email: "a@b.c" } }, 1000));
  s = foldEvents(s, ev({ type: "data", agent_id: "leads", run_id: "r9", kind: "moon_dust", payload: { grams: 3 } }, 2000));

  const pane = one(s).agents.find((a) => a.agent_id === "leads")!;
  assert.deepEqual(pane.kinds, ["lead", "moon_dust"], "first-seen order — the panel draws blocks in that order");
  assert.equal(pane.items.length, 2);
  assert.equal(pane.items[1].kind, "moon_dust");
  assert.equal(pane.items[1].payload.grams, 3, "the payload survives intact for the generic renderer");
});

test("unknown kind: a null or primitive payload does not throw", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "data", kind: "weird", payload: null }, 1000));
  s = foldEvents(s, ev({ type: "data", kind: "weird", payload: "just a string" }, 2000));
  s = foldEvents(s, ev({ type: "data", kind: "weird", payload: 42 }, 3000));
  assert.equal(one(s).items.length, 3);
});

test("unknown event types are ignored rather than fatal", () => {
  const s = foldEvents(emptyLive, { type: "from_the_future", task_id: TASK, tenant_id: TENANT, at: iso(0) } as any);
  assert.equal(one(s).lines.length, 0);
  assert.equal(one(s).items.length, 0);
});

/* ── 6 · The do-channel rule: a log is never a sentence ─────────────────────────────────── */

test("a log event produces no user-visible sentence", () => {
  let s = emptyLive;
  s = foldEvents(s, ev({ type: "step_started", step_id: "s1", label: "Keywords dhoondh raha hun" }, 0));
  const before = one(s).lines.length;

  s = foldEvents(
    s,
    ev({ type: "log", step_id: "s1", level: "warn", message_dev: "openai 429, retrying in 2s; prompt=<<SYSTEM …>>" }, 2000),
  );

  const t = one(s);
  assert.equal(t.lines.length, before, "nothing a customer reads came out of a log");
  assert.equal(
    t.lines.some((l) => l.text.includes("429") || l.text.includes("prompt")),
    false,
    "and the developer string is nowhere in the user-visible state",
  );
  assert.equal(userMessage(ev({ type: "log", level: "error", message_dev: "boom" }) as any), null);
  assert.equal(t.lastEventAt, T0 + 2000, "it does still count as evidence that the agent is alive");
});

test("data, run_started, run_finished and step_finished are structural, not sentences", () => {
  for (const e of [
    ev({ type: "data", kind: "keyword", payload: { kw: "x" } }),
    ev({ type: "run_started", action: "find_keywords" }),
    ev({ type: "run_finished", output: {}, ms: 1, cost_units: 0, llm_calls: 1, tokens_in: 2, tokens_out: 3 }),
    ev({ type: "step_finished", step_id: "s1", ms: 5 }),
    tev({ type: "task_confirmed" }),
  ]) {
    assert.equal(userMessage(e as any), null, `${(e as any).type} must not put words in anyone's mouth`);
  }
});

test("a recorded row's own message_user wins, so replay reads word for word what live read", () => {
  const row: RecordedRow = {
    id: 3,
    at: iso(1000),
    kind: "task_finished",
    agent_id: null,
    step_id: null,
    message_user: "Live on your site",
    message_dev: null,
    payload: { status: "published", ms: 1000 },
  };
  const s = foldEvents(emptyLive, eventFromRow(row, TASK, TENANT)!);
  assert.equal(one(s).lines[0].text, "Live on your site");
  assert.equal(one(s).status, "published");
});

/* ── 7 · The evidence clock — what freezes the animation ─────────────────────────────────── */

test("lastEventAt moves only on arrivals, and isFlowing goes false when they stop", () => {
  let s = foldEvents(emptyLive, tev({ type: "task_started", steps: 2 }, 0));
  s = foldEvents(s, ev({ type: "data", kind: "keyword", payload: { kw: "a" } }, 2000));
  const t = one(s);

  assert.equal(t.lastEventAt, T0 + 2000);
  assert.equal(isFlowing(t, T0 + 2000 + STALL_MS - 1), true);
  assert.equal(isFlowing(t, T0 + 2000 + STALL_MS + 1), false, "no evidence for 8s = the screen stops");
});

test("a finished task never flows, and its timer is frozen", () => {
  let s = foldEvents(emptyLive, tev({ type: "task_started", steps: 1 }, 0));
  s = foldEvents(s, tev({ type: "task_finished", status: "done", ms: 5000 }, 5000));
  const t = one(s);

  assert.equal(isFlowing(t, T0 + 5001), false);
  assert.equal(elapsedMs(t, T0 + 999999), 5000, "the clock stops at the last real event, not at now()");
  assert.equal(clock(5000), "00:05");
});

/* ── 8 · Snapshots: the cold start and the polling fallback ─────────────────────────────── */

test("hydrateTask fills the timeline from task_steps, monotonically", () => {
  let s = hydrateTask(emptyLive, {
    task: { id: TASK, status: "running", echo: "Solar pe article", kind: "write_article", created_at: iso(0) },
    steps: [
      { id: "s1", no: 1, agent_id: "keyword", action: "find_keywords", status: "done", started_at: iso(100), finished_at: iso(3000) },
      { id: "s2", no: 2, agent_id: "writer", action: "write_article", status: "running", started_at: iso(3100) },
      { id: "s3", no: 3, agent_id: "publish", action: "publish_article", status: "pending", optional: false },
    ],
  });

  let t = one(s);
  assert.equal(t.steps.length, 3);
  assert.deepEqual(t.steps.map((x) => x.status), ["done", "running", "pending"]);
  assert.equal(t.echo, "Solar pe article");
  assert.equal(t.startedAt, T0 + 100);

  // A poll that arrives a beat behind the broadcast must not undo it.
  s = foldEvents(s, ev({ type: "step_finished", step_id: "s2", agent_id: "writer", run_id: "run-2", ms: 9000 }, 12000));
  s = hydrateTask(s, {
    task: { id: TASK, status: "running", created_at: iso(0) },
    steps: [{ id: "s2", no: 2, agent_id: "writer", action: "write_article", status: "running", started_at: iso(3100) }],
  });
  t = one(s);
  assert.equal(t.steps.find((x) => x.step_id === "s2")!.status, "done", "a stale poll cannot rewind a finished step");
});

test("cold start: hydrating the recording after the panel already has live events changes nothing twice", () => {
  const rows: RecordedRow[] = [
    { id: 1, at: iso(10), kind: "task_created", agent_id: null, step_id: null, message_user: "Solar pe article likhunga", message_dev: null, payload: { outline: ["Keyword", "Writer"] } },
    { id: 2, at: iso(20), kind: "step_started", agent_id: "keyword", step_id: "s1", message_user: "Keywords dhoondh raha hun", message_dev: null, payload: { label: "Keywords dhoondh raha hun" } },
    { id: 3, at: iso(30), kind: "data", agent_id: "keyword", step_id: "s1", message_user: null, message_dev: null, payload: { data_kind: "keyword", payload: { kw: "solar dubai", vol: 1200 } } },
    { id: 4, at: iso(40), kind: "log", agent_id: "keyword", step_id: "s1", message_user: null, message_dev: "internal: 3 retries", payload: null },
  ];
  const events = rows.map((r) => eventFromRow(r, TASK, TENANT)!).filter(Boolean);

  const once = foldAll(emptyLive, events);
  const twice = foldAll(once, events);

  assert.equal(twice, once, "replaying the recording over itself is a no-op");
  assert.equal(one(once).items.length, 1);
  assert.equal(one(once).lines.length, 2, "task_created + step_started — the log is not one of them");
  assert.equal(one(once).outline.length, 2);
});

test("events for another task never contaminate this one", () => {
  let s = foldEvents(emptyLive, ev({ type: "data", kind: "keyword", payload: { kw: "mine" } }, 1000));
  s = foldEvents(s, { ...(ev({ type: "data", kind: "keyword", payload: { kw: "theirs" } }, 1000) as any), task_id: "task-2" });

  assert.equal(one(s).items.length, 1);
  assert.equal(s.byTask["task-2"].items.length, 1);
  assert.deepEqual(s.order, ["task-2", TASK], "newest first");
});
