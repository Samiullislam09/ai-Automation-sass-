/**
 * lib/chat-brain.test.ts — the acceptance table, run against a stubbed brain.
 *
 *   npx tsx --test lib/chat-brain.test.ts
 *
 * These are the rows of docs/MASTER_PLAN.html §14 ("user ne X kaha to Y hi ho") that can be
 * decided without a live brain, plus the §10 UX rules they depend on. The brain client is
 * stubbed; everything else is the real code — the real tool builder, the real intent shaping
 * (`planFromToolCall`), the real lib/when.ts, the real follow-up resolver. Only two things are
 * faked: the network to the brain, and the model's choice of tool. That is deliberate: the
 * model's choice is the one part of this system that is allowed to be wrong, and every rule
 * below exists to make a wrong choice cheap.
 *
 * The stubbed `createTask` mirrors agent-server/src/brain/orchestrator.ts's own rule for the
 * status it returns (irreversible → awaiting_confirm, future run_at → scheduled, else queued),
 * because that rule is what decides which card the user sees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BRAIN_UNREACHABLE, idempotencyKey, type BrainRegistry, type BrainResult, type BrainTaskCreated, type BrainIntent } from "@/lib/brain";
import {
  ANSWER_QUESTION,
  capabilitiesPrompt,
  enabledActions,
  fieldSchema,
  missingSlots,
  schemaFromInput,
  toolsFromRegistry,
} from "@/lib/chat-tools";
import { planFromToolCall, nothingOrdered, resolveDelivery, resolveWhen, type IntentPlan } from "@/lib/chat-brain-intent";
import { resolveFollowUp, CONFIRM_SLOT, type ConversationState, type PendingIntent } from "@/lib/chat-conversation";
import { brainTurn, legacyJobOf, type BrainTurn, type BrainTurnDeps, type LegacyJob, type OrderResult } from "@/lib/chat-brain";
import { channelOf } from "@/lib/chat-events";

/* ── The registry the brain would serve today ────────────────────────────────────────── */

/** A faithful copy of agent-server/src/brain/manifests.ts as `GET /brain/registry` shapes it,
 *  including the four agents that are registered but DISABLED (three stubs, one with no worker
 *  yet). The disabled ones are the point of several tests below: the model is never offered a
 *  tool it cannot actually run, which is why "kya tum Instagram pe post kar sakte ho?" has only
 *  one possible answer. */
const REGISTRY: BrainRegistry = {
  agents: [
    {
      id: "keyword",
      name: "Mr. Keyword",
      version: "2.0.0",
      description: "Finds the keywords worth writing about and says where each number came from.",
      enabled: true,
      healthy: true,
      office: { room: "kw", ico: "🔑", color: "#fbbf24" },
      actions: [
        {
          id: "find_keywords",
          phrases: ["keywords do", "sirf keyword", "keyword research", "keyword nikalo"],
          input: { topic: "string", count: "number?" },
          irreversible: false,
          estimated_seconds: 20,
          needs: [],
          provides: "keywords",
        },
      ],
    },
    {
      id: "writer",
      name: "Mr. Writer",
      version: "1.0.0",
      description: "Researches and writes the article, then measures it against the quality gate.",
      enabled: true,
      healthy: true,
      office: { room: "writer", ico: "✍️", color: "#b48bff" },
      actions: [
        {
          id: "write_article",
          phrases: ["article likho", "blog likho", "write an article", "likh do"],
          input: { topic: "string", keywords: "string[]", tone: "string?", words: "number?" },
          irreversible: false,
          estimated_seconds: 300,
          needs: ["keywords"],
          provides: "article",
        },
        {
          id: "research_brief",
          phrases: ["research karo", "brief banao", "likhna mat"],
          input: { topic: "string" },
          irreversible: false,
          estimated_seconds: 90,
          needs: [],
          provides: "brief",
        },
      ],
    },
    {
      id: "boss",
      name: "Mr Lxwa",
      version: "1.0.0",
      description: "Picks which topics the business should publish next.",
      enabled: true,
      healthy: true,
      office: { room: "boss", ico: "🧠", color: "#f0abfc" },
      actions: [
        {
          id: "plan_topics",
          phrases: ["what should i write about", "kya likhun", "content plan"],
          input: { count: "number?" },
          irreversible: false,
          estimated_seconds: 25,
          needs: [],
          provides: "topics",
        },
      ],
    },
    {
      id: "publish",
      name: "Mr. Publish",
      version: "1.0.0",
      description: "Puts the approved article on the customer's site.",
      enabled: false, // NOT_YET_ROUTED — a manifest, but no worker behind it
      healthy: false,
      office: { room: "publish", ico: "🚀", color: "#f87171" },
      actions: [
        {
          id: "publish_article",
          phrases: ["publish karo", "live kar do", "site pe daal do"],
          input: { content_item_id: "string" },
          irreversible: true,
          estimated_seconds: 30,
          needs: ["article", "seo_passed"],
          provides: "published_url",
        },
      ],
    },
    {
      id: "social",
      name: "Mr. Social",
      version: "0.1.0",
      description: "Drafts the social posts for an article.",
      enabled: false, // stub — Phase 3
      healthy: false,
      office: { room: "social", ico: "📣", color: "#60a5fa" },
      actions: [
        {
          id: "draft_social",
          phrases: ["social post banao", "linkedin post", "post for facebook", "instagram post"],
          input: { article: "object", networks: "string[]?" },
          irreversible: false,
          estimated_seconds: 45,
          needs: ["article"],
          provides: "social_posts",
        },
      ],
    },
  ],
  capabilities: [
    "TEAM (4 kaam abhi ho sakte hain, 2 nahi)",
    "",
    "CAN DO NOW",
    "  Mr Lxwa · plan_topics (~25s) — what should i write about / kya likhun / content plan",
    "  Mr. Keyword · find_keywords (~20s) — keywords do / sirf keyword / keyword research",
    "  Mr. Writer · write_article (~5 min) — article likho / blog likho / write an article",
    "  Mr. Writer · research_brief (~90s) — research karo / brief banao / likhna mat",
    "",
    "CANNOT DO YET — offer nahi karna, saaf mana karna",
    "  Mr. Publish · publish_article — abhi ban raha hai",
    "  Mr. Social · draft_social — abhi ban raha hai",
  ].join("\n"),
  problems: [],
  fetchedAt: 0,
  stale: false,
};

