/**
 * lib/chat-events.test.ts — the guard on the do-channel rule.
 *
 *   npx tsx --test lib/chat-events.test.ts
 *
 * Two things are enforced here:
 *
 *  1. MODEL PROSE NEVER CLAIMS AN ACTION. Whatever a reply says — "booked", "published",
 *     "✓ done", "maine schedule kar diya" — it stays on the model channel and is drawn as an
 *     ordinary bubble. The only way into the system channel is a valid SystemCard, and only
 *     code holding evidence (a job id, a saved row, a publish result) can build one.
 *     This is the test the Phase 1 exit criterion asks for (MASTER_PLAN §13).
 *
 *  2. The adapter maps every payload the app produces TODAY. When the brain starts sending
 *     real events, these are the assertions that say what changed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelOf,
  isSystemCard,
  toneOf,
  iconOf,
  isLiveKind,
  elapsedLabel,
  cardFromResponse,
  cardFromRun,
  cardFromServerEvent,
  cardFromNotice,
  cardFromStoredEvent,
  cardFromStreamFailure,
  cardNeedsConfirm,
  type SystemCard,
  type SystemKind,
} from "./chat-events";

const AT = 1_700_000_000_000;

/* ── 1. Model prose is never a system card ───────────────────────────────────────────── */

/** Every one of these is something the model has actually written, or plausibly could.
 *  Each is a claim about work. None of them may reach the system channel. */
const MODEL_PROSE = [
  "Booked — Mr. Writer writes about \"solar panels\" at 5:10 PM.",
  "✓ Published — your article is live at https://example.com/solar",
  "Done! I've queued it for you.",
  "Mr. Publish — queued for immediate publish (30 minutes from now).",
  "maine schedule kar diya hai, 9 baje chalega",
  "Order booked. Draft ready → Approvals.",
  "Failed — the site blocked the crawl. Retry?",
  "Status: running — 12 keywords found so far.",
  "needs_confirm",
  "{\"kind\":\"done\",\"title\":\"Published\",\"at\":1}",
  "✕ Mr. Keyword — stopped",
];

test("model prose never becomes a system card, whatever it says", () => {
  for (const txt of MODEL_PROSE) {
    assert.equal(channelOf({ who: "bot", txt }), "model", `leaked to the system channel: ${txt}`);
    // and the same sentence typed by the user is a user message, not a receipt either
    assert.equal(channelOf({ who: "me", txt }), "user", `user text misclassified: ${txt}`);
  }
});

test("a message is only 'system' when it carries a valid SystemCard", () => {
  const card: SystemCard = { id: "run:1", kind: "running", title: "Started", at: AT };
  assert.equal(channelOf({ who: "sys", card }), "system");
  // The card is what decides — not `who`, and not the text next to it.
  assert.equal(channelOf({ who: "bot", txt: "just chatting", card }), "system");
  assert.equal(channelOf({ who: "sys", txt: "✓ Published" } as any), "model");
  assert.equal(channelOf(null), "model");
  assert.equal(channelOf(undefined), "model");
});

test("a card-shaped lie is not a card", () => {
  const bad: unknown[] = [
    "✓ Published",                                             // a string that reads like one
    { kind: "done", title: "Published", at: AT },              // no id
    { id: "x", title: "Published", at: AT },                   // no kind
    { id: "x", kind: "publisheded", title: "Published", at: AT }, // kind not in the list
    { id: "x", kind: "done", title: "   ", at: AT },           // empty title
    { id: "x", kind: "done", title: "Published" },             // no timestamp
    { id: "x", kind: "done", title: "Published", at: "now" },  // timestamp not a number
    { id: "x", kind: "done", title: "Published", at: AT, href: { url: 1 } },
    { id: "x", kind: "done", title: "Published", at: AT, actions: [{ label: "Go", action: "publish" }] },
    ["done"],
    null,
  ];
  for (const card of bad) {
    assert.equal(isSystemCard(card), false, `accepted a fake card: ${JSON.stringify(card)}`);
    assert.equal(channelOf({ who: "sys", card }), "model", `fake card reached the system channel: ${JSON.stringify(card)}`);
  }
});