/** Every action id that exists, for the "nothing is hard-coded" assertion. */
const ALL_ACTION_IDS = REGISTRY.agents.flatMap((a) => a.actions.map((x) => x.id));

/* ── A brain that is only a variable ─────────────────────────────────────────────────── */

const NOW = new Date("2026-08-27T12:00:00.000Z");
const TZ = "Asia/Karachi";

type Recorder = {
  created: Array<{ tenantId: string; intent: BrainIntent }>;
  confirmed: string[];
  cancelled: string[];
  legacy: LegacyJob[];
  saved: Array<{ pending: PendingIntent; slot: string }>;
  cleared: number;
};

type StubOpts = {
  /** What the model chose. null = it called the question tool, i.e. nothing was ordered. */
  tool?: { name: string; args: Record<string, unknown> } | null;
  registry?: BrainResult<BrainRegistry>;
  state?: ConversationState | null;
  /** Force a failure out of the brain's createTask. */
  createError?: string;
  saveFails?: boolean;
};

function stub(opts: StubOpts = {}) {
  const rec: Recorder = { created: [], confirmed: [], cancelled: [], legacy: [], saved: [], cleared: 0 };
  let state: ConversationState | null = opts.state ?? null;

  const deps: BrainTurnDeps = {
    getRegistry: async () => opts.registry ?? { ok: true, data: REGISTRY, reachable: true },

    // The network is stubbed; the SHAPING is the real function, so every test below is also a
    // test of when.ts, of the delivery rule, and of the missing-slot rule.
    extractIntent: async (message, registry, o) =>
      opts.tool
        ? planFromToolCall(opts.tool.name, opts.tool.args, { message, registry, tz: o.tz, now: o.now })
        : nothingOrdered(),

    createTask: async (tenantId, intent): Promise<BrainResult<BrainTaskCreated>> => {
      rec.created.push({ tenantId, intent });
      if (opts.createError) return { ok: false, error: opts.createError, reachable: true };
      // Mirrors orchestrator.ts: the brain sets irreversible from the manifest OR a publish
      // delivery, and that is what decides the status.
      const spec = enabledActions(REGISTRY).get(intent.action)?.spec;
      const irreversible = !!spec?.irreversible || intent.delivery === "publish";
      const future = intent.when ? new Date(intent.when.at).getTime() > NOW.getTime() + 5_000 : false;
      return {
        ok: true,
        reachable: true,
        data: {
          task_id: "task-1",
          status: irreversible ? "awaiting_confirm" : future ? "scheduled" : "queued",
          echo: intent.echo,
          outline: ["Mr. Keyword finds the keywords", "Mr. Writer writes it"],
          estimated_seconds: 320,
          cost_units: 43,
          irreversible,
        },
      };
    },

    confirmTask: async (taskId) => {
      rec.confirmed.push(taskId);
      return { ok: true, data: { ok: true }, reachable: true };
    },
    cancelTask: async (taskId) => {
      rec.cancelled.push(taskId);
      return { ok: true, data: { ok: true }, reachable: true };
    },

    state: {
      load: async () => state,
      save: async (pending, askedSlot, turnNo) => {
        rec.saved.push({ pending, slot: askedSlot });
        if (opts.saveFails) return { ok: false, error: "no table" };
        state = {
          conversation_id: "c1",
          tenant_id: "t1",
          pending_intent: pending,
          asked_slot: askedSlot,
          expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
          turn_no: turnNo + 1,
        };
        return { ok: true };
      },
      clear: async () => {
        rec.cleared++;
        state = null;
        return { ok: true };
      },
    },

    runLegacy: async (job) => {
      rec.legacy.push(job);
      return { text: "old path ran", agentId: null, jobId: null, label: null };
    },

    legacyKind: (message) => legacyJobOf(message, TZ),
  };

  return { deps, rec, get state() { return state; } };
}

const turn = (message: string, deps: BrainTurnDeps, now: Date = NOW): Promise<BrainTurn> =>
  brainTurn({ message, tenantId: "t1", userId: "u1", conversationId: "c1", tz: TZ, history: [], now }, deps);

const order = (t: BrainTurn): OrderResult => {
  assert.ok(t.order, "expected an order result");
  return t.order as OrderResult;
};

/* ══ §14 · the acceptance table ══════════════════════════════════════════════════════ */

test('"hello" — a greeting starts nothing', async () => {
  const s = stub({ tool: null });
  const t = await turn("hello", s.deps);

  assert.equal(t.handled, false, "a greeting is answered by the conversation model, not by an order");
  assert.equal(s.rec.created.length, 0);
  assert.equal(s.rec.legacy.length, 0);
  assert.equal(s.rec.saved.length, 0);
});

test('"article likho" — ONE question, and no task', async () => {
  const s = stub({ tool: { name: "write_article", args: {} } });
  const t = await turn("article likho", s.deps);

  assert.equal(s.rec.created.length, 0, "nothing may be ordered while a required slot is empty");
  const o = order(t);
  assert.equal(o.event, undefined, "a question is prose, not a system fact — no card");
  assert.match(o.text, /topic/i);
  // §10 rule 3: one question, never two. `keywords` is required too, but the planner feeds it
  // from an earlier step, so the user is never asked for it.
  assert.equal(s.rec.saved.length, 1);
  assert.equal(s.rec.saved[0].slot, "topic");
  assert.equal(s.rec.saved[0].pending.route, "slot");
});

test('"solar panels pe article likho" — a task, and no confirmation asked', async () => {
  const s = stub({ tool: { name: "write_article", args: { topic: "solar panels" } } });
  const t = await turn("solar panels pe article likho", s.deps);

  assert.equal(s.rec.created.length, 1);
  const sent = s.rec.created[0].intent;
  assert.equal(sent.action, "write_article");
  assert.deepEqual(sent.params, { topic: "solar panels" });
  assert.equal(sent.delivery, "approvals", "they never said publish");
  assert.equal(sent.when, null);
  assert.deepEqual(sent.missing, []);
  assert.equal((sent as any).irreversible, undefined, "irreversible is the brain's to decide, from the manifest");

  const o = order(t);
  assert.equal(o.event?.kind, "running", "writing is reversible — it just starts");
  assert.notEqual(o.event?.kind, "needs_confirm");
  assert.equal(o.jobId, "task-1");
  assert.equal(o.agentId, "writer", "the office lights the room the manifest named");
});

test('"30 min baad" — the time is resolved by when.ts and the card says Booked', async () => {
  const s = stub({
    tool: { name: "write_article", args: { topic: "solar panels", when_phrase: "30 min baad" } },
  });
  const t = await turn("30 min baad solar panels pe article likho", s.deps);

  const sent = s.rec.created[0].intent;
  assert.ok(sent.when, "the order carries an instant, not a phrase");
  assert.equal(sent.when!.kind, "relative");
  assert.match(sent.when!.matched, /30\s*min/i, "the fragment lib/when.ts matched, quoted back");
  assert.equal(new Date(sent.when!.at).getTime(), NOW.getTime() + 30 * 60_000);

  const o = order(t);
  assert.equal(o.event?.kind, "booked");
  assert.equal(o.jobId, null, "nothing is running yet — the office must not animate");
  assert.ok(o.event?.actions?.some((a) => a.action === "cancel"), "§10 rule 9: the way out is on the card");
});

test('a model-invented instant can never become the schedule', () => {
  // The model is asked for the user's WORDS. If it sends an ISO timestamp anyway, when.ts
  // cannot read it, the message is read instead, and a message with no time is "now".
  const w = resolveWhen("solar pe article likho", "2027-01-01T09:00:00Z", TZ, NOW);
  assert.equal(w, null);
});