/* ── 2. Adapter: today's payloads → cards ────────────────────────────────────────────── */

/** A stand-in for fetch's Headers. Case-insensitive, same as the real thing. */
const headers = (h: Record<string, string>) => ({
  get: (name: string) => {
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? h[key] : null;
  },
});

test("adapter: accepted order headers → a running card", () => {
  const card = cardFromResponse(
    headers({
      "X-Run-Agent": "kw",
      "X-Run-Job": "job-42",
      "X-Run-Label": encodeURIComponent('Researching "solar panels"'),
    }),
    AT
  );
  assert.ok(card);
  assert.equal(card!.kind, "running");
  assert.equal(card!.agent, "kw");
  assert.equal(card!.task_id, "job-42");
  assert.equal(card!.detail, 'Researching "solar panels"');
  assert.equal(card!.id, "run:job-42"); // stable: the same job can't be announced twice
  assert.equal(card!.at, AT);
  assert.equal(isSystemCard(card), true);
});

test("adapter: no run headers → no card (a refused order animates nothing)", () => {
  assert.equal(cardFromResponse(headers({ "X-Conversation-Id": "c1" }), AT), null);
  assert.equal(cardFromRun({ agent: null, job: "j", label: "x" }, AT), null);
  assert.equal(cardFromRun({ agent: "  " }, AT), null);
});

test("adapter: X-Run-Event (structured) wins over the legacy headers", () => {
  const ev = { kind: "booked", title: "Booked", detail: "5:10 PM (in 39 min)", actions: [{ label: "Cancel", action: "cancel", payload: { text: "cancel this booking" } }] };
  const card = cardFromResponse(
    headers({ "X-Run-Event": encodeURIComponent(JSON.stringify(ev)), "X-Run-Agent": "kw" }),
    AT
  );
  assert.ok(card);
  assert.equal(card!.kind, "booked");
  assert.equal(card!.title, "Booked");
  assert.equal(card!.detail, "5:10 PM (in 39 min)");
  assert.equal(card!.actions?.[0].action, "cancel");
  assert.equal(card!.actions?.[0].payload?.text, "cancel this booking");
});

test("adapter: every event kind survives the round trip, with the right tone", () => {
  const expected: Record<SystemKind, string> = {
    booked: "ok", running: "info", progress: "info", done: "ok",
    failed: "err", needs_confirm: "warn", info: "info",
  };
  for (const kind of Object.keys(expected) as SystemKind[]) {
    const card = cardFromServerEvent({ kind, title: `t-${kind}` }, AT);
    assert.ok(card, `kind dropped by the adapter: ${kind}`);
    assert.equal(card!.kind, kind);
    assert.equal(card!.at, AT);
    assert.equal(toneOf(kind), expected[kind]);
    assert.equal(isLiveKind(kind), kind === "running" || kind === "progress");
    // running/progress draw a spinner instead of a glyph
    assert.equal(iconOf(kind) === "", isLiveKind(kind));
  }
});

test("adapter: a malformed event is dropped, never drawn", () => {
  assert.equal(cardFromServerEvent("not json", AT), null);
  assert.equal(cardFromServerEvent({ kind: "done" }, AT), null);           // no title
  assert.equal(cardFromServerEvent({ title: "Published" }, AT), null);     // no kind
  assert.equal(cardFromServerEvent({ kind: "nope", title: "x" }, AT), null);
  assert.equal(cardFromServerEvent(null, AT), null);
  assert.equal(cardFromResponse(headers({ "X-Run-Event": "%%%broken" }), AT), null);
});