test('"publish mat karna" — delivery stays approvals, and NOTHING is cancelled', async () => {
  // Half one: the model may say "publish"; the user's own sentence overrules it.
  assert.equal(resolveDelivery("ek article likho, publish mat karna", "publish"), "approvals");
  assert.equal(resolveDelivery("ek article likh ke publish kar do", undefined), "publish");

  const s = stub({ tool: { name: "write_article", args: { topic: "solar panels", delivery: "publish" } } });
  const t = await turn("solar panels pe article likho, publish mat karna", s.deps);
  assert.equal(s.rec.created[0].intent.delivery, "approvals");
  assert.equal(order(t).event?.kind, "running");

  // Half two, and the reason this row is in the plan at all: said on its own, with nothing
  // pending, "publish mat karna" is a sentence about something that has not happened. It once
  // cancelled the customer's next booked article, which has no undo.
  const bare = stub({ tool: null });
  const t2 = await turn("publish mat karna", bare.deps);
  assert.equal(t2.handled, false, "it is a conversation, not a command");
  assert.equal(bare.rec.legacy.length, 0, "nothing on the old path ran");
  assert.equal(bare.rec.cancelled.length, 0, "no task was cancelled");
  assert.equal(bare.rec.created.length, 0);
});

test('"isko publish kar do" — an echo first, and nothing happens before the yes', async () => {
  const s = stub({ tool: null });
  const t = await turn("isko publish kar do", s.deps);

  const o = order(t);
  assert.equal(o.event?.kind, "needs_confirm", "§10 rule 2: irreversible work is echoed first");
  assert.equal(s.rec.legacy.length, 0, "the publish has NOT run");
  assert.equal(s.rec.created.length, 0, "and no task was created either");
  assert.equal(s.rec.saved[0].slot, CONFIRM_SLOT);
  assert.equal(s.rec.saved[0].pending.route, "legacy");
  assert.equal(o.event?.actions?.length, 2, "exactly two answers: haan and nahi");

  // ...and the yes, which arrives as an ordinary chat message from the card's own button.
  const t2 = await turn("haan, kar do", s.deps);
  assert.equal(s.rec.legacy.length, 1, "now it runs");
  assert.equal(s.rec.legacy[0].kind, "publish");
  assert.equal(order(t2).text, "old path ran");
});

test('"nahi, rehne do" cancels the pending order and nothing else', async () => {
  const s = stub({ tool: null });
  await turn("isko publish kar do", s.deps);
  const t = await turn("nahi, rehne do", s.deps);

  assert.equal(s.rec.legacy.length, 0, "the publish never ran");
  assert.equal(s.rec.cancelled.length, 0, "and no booking was touched — this is the regression");
  assert.match(order(t).text, /nahi kiya/i);
  assert.equal(order(t).event?.kind, "info");
});

test('"mera schedule kya hai" — an answer, and nothing changes', async () => {
  const s = stub({ tool: null });
  const t = await turn("mera schedule kya hai", s.deps);

  assert.equal(t.handled, false, "a question about the timetable is answered, not acted on");
  assert.equal(s.rec.legacy.length, 0, "no schedule was written");
  assert.equal(s.rec.created.length, 0);
  assert.equal(legacyJobOf("mera schedule kya hai", TZ), null);
});

test('"kya tum Instagram pe post kar sakte ho?" — the honest no comes from the registry', async () => {
  // There is no way for the model to say yes: the social agent is disabled, so it has no tool.
  const tools = toolsFromRegistry(REGISTRY);
  assert.equal(
    tools.some((t) => JSON.stringify(t).toLowerCase().includes("instagram")),
    false,
    "a disabled agent is never offered as a tool"
  );

  const s = stub({ tool: null });
  const t = await turn("kya tum Instagram pe post kar sakte ho?", s.deps);
  assert.equal(t.handled, false);
  assert.match(t.capabilities ?? "", /CANNOT DO YET/);
  assert.match(t.capabilities ?? "", /Mr\. Social/);
  assert.match(t.capabilities ?? "", /saaf mana karna|cannot do it yet/i);
  assert.equal(s.rec.created.length, 0);
});

test('a model reply that says "✓ Published" is still just a reply', () => {
  // The brain path never hands the model a way to make a card: a card is only ever built from
  // a createTask answer. So the strongest claim a reply can make is a sentence.
  assert.equal(channelOf({ who: "bot", content: "✓ Published — it's live on your site" }), "model");
  assert.equal(channelOf({ who: "bot", content: "✓ Published", card: { kind: "done", title: "Published" } }), "model");
});

test("the same order twice carries the same idempotency key", () => {
  const at = new Date("2026-08-27T12:00:30.000Z");
  const again = new Date("2026-08-27T12:00:59.000Z"); // the double-click, half a minute later
  const later = new Date("2026-08-27T12:14:00.000Z"); // a genuine second order

  const a = idempotencyKey("t1", "c1", "write_article", { topic: "solar" }, at);
  const b = idempotencyKey("t1", "c1", "write_article", { topic: "solar" }, again);
  const c = idempotencyKey("t1", "c1", "write_article", { topic: "solar" }, later);
  const d = idempotencyKey("t1", "c1", "write_article", { topic: "wind" }, at);
  const e = idempotencyKey("t2", "c1", "write_article", { topic: "solar" }, at);

  assert.equal(a, b, "one order, however many clicks");
  assert.notEqual(a, c, "the same order twenty minutes later is a second order");
  assert.notEqual(a, d);
  assert.notEqual(a, e, "and it never leaks across tenants");
});

/* ══ The brain is down ═══════════════════════════════════════════════════════════════ */

test("brain unreachable: an order is refused in plain words, and no other path is tried", async () => {
  const s = stub({
    tool: { name: "write_article", args: { topic: "solar" } },
    registry: { ok: false, error: BRAIN_UNREACHABLE, reachable: false },
  });
  const t = await turn("solar panels pe article likho", s.deps);

  assert.equal(order(t).text, BRAIN_UNREACHABLE);
  assert.equal(order(t).event?.kind, "failed");
  assert.equal(s.rec.created.length, 0);
  assert.equal(s.rec.legacy.length, 0, "the old enqueue path is NOT used as a silent fallback");
});

test("brain unreachable: a greeting is still answered", async () => {
  const s = stub({ tool: null, registry: { ok: false, error: BRAIN_UNREACHABLE, reachable: false } });
  const t = await turn("hello", s.deps);
  assert.equal(t.handled, false, "nothing about a greeting needs the team's tool list");
});

test("a refused task is reported in the brain's own words", async () => {
  const s = stub({
    tool: { name: "write_article", args: { topic: "solar" } },
    createError: "Aaj ki limit poori — writer 10 baar chal chuka hai. Kuch nahi chala.",
  });
  const t = await turn("solar pe article likho", s.deps);
  assert.match(order(t).text, /Aaj ki limit poori/);
  assert.equal(order(t).event?.kind, "failed");
  assert.equal(order(t).jobId, null, "nothing animates for work that did not start");
});

test("an irreversible task with nowhere to remember the yes is taken back", async () => {
  const s = stub({
    tool: { name: "write_article", args: { topic: "solar", delivery: "publish" } },
    saveFails: true,
  });
  const t = await turn("solar pe article likh ke publish kar do", s.deps);

  assert.equal(s.rec.created.length, 1);
  assert.deepEqual(s.rec.cancelled, ["task-1"], "an order waiting on an answer we cannot hear is cancelled");
  assert.equal(order(t).event?.kind, "failed");
});

/* ══ §5.1 · the tool list is built, never written ════════════════════════════════════ */

test("one tool per ENABLED action, plus the question tool — and nothing else", () => {
  const tools = toolsFromRegistry(REGISTRY);
  const names = tools.map((t) => t.function.name);

  assert.deepEqual(names, ["find_keywords", "write_article", "research_brief", "plan_topics", ANSWER_QUESTION]);
  assert.equal(names.includes("publish_article"), false, "no worker behind it → no tool");
  assert.equal(names.includes("draft_social"), false, "a stub → no tool");
});

test("lib/chat-tools.ts does not know a single action by name", () => {
  // The claim being tested: a new agent becomes routable without a web deploy. If any action
  // id appeared in this file, that claim would be false for the next one.
  const source = readFileSync(join(process.cwd(), "lib", "chat-tools.ts"), "utf8");
  for (const id of ALL_ACTION_IDS) {
    assert.equal(source.includes(id), false, `lib/chat-tools.ts hard-codes "${id}"`);
  }
  // Nor any agent's trigger phrases — those belong to the manifest too.
  for (const phrase of REGISTRY.agents.flatMap((a) => a.actions.flatMap((x) => x.phrases))) {
    assert.equal(source.includes(phrase), false, `lib/chat-tools.ts hard-codes the phrase "${phrase}"`);
  }
  // Agent IDS are deliberately NOT checked: several of them ("publish", "social", "boss") are
  // ordinary English words, and one of them appears in this file as a delivery VALUE — which is
  // part of the contract, not a route to an agent.
});

test("the input spec becomes a JSON Schema, and `?` decides what is required", () => {
  const schema = schemaFromInput({ topic: "string", keywords: "string[]", tone: "string?", words: "number?" });
  assert.deepEqual(schema.required, ["topic", "keywords"]);
  assert.deepEqual(schema.properties.topic, { type: "string" });
  assert.deepEqual(schema.properties.keywords, { type: "array", items: { type: "string" } });
  assert.deepEqual(schema.properties.words, { type: "number" });

  assert.deepEqual(fieldSchema("object[]"), { schema: { type: "array", items: { type: "object" } }, required: true });
  assert.equal(fieldSchema("nonsense"), null, "a type we do not understand is left out, never guessed");
});