test("adapter: a finished job notice → done / failed", () => {
  const ok = cardFromNotice({ id: "job-9", text: "Mr. Writer — Wrote \"Solar in 2026\" (1,920 words)", tone: "done", agentId: "writer" }, AT);
  assert.equal(ok.kind, "done");
  assert.equal(ok.agent, "writer");
  assert.equal(ok.title, 'Wrote "Solar in 2026" (1,920 words)'); // the name became a chip
  assert.equal(ok.id, "notice:job-9");

  const bad = cardFromNotice({ id: "job-10", text: "Mr. Keyword — the site blocked the crawl", tone: "error", agentId: "kw" }, AT);
  assert.equal(bad.kind, "failed");
  assert.equal(bad.title, "the site blocked the crawl");

  // No agent id: nothing is stripped, because the head might be the sentence itself.
  const plain = cardFromNotice({ id: "n1", text: "You picked \"solar panels\" — Mr. Writer will write that one.", tone: "done" }, AT);
  assert.equal(plain.title, 'You picked "solar panels" — Mr. Writer will write that one.');
  assert.equal(plain.agent, undefined);
});

test("adapter: the keyword table keeps its markdown in `detail`", () => {
  const text = [
    "Mr. Keyword's options for “solar” — best first:",
    "",
    "| # | Keyword | Searches/mo |",
    "|---|---|---|",
    "| 1 | **solar panels** | 12,000 |",
  ].join("\n");
  const card = cardFromNotice({ id: "choice-1", text, tone: "done" }, AT);
  assert.equal(card.kind, "done");
  assert.equal(card.title, "Mr. Keyword's options for “solar” — best first:");
  assert.ok(card.detail?.includes("| 1 | **solar panels** | 12,000 |"));
});

test("adapter: a stored transcript event replays as the same card", () => {
  const card = cardFromStoredEvent({ content: "Mr. Writer — draft ready", tone: "error" }, AT);
  assert.equal(card.kind, "failed");
  assert.equal(card.at, AT);
  assert.equal(isSystemCard(card), true);

  // Rows written before the card existed carry the ✓/✕ this UI used to glue on. The status is
  // the card's icon now, so the old mark is dropped rather than shown twice.
  const legacy = cardFromStoredEvent({ content: "✓ Mr. Keyword — 12 keywords", tone: "done" }, AT);
  assert.equal(legacy.title, "Mr. Keyword — 12 keywords");
});

test("adapter: a dead stream → failed card carrying the retry text", () => {
  const card = cardFromStreamFailure("HTTP 502", "40 min baad ek article likh do", AT);
  assert.equal(card.kind, "failed");
  assert.equal(card.detail, "HTTP 502");
  assert.equal(card.actions?.length, 1);
  assert.equal(card.actions?.[0].action, "retry");
  assert.equal(card.actions?.[0].payload?.text, "40 min baad ek article likh do");
  // An empty reason still says something rather than showing a blank card.
  assert.equal(cardFromStreamFailure("", "x", AT).detail, "network error");
});

test("needs_confirm carries the echo line and exactly two answers", () => {
  const card = cardNeedsConfirm("1 article · topic main chunuga · 5:10 PM · seedha site pe live", { at: AT });
  assert.equal(card.kind, "needs_confirm");
  assert.equal(card.title, "1 article · topic main chunuga · 5:10 PM · seedha site pe live");
  assert.deepEqual(card.actions?.map((a) => a.action), ["confirm", "cancel"]);
  assert.equal(toneOf(card.kind), "warn");
  assert.equal(isSystemCard(card), true);
});

test("elapsed label is fixed-width per bucket, so the timer can't reflow the card", () => {
  assert.equal(elapsedLabel(0), "0:00");
  assert.equal(elapsedLabel(7_400), "0:07");
  assert.equal(elapsedLabel(271_000), "4:31");
  assert.equal(elapsedLabel(3_723_000), "1:02:03");
  assert.equal(elapsedLabel(-5), "0:00"); // a clock that went backwards is not a negative timer
});