test("the phrases travel with the manifest into the tool description", () => {
  const tools = toolsFromRegistry(REGISTRY);
  const writer = tools.find((t) => t.function.name === "write_article")!;
  assert.match(writer.function.description, /article likho/);
  assert.match(writer.function.description, /blog likho/);
  assert.match(writer.function.description, /Mr\. Writer/);
});

test("a required field that the planner will feed is not something to ask the user for", () => {
  const spec = REGISTRY.agents[1].actions[0]; // takes both a topic and keywords; keywords is a need
  assert.deepEqual(missingSlots(spec, {}), ["topic"]);
  assert.deepEqual(missingSlots(spec, { topic: "solar" }), []);
});

test("a tool the registry does not have is not an action", () => {
  const plan = planFromToolCall("delete_everything", { confirm: true }, { message: "sab uda do", registry: REGISTRY, tz: TZ, now: NOW });
  assert.equal(plan.action, ANSWER_QUESTION);
  assert.equal(plan.echo, "");

  // Same for one that IS registered but disabled — the model must not be able to route to it.
  const disabled = planFromToolCall("publish_article", { content_item_id: "x" }, { message: "publish", registry: REGISTRY, tz: TZ, now: NOW });
  assert.equal(disabled.action, ANSWER_QUESTION);
});

test("arguments are coerced to the shape the agent declared, and the rest dropped", () => {
  const plan = planFromToolCall(
    "find_keywords",
    { topic: "  solar panels  ", count: "8", nonsense: "ignore me" },
    { message: "solar panels ke keywords do", registry: REGISTRY, tz: TZ, now: NOW }
  );
  assert.deepEqual(plan.params, { topic: "solar panels", count: 8 });
  assert.equal(plan.confidence, 0.9, "a tool call with no confidence stated is treated as a confident one");
});

test("a low-confidence call asks instead of spending", async () => {
  const s = stub({ tool: { name: "write_article", args: { topic: "solar", confidence: 0.4 } } });
  const t = await turn("kuch likh do shayad", s.deps);

  assert.equal(s.rec.created.length, 0);
  assert.match(order(t).text, /pakka nahi/i);
  assert.equal(s.rec.saved[0].slot, CONFIRM_SLOT);

  // ...and "haan" turns the same intent into the task, without a second model call.
  const t2 = await turn("haan", s.deps);
  assert.equal(s.rec.created.length, 1);
  assert.equal(order(t2).event?.kind, "running");
});

test("the answer to the one question completes the order", async () => {
  const s = stub({ tool: { name: "write_article", args: {} } });
  await turn("article likho", s.deps);
  assert.equal(s.rec.created.length, 0);

  const t = await turn("solar panels for homes", s.deps);
  assert.equal(s.rec.created.length, 1);
  assert.deepEqual(s.rec.created[0].intent.params, { topic: "solar panels for homes" });
  assert.equal(order(t).event?.kind, "running");
});

/* ══ §5.1 upgrade B · what "haan" is the answer to ═══════════════════════════════════ */

const pending: PendingIntent = { v: 1, route: "task", action: "write_article", echo: "1 article", message: "…", task_id: "task-1" };
const stateWith = (askedSlot: string, expiresInMs = 600_000): ConversationState => ({
  conversation_id: "c1",
  tenant_id: "t1",
  pending_intent: pending,
  asked_slot: askedSlot,
  expires_at: new Date(NOW.getTime() + expiresInMs).toISOString(),
  turn_no: 1,
});

test("yes and no, in both languages, resolved without a model", () => {
  for (const yes of ["haan", "haan, kar do", "ok", "theek hai", "ji haan", "yes please", "kar do", "bilkul"]) {
    assert.equal(resolveFollowUp(yes, stateWith(CONFIRM_SLOT), NOW).kind, "confirm", yes);
  }
  for (const no of ["nahi", "nahi, rehne do", "mat karna", "no", "rehne do", "cancel", "nahi karna"]) {
    assert.equal(resolveFollowUp(no, stateWith(CONFIRM_SLOT), NOW).kind, "cancel", no);
  }
});

test("a refusal wins over an agreement in the same sentence", () => {
  assert.equal(resolveFollowUp("haan lekin publish mat karna", stateWith(CONFIRM_SLOT), NOW).kind, "cancel");
});

test("with nothing pending, a yes or a no means nothing at all", () => {
  assert.equal(resolveFollowUp("haan", null, NOW).kind, "none");
  assert.equal(resolveFollowUp("nahi, rehne do", null, NOW).kind, "none");
  assert.equal(resolveFollowUp("mat karna", { ...stateWith(CONFIRM_SLOT), pending_intent: null }, NOW).kind, "none");
});

test("an unanswered echo lapses, and the order does not run later", () => {
  const stale = stateWith(CONFIRM_SLOT, -1_000);
  assert.equal(resolveFollowUp("haan", stale, NOW).kind, "lapsed");
  // And a message that is neither yes nor no drops it too, rather than leaving it armed.
  assert.equal(resolveFollowUp("mera schedule kya hai", stateWith(CONFIRM_SLOT), NOW).kind, "lapsed");
});

test("a bare topic answers the slot we asked about", () => {
  const f = resolveFollowUp("solar panels", stateWith("topic"), NOW);
  assert.equal(f.kind, "slot");
  assert.equal((f as any).value, "solar panels");

  const back = resolveFollowUp("tum chuno", stateWith("topic"), NOW);
  assert.equal(back.kind, "slot");
  assert.equal((back as any).value, null, "they handed the choice back");

  const moved = resolveFollowUp(
    "actually forget that, tell me how many articles were written this month and what the schedule is",
    stateWith("topic"),
    NOW
  );
  assert.equal(moved.kind, "lapsed", "a new subject is not an argument");
});

test("an expired echo cannot be confirmed by the next message", async () => {
  const s = stub({
    tool: null,
    state: { ...stateWith(CONFIRM_SLOT, -1_000), pending_intent: { ...pending, route: "task" } },
  });
  const t = await turn("haan", s.deps);
  assert.equal(s.rec.confirmed.length, 0, "nothing was confirmed");
  assert.equal(s.rec.cleared > 0, true, "the lapsed order was dropped");
  assert.equal(t.handled, false, "and the message was answered on its own merits");
});

test("confirming a brain task confirms exactly that task", async () => {
  const s = stub({ tool: null, state: stateWith(CONFIRM_SLOT) });
  const t = await turn("haan, kar do", s.deps);

  assert.deepEqual(s.rec.confirmed, ["task-1"]);
  assert.equal(s.rec.created.length, 0, "confirming is not re-ordering");
  assert.equal(order(t).event?.kind, "running");
  assert.equal(order(t).jobId, "task-1");
});

test("saying no to a brain task cancels the task, and only the task", async () => {
  const s = stub({ tool: null, state: stateWith(CONFIRM_SLOT) });
  const t = await turn("nahi", s.deps);

  assert.deepEqual(s.rec.cancelled, ["task-1"]);
  assert.equal(s.rec.legacy.length, 0);
  assert.equal(order(t).event?.kind, "info");
});

/* ══ §5.2 · what the conversation model is given ═════════════════════════════════════ */

test("the capabilities block is the registry's own words, with one instruction attached", () => {
  const text = capabilitiesPrompt(REGISTRY);
  assert.ok(text.includes(REGISTRY.capabilities), "the list is passed through, not paraphrased");
  assert.match(text, /answer ONLY from this list/);
  assert.equal(capabilitiesPrompt(null), "", "no registry, no claims");
});

test("a stale registry is still usable, and says so to us but not to the user", () => {
  const text = capabilitiesPrompt({ ...REGISTRY, stale: true });
  assert.match(text, /Do not mention that to the user/);
});

/* ══ lib/brain.ts · the client itself ════════════════════════════════════════════════ */

/** Runs `fn` with the global fetch replaced, then puts everything back. */
async function withFetch(impl: (url: string, init?: any) => Promise<any>, fn: () => Promise<void>) {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.AGENT_SERVER_URL;
  const realToken = process.env.AGENT_SERVER_TOKEN;
  (globalThis as any).fetch = impl;
  process.env.AGENT_SERVER_URL = "http://brain.test";
  process.env.AGENT_SERVER_TOKEN = "shh";
  try {
    await fn();
  } finally {
    (globalThis as any).fetch = realFetch;
    if (realUrl === undefined) delete process.env.AGENT_SERVER_URL; else process.env.AGENT_SERVER_URL = realUrl;
    if (realToken === undefined) delete process.env.AGENT_SERVER_TOKEN; else process.env.AGENT_SERVER_TOKEN = realToken;
  }
}

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test("the registry is fetched once a minute, and the token rides along", async () => {
  const { clearRegistryCache, getRegistry } = await import("@/lib/brain");
  clearRegistryCache();

  let calls = 0;
  let sentToken: string | undefined;
  await withFetch(
    async (_url, init) => {
      calls++;
      sentToken = init?.headers?.["x-agent-token"];
      return jsonResponse({ agents: REGISTRY.agents, capabilities: REGISTRY.capabilities, problems: [] });
    },
    async () => {
      const a = await getRegistry();
      const b = await getRegistry();
      assert.equal(a.ok, true);
      assert.equal(b.ok, true);
      assert.equal(calls, 1, "the second read comes from the cache");
      assert.equal(sentToken, "shh");
      assert.equal(a.data!.agents.length, REGISTRY.agents.length);
      assert.equal(a.data!.stale, false);
    }
  );
  clearRegistryCache();
});

test("a brain restart does not break the chat: the last registry is served, marked stale", async () => {
  const { clearRegistryCache, expireRegistryCache, getRegistry } = await import("@/lib/brain");
  clearRegistryCache();

  let down = false;
  await withFetch(
    async () => {
      if (down) throw new Error("ECONNREFUSED");
      return jsonResponse({ agents: REGISTRY.agents, capabilities: REGISTRY.capabilities, problems: [] });
    },
    async () => {
      assert.equal((await getRegistry()).ok, true);

      // A minute later, mid-deploy: the copy is old and the brain is not answering.
      expireRegistryCache();
      down = true;

      const second = await getRegistry();
      assert.equal(second.ok, true, "a description may be stale; an action may not");
      assert.equal(second.data!.stale, true);
      assert.equal(second.data!.agents.length, REGISTRY.agents.length);

      // ...and when it comes back, the copy is fresh again.
      down = false;
      expireRegistryCache();
      const third = await getRegistry();
      assert.equal(third.data!.stale, false);
    }
  );
  clearRegistryCache();
});

test("with no cached copy at all, an unreachable brain is reported, not faked", async () => {
  const { clearRegistryCache, getRegistry } = await import("@/lib/brain");
  clearRegistryCache();
  await withFetch(
    async () => {
      throw new Error("ECONNREFUSED");
    },
    async () => {
      const res = await getRegistry();
      assert.equal(res.ok, false);
      assert.equal(res.error, BRAIN_UNREACHABLE);
      assert.equal(res.reachable, false);
    }
  );
  clearRegistryCache();
});

test("the brain's own refusal reaches the user unedited", async () => {
  const { createTask } = await import("@/lib/brain");
  await withFetch(
    async () => jsonResponse({ error: '"tiktok_video" naam ka koi kaam registered nahi hai.' }, 400),
    async () => {
      const res = await createTask("t1", {
        action: "tiktok_video",
        params: {},
        when: null,
        delivery: "approvals",
        confidence: 1,
        missing: [],
        echo: "",
      });
      assert.equal(res.ok, false);
      assert.equal(res.error, '"tiktok_video" naam ka koi kaam registered nahi hai.');
      assert.equal(res.reachable, true, "the brain answered — it just said no");
    }
  );
});

test("every order carries an idempotency key even when the caller forgot one", async () => {
  const { createTask } = await import("@/lib/brain");
  let body: any;
  await withFetch(
    async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse({ task_id: "t", status: "queued", echo: "", outline: [], estimated_seconds: 1, cost_units: 1 });
    },
    async () => {
      await createTask(
        "t1",
        { action: "write_article", params: { topic: "solar" }, when: null, delivery: "approvals", confidence: 1, missing: [], echo: "e" },
        { conversationId: "c1", userId: "u1" }
      );
      assert.equal(typeof body.intent.idempotency_key, "string");
      assert.equal(body.intent.idempotency_key.length, 32);
      assert.equal(body.intent.source, "chat");
      assert.equal(body.intent.conversation_id, "c1");
      assert.equal("irreversible" in body.intent, false, "the caller never claims reversibility");
    }
  );
});

test("BRAIN_ENABLED: 1 on, 0 off, unset means on — in every environment, production included", async () => {
  // "Ek dimaag" (MASTER_PLAN §4): once Phase 1's exit criterion was met, an environment's
  // NAME stopped being allowed to decide which of two systems answers a message. The flag is
  // the only knob left, and it defaults on.
  const { brainEnabled } = await import("@/lib/brain");
  const realFlag = process.env.BRAIN_ENABLED;
  const realEnv = process.env.NODE_ENV;
  const set = (flag: string | undefined, env: string) => {
    if (flag === undefined) delete process.env.BRAIN_ENABLED; else process.env.BRAIN_ENABLED = flag;
    (process.env as any).NODE_ENV = env;
  };
  try {
    set("1", "production"); assert.equal(brainEnabled(), true);
    set("0", "development"); assert.equal(brainEnabled(), false);
    set("0", "production"); assert.equal(brainEnabled(), false, "the kill switch works in production too");
    set("true", "production"); assert.equal(brainEnabled(), true);
    set(undefined, "development"); assert.equal(brainEnabled(), true);
    set(undefined, "test"); assert.equal(brainEnabled(), true);
    set(undefined, "production"); assert.equal(brainEnabled(), true, "unset means on, in every environment now");
  } finally {
    if (realFlag === undefined) delete process.env.BRAIN_ENABLED; else process.env.BRAIN_ENABLED = realFlag;
    (process.env as any).NODE_ENV = realEnv;
  }
});
