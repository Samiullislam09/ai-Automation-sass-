/** lib/chat-brain.ts — one chat turn, routed through the brain.
 *
 *  This is the seam the plan's §5 describes and §10 governs: the intent engine says what was
 *  asked for, the brain makes it a task, and the user gets a SYSTEM CARD built from what the
 *  brain actually did — never from what the model said it would do.
 *
 *  WHY THIS IS A LIBRARY AND NOT A PIECE OF app/api/chat/route.ts. Everything here is a rule
 *  from §10 and a row in §14's acceptance table: one question and never two, an echo before
 *  anything irreversible, "nahi" cancels the pending order and NOTHING else, the same order
 *  twice is one task. Those rules are only worth anything if they are tested, and a Next.js
 *  route handler cannot be imported by `node --test` (it pulls in next/headers and a request
 *  context that does not exist outside a server). So the route stays a wiring diagram and the
 *  rules live here, behind an injected set of dependencies the tests replace with stubs.
 *
 *  WHAT IT WILL NOT DO. If the brain cannot be reached, this says so and stops. It does not
 *  quietly fall back to the old enqueue path — two systems both creating work is how one
 *  order becomes two articles and two bills, and it would be invisible until the invoice.
 */

import type { SystemEventPayload } from "@/lib/chat-events";
import type { BrainRegistry, BrainResult, BrainTaskCreated, BrainIntent } from "@/lib/brain";
import { BRAIN_UNREACHABLE } from "@/lib/brain";
import { ANSWER_QUESTION, capabilitiesPrompt, coerceParams, enabledActions, matchActionPhrase } from "@/lib/chat-tools";
import { CONFIDENCE_FLOOR, type IntentPlan } from "@/lib/chat-brain-intent";
import { CONFIRM_SLOT, resolveFollowUp, type ConversationState, type PendingIntent, type StateResult } from "@/lib/chat-conversation";
import { describeWhen, parseWhen } from "@/lib/when";
import { mightBeAnOrder } from "@/lib/chat-classify";
import { detectChatIntent } from "@/lib/chat-intent";

/** What the chat route hands back to the browser after an order. Identical to the shape the
 *  route has used since the do-channel landed: prose in `text`, the fact in `event`, and the
 *  three run fields set ONLY when something really started. */
export type OrderResult = {
  text: string;
  agentId: string | null;
  jobId: string | null;
  label: string | null;
  event?: SystemEventPayload;
};

const nothingStarted = (text: string, event?: SystemEventPayload): OrderResult => ({
  text,
  agentId: null,
  jobId: null,
  label: null,
  event,
});

/** The five things the brain still cannot carry out, which the old code path does today.
 *  Every one of these is a gap with a name, not a design: see the notes on `legacyKind`. */
export type LegacyKind = "schedule" | "cancel" | "reject" | "publish" | "unpublish";
export type LegacyJob = {
  kind: LegacyKind;
  which?: "next" | "all";
  message: string;
  /** A publish with a time on it is a booking, and a booking can be cancelled — so it is not
   *  irreversible and does not need an echo. Only "do it now" does. */
  scheduled?: boolean;
};

/** Which of the four old-path orders this message is, if any.
 *
 *  WHAT THE BRAIN STILL CANNOT DO. This function is the whole list, and every entry is a gap
 *  with a reason rather than a preference:
 *
 *   · the recurring timetable — "roz subah 9 baje 3 article". There is no manifest action for
 *     changing a schedule; it is a settings write, not work an agent does.
 *   · cancelling a booking — the brain cancels a task BY ID, but "wo booking cancel kar do"
 *     means working out which one, and today's bookings live in `scheduled_orders`, not in
 *     `tasks`.
 *   · rejecting a draft — a `content_items` status change, again not an agent's work.
 *   · publishing an existing article — NOT because the agent is unrouted any more (it moved
 *     out of `NOT_YET_ROUTED` the day Mr. Publish became real, and `publish_article` IS
 *     offered to the model as a tool today). The real gap is one step earlier: "isko publish
 *     kar do" needs to know WHICH article, and the intent engine's function-calling has no
 *     conversation-aware lookup for "the most recent one still waiting" the way
 *     `findPublishable()` below does — it sees the last two turns of chat text, not the
 *     database. Teaching the intent layer that lookup (so `publish_article`'s `content_item_id`
 *     gets filled the way `keywords` or `article` already can be, from context rather than
 *     always from the model) is the way this entry actually leaves the list; it is not on the
 *     roadmap yet, so it stays here, correctly, for a different reason than it used to.
 *
 *   · unpublishing an already-live article — the same gap as publish, one step earlier: "isko
 *     site se hata do" needs "isko" resolved against the database (the newest published item),
 *     which is exactly what findLatestPublished (lib/scheduled-orders.ts) does and what the
 *     intent engine's function-calling still cannot. Leaves the list the same way publish does.
 *
 *  Writing, research and planning are deliberately NOT here: they belong to the brain now, and
 *  returning them would mean two systems creating work for one sentence.
 *
 *  The three irreversible ones (publish-now, unpublish, cancel-everything) get the echo §10
 *  rule 2 has always asked for, through the same conversation_state row the brain's own
 *  confirmations use — so the user cannot tell which code will carry it out, and should not
 *  have to. */
export function legacyJobOf(message: string, tz: string): LegacyJob | null {
  const i = detectChatIntent(message);
  if (!i) return null;
  if (i.kind === "schedule" || i.kind === "reject" || i.kind === "unpublish") return { kind: i.kind, message };
  if (i.kind === "cancel") return { kind: "cancel", which: i.which, message };
  if (i.kind === "publish") return { kind: "publish", message, scheduled: !!parseWhen(message, tz) };
  return null;
}

/** The pending-order row, as this file needs it. The route builds one from Supabase; a test
 *  builds one from a variable. */
export type StateStore = {
  load(): Promise<ConversationState | null>;
  save(pending: PendingIntent, askedSlot: string, turnNo: number): Promise<StateResult>;
  clear(): Promise<StateResult>;
};

export type BrainTurnDeps = {
  getRegistry(): Promise<BrainResult<BrainRegistry>>;
  extractIntent(message: string, registry: BrainRegistry, opts: { tz: string; history?: any[]; now?: Date }): Promise<IntentPlan>;
  createTask(tenantId: string, intent: BrainIntent, opts: { userId?: string | null; conversationId?: string | null }): Promise<BrainResult<BrainTaskCreated>>;
  confirmTask(taskId: string, tenantId: string): Promise<BrainResult<any>>;
  cancelTask(taskId: string, tenantId: string): Promise<BrainResult<any>>;
  state: StateStore;
  /** The old path, for the orders the brain cannot do yet. Returns the same OrderResult. */
  runLegacy(job: LegacyJob): Promise<OrderResult>;
  /** Which of those four, if any, this message is. The route passes today's matcher. */
  legacyKind(message: string): LegacyJob | null;
};

export type BrainTurnInput = {
  message: string;
  tenantId: string;
  userId: string | null;
  conversationId: string | null;
  tz: string;
  history?: any[];
  now?: Date;
};

export type BrainTurn = {
  /** true → answer with `order` and do not call the conversation model. */
  handled: boolean;
  order?: OrderResult;
  /** For the conversation model when nothing was ordered: what the team can honestly claim. */
  capabilities?: string;
  /** For the timing log. */
  action?: string;
};

const conversation = (capabilities: string, action = ANSWER_QUESTION): BrainTurn => ({
  handled: false,
  capabilities,
  action,
});

/* ── Cards ───────────────────────────────────────────────────────────────────────────── */

/** The office room to light up, from the manifest — `office.room` is the id components/
 *  agents-data.ts already draws. Null when the registry does not say, which simply means no
 *  room animates rather than the wrong one. */
function roomOf(registry: BrainRegistry, action: string): string | null {
  for (const agent of registry.agents ?? []) {
    if ((agent.actions ?? []).some((a) => a.id === action)) return agent.office?.room ?? agent.id;
  }
  return null;
}

const outlineText = (created: BrainTaskCreated): string | undefined =>
  Array.isArray(created.outline) && created.outline.length ? created.outline.join(" → ") : undefined;

function etaText(seconds: number | undefined): string {
  const s = typeof seconds === "number" && seconds > 0 ? seconds : 0;
  if (!s) return "";
  return s < 90 ? `~${s}s` : `~${Math.round(s / 60)} min`;
}

/* ── The turn ────────────────────────────────────────────────────────────────────────── */

export async function brainTurn(input: BrainTurnInput, deps: BrainTurnDeps): Promise<BrainTurn> {
  const now = input.now ?? new Date();
  const message = String(input.message ?? "").trim();

  /* 1 ─ Is this the answer to something we asked? ------------------------------------- */
  const state = input.conversationId ? await deps.state.load() : null;
  const follow = resolveFollowUp(message, state, now);

  if (follow.kind === "confirm") {
    await deps.state.clear();
    return { handled: true, order: await runPending(follow.pending, input, deps, now), action: follow.pending.action };
  }

  if (follow.kind === "cancel") {
    // THE RULE THIS BRANCH EXISTS FOR: a "no" cancels the order that was waiting, and nothing
    // else. It never reaches the cancel-a-booking path — "publish mat karna" once cancelled a
    // customer's next booked article, and there is no undo for that.
    await deps.state.clear();
    if (follow.pending.route === "task" && follow.pending.task_id) {
      const res = await deps.cancelTask(follow.pending.task_id, input.tenantId);
      if (!res.ok) {
        return {
          handled: true,
          order: nothingStarted(`Theek hai — nahi karta. (${res.error})`, {
            kind: "info",
            title: "Nahi kiya",
            detail: follow.pending.echo || undefined,
          }),
          action: follow.pending.action,
        };
      }
    }
    return {
      handled: true,
      order: nothingStarted("Theek hai — nahi kiya. Aur kuch nahi badla.", {
        kind: "info",
        title: "Nahi kiya",
        detail: follow.pending.echo || undefined,
      }),
      action: follow.pending.action,
    };
  }

  if (follow.kind === "lapsed") {
    // The echo went unanswered, or they moved on. The order is dropped — silently, because the
    // user did not ask about it — and this message is read as a fresh one.
    await deps.state.clear();
  }

  /* 2 ─ The four things the brain cannot do yet -------------------------------------- */
  //
  // Checked BEFORE the model, deliberately. These are today's matcher's own decisions, they
  // are instant and free, and they behave exactly as they did before the brain existed. The
  // two irreversible ones get the echo they were always supposed to have.
  const legacy = follow.kind === "slot" ? null : deps.legacyKind(message);
  if (legacy) {
    const irreversible =
      (legacy.kind === "publish" && !legacy.scheduled) ||
      legacy.kind === "unpublish" ||
      (legacy.kind === "cancel" && legacy.which === "all");
    if (!irreversible) return { handled: true, order: await deps.runLegacy(legacy), action: `legacy:${legacy.kind}` };
    return {
      handled: true,
      order: await askToConfirmLegacy(legacy, input, deps, now),
      action: `legacy:${legacy.kind}`,
    };
  }

  /* 3 ─ What can the team do right now? ----------------------------------------------- */
  const reg = await deps.getRegistry();
  if (!reg.ok || !reg.data) {
    // Refusing to greet someone because the registry is down would be absurd, so a message
    // that does not even mention the work goes to the conversation model as usual. Anything
    // that might be an order is answered honestly instead of being routed somewhere else.
    if (!mightBeAnOrder(message)) return conversation("");
    return {
      handled: true,
      order: nothingStarted(reg.error ?? BRAIN_UNREACHABLE, {
        kind: "failed",
        title: "Kuch shuru nahi hua",
        detail: reg.error ?? BRAIN_UNREACHABLE,
      }),
      action: "brain_unreachable",
    };
  }
  const registry = reg.data;
  const capabilities = capabilitiesPrompt(registry);

  /* 4 ─ Filling in the one thing we asked about --------------------------------------- */
  if (follow.kind === "slot") {
    const pending = follow.pending;
    const base = pending.intent;
    if (!base) {
      await deps.state.clear();
    } else if (follow.value === null) {
      // "tum chuno" on a slot the action REQUIRES. The brain's planner would refuse the task
      // (a required input is required), and inventing a value here is the one thing this
      // whole file exists to prevent — so the question stands, with the reason attached.
      await deps.state.save(pending, follow.slot, state?.turn_no ?? 0);
      return {
        handled: true,
        order: nothingStarted(
          `Ye ek cheez mujhe aap se chahiye — apni marzi se chun ke galat kaam shuru karna isse bura hai. ` +
            `${humanSlot(follow.slot)} ek line me bata do.`
        ),
        action: pending.action,
      };
    } else {
      const filled: IntentPlan = {
        ...base,
        params: { ...(base.params ?? {}), [follow.slot]: follow.value },
        missing: (base.missing ?? []).filter((m) => m !== follow.slot),
      };
      await deps.state.clear();
      return { handled: true, order: await placeOrder(filled, registry, input, deps, now), action: filled.action };
    }
  }

  /* 5 ─ What did they ask for? --------------------------------------------------------- */
  const intent = await deps.extractIntent(message, registry, { tz: input.tz, history: input.history, now });

  // THE MANIFEST'S OWN PHRASES OVERRULE A "this is just a question" READING.
  //
  // The model kept classifying a bare "ek article likho" as a question and answering it
  // conversationally — no task, no work, and to the customer it looks like the product is
  // interviewing them instead of doing the job (owner, 2026-08-31: "user se kuch nahi
  // puchega"). When someone types an action's own registered trigger phrase, that is not a
  // question, whatever the model decided; §5.1's deterministic fast path exists precisely so
  // routing does not rest on the model's mood.
  //
  // Deliberately one-directional: a phrase match can turn a QUESTION into work, never the
  // reverse, and it cannot redirect one action to another. Params are re-coerced against the
  // action being routed to, so the question tool's own loose `topic` ("article") cannot leak in
  // as a real subject — anything the action lists in `needs` is dropped and the planner fills it
  // from the customer's own site instead.
  let routed = intent;
  const known = enabledActions(registry);
  if (intent.action === ANSWER_QUESTION || !known.has(intent.action)) {
    const byPhrase = matchActionPhrase(message, registry);
    const spec = byPhrase ? known.get(byPhrase)?.spec : undefined;
    if (byPhrase && spec) {
      const graphFills = new Set((spec.needs ?? []).map(String));
      const params = coerceParams(spec, intent.params ?? {});
      for (const need of Array.from(graphFills)) delete (params as Record<string, unknown>)[need];
      routed = { ...intent, action: byPhrase, params, missing: [] };
    } else {
      return conversation(capabilities, intent.action);
    }
  }

  /* 6 ─ Sure enough to spend money? ---------------------------------------------------- */
  if (routed.missing.length > 0) {
    // ONE question (§10 rule 3). The most important missing thing is the first one the action
    // declares; the rest are asked for later or defaulted, never all at once.
    const slot = routed.missing[0];
    const saved = await deps.state.save(
      { v: 1, route: "slot", action: routed.action, echo: routed.echo, message, intent: routed },
      slot,
      state?.turn_no ?? 0
    );
    const ask = `${humanSlot(slot)}? Ek line me bata do aur main team ko bhej deta hun.`;
    return {
      handled: true,
      order: nothingStarted(saved.ok ? ask : `${ask} (Pichhli baat yaad nahi rakh paunga — poora order ek message me likh dena.)`),
      action: routed.action,
    };
  }

  // Plan §3 rule 2, in its own words: "Publish live site pe, sab cancel, 10 article ek saath —
  // inse pehle system ek line me dohrata hai... Draft likhna, keyword research — ye reversible
  // hain, SEEDHA KARO." So the confidence floor gates the IRREVERSIBLE actions only. Applying it
  // to a draft meant "write an article" came back as "Main pakka nahi hun — haan bolo?" on a
  // request that could not have been clearer, which is the interrogation the owner keeps
  // objecting to (2026-08-31: "user se kuch nahi puchega"). A draft that turns out wrong costs
  // one rejected item in Approvals; asking about every one of them costs the product's whole
  // reason to exist.
  const targetSpec = enabledActions(registry).get(routed.action)?.spec;
  const needsConfirmation = !!targetSpec?.irreversible || routed.delivery === "publish";
  if (routed.confidence < CONFIDENCE_FLOOR && needsConfirmation) {
    const saved = await deps.state.save(
      { v: 1, route: "slot", action: routed.action, echo: routed.echo, message, intent: routed },
      CONFIRM_SLOT,
      state?.turn_no ?? 0
    );
    const ask = `Main pakka nahi hun — aapka matlab ye hai? **${routed.echo}** — "haan" bolo to shuru karta hun.`;
    return {
      handled: true,
      order: nothingStarted(saved.ok ? ask : `${ask} (Ye sawaal yaad nahi rahega — order poora dobara likh dena.)`),
      action: routed.action,
    };
  }

  /* 7 ─ Order it ----------------------------------------------------------------------- */
  return { handled: true, order: await placeOrder(routed, registry, input, deps, now), action: routed.action };
}

/** "topic" → "Kis topic pe". Generic on purpose: a new agent's slot gets a sentence the day it
 *  registers, without this file learning its name. */
function humanSlot(slot: string): string {
  const word = String(slot ?? "").replace(/_/g, " ").trim() || "detail";
  return `Kis ${word} pe`;
}

/* ── Creating the task, and saying what happened ─────────────────────────────────────── */

async function placeOrder(
  intent: IntentPlan,
  registry: BrainRegistry,
  input: BrainTurnInput,
  deps: BrainTurnDeps,
  now: Date
): Promise<OrderResult> {
  const wire: BrainIntent = {
    action: intent.action,
    params: intent.params,
    when: intent.when,
    delivery: intent.delivery,
    confidence: intent.confidence,
    missing: intent.missing,
    echo: intent.echo,
  };

  const res = await deps.createTask(input.tenantId, wire, {
    userId: input.userId,
    conversationId: input.conversationId,
  });

  if (!res.ok || !res.data) {
    // The brain's own sentence, unedited. It is already written for a customer, and rewriting
    // it here would put the same message in two places and let them drift.
    const why = res.error ?? BRAIN_UNREACHABLE;
    return nothingStarted(why, { kind: "failed", title: "Kuch shuru nahi hua", detail: why });
  }

  const created = res.data;
  const room = roomOf(registry, intent.action);
  const eta = etaText(created.estimated_seconds);
  const lands = intent.delivery === "publish" ? "Seedha site pe live jaayega." : "Approvals me aayega.";

  if (created.duplicate) {
    // The double-click guard did its job: the same order in the same minute is ONE task.
    return nothingStarted("Wahi order pehle se lag chuka hai — dobara shuru nahi kiya.", {
      kind: "info",
      title: "Pehle se lag chuka hai",
      detail: created.echo || intent.echo || undefined,
      task_id: created.task_id,
    });
  }

  if (created.status === "awaiting_confirm") {
    const saved = await deps.state.save(
      { v: 1, route: "task", action: intent.action, echo: created.echo || intent.echo, message: input.message, task_id: created.task_id },
      CONFIRM_SLOT,
      0
    );
    if (!saved.ok) {
      // An order waiting for a yes we have no way to hear is worse than no order: it would sit
      // in `awaiting_confirm` forever and the user would believe it was booked. Take it back.
      await deps.cancelTask(created.task_id, input.tenantId);
      return nothingStarted(
        `Ye kaam wapas nahi liya ja sakta, isliye pehle poochhna zaroori tha — par aapka jawab yaad rakhne ki jagah nahi mili, ` +
          `to maine kuch shuru nahi kiya. Dobara bhejiye.${saved.missingTable ? " (Dev: migration 017 chalao.)" : ""}`,
        { kind: "failed", title: "Kuch shuru nahi hua", detail: saved.error }
      );
    }
    return nothingStarted("Ek baar confirm kar dijiye.", {
      // §10 rule 2. The card asks the question and carries the two answers; the sentence next
      // to it stays out of the way, because a second voice only muddies an irreversible
      // decision — and the card is the half with evidence behind it.
      kind: "needs_confirm",
      title: created.echo || intent.echo,
      detail: [outlineText(created), eta ? `${eta} lagega.` : "", lands].filter(Boolean).join(" · "),
      task_id: created.task_id,
      agent: room ?? undefined,
      actions: [
        { label: "Haan, karo", action: "confirm", payload: { text: "haan, kar do" } },
        { label: "Nahi", action: "cancel", payload: { text: "nahi, rehne do" } },
      ],
    });
  }

  if (created.status === "scheduled" && intent.when) {
    const at = describeWhen(new Date(intent.when.at), input.tz, now);
    return nothingStarted(
      `Theek hai — ${at} pe shuru hoga. Abhi kuch nahi chal raha.`,
      {
        // §10 rules 4 and 5: what, when (in their zone), where it lands, and the way out.
        kind: "booked",
        title: `Booked · ${at}`,
        detail: [created.echo || intent.echo, `${input.tz}`, lands].filter(Boolean).join(" · "),
        task_id: created.task_id,
        agent: room ?? undefined,
        actions: [{ label: "Cancel", action: "cancel", payload: { text: "cancel this booking" } }],
      }
    );
  }

  return {
    text: "On it.",
    agentId: room,
    jobId: created.task_id,
    label: created.echo || intent.echo || null,
    event: {
      kind: "running",
      title: "Started",
      detail: [outlineText(created), eta ? `${eta} lagega.` : "", lands].filter(Boolean).join(" · "),
      agent: room ?? undefined,
      task_id: created.task_id,
      actions: [{ label: "Cancel", action: "cancel", payload: { text: "cancel this booking" } }],
    },
  };
}

/* ── Resuming ────────────────────────────────────────────────────────────────────────── */

async function runPending(
  pending: PendingIntent,
  input: BrainTurnInput,
  deps: BrainTurnDeps,
  now: Date
): Promise<OrderResult> {
  if (pending.route === "task" && pending.task_id) {
    const res = await deps.confirmTask(pending.task_id, input.tenantId);
    if (!res.ok) {
      const why = res.error ?? BRAIN_UNREACHABLE;
      return nothingStarted(why, { kind: "failed", title: "Shuru nahi hua", detail: why, task_id: pending.task_id });
    }
    return {
      text: "Chalu kar diya.",
      agentId: null,
      jobId: pending.task_id,
      label: pending.echo || null,
      event: {
        kind: "running",
        title: "Started",
        detail: pending.echo || undefined,
        task_id: pending.task_id,
        actions: [{ label: "Cancel", action: "cancel", payload: { text: "cancel this booking" } }],
      },
    };
  }

  if (pending.route === "legacy" && pending.legacy) {
    return deps.runLegacy({
      kind: pending.legacy.kind as LegacyKind,
      which: pending.legacy.which as "next" | "all" | undefined,
      message: pending.message,
    });
  }

  if (pending.route === "slot" && pending.intent) {
    const reg = await deps.getRegistry();
    if (!reg.ok || !reg.data) {
      const why = reg.error ?? BRAIN_UNREACHABLE;
      return nothingStarted(why, { kind: "failed", title: "Kuch shuru nahi hua", detail: why });
    }
    return placeOrder(pending.intent, reg.data, input, deps, now);
  }

  return nothingStarted("Wo order ab yaad nahi raha — dobara bata dijiye, main turant laga deta hun.");
}

/** The echo for an order the OLD path will carry out. Same card, same buttons, same expiry —
 *  the user cannot tell which code will run it, and should not have to. */
async function askToConfirmLegacy(
  legacy: LegacyJob,
  input: BrainTurnInput,
  deps: BrainTurnDeps,
  now: Date
): Promise<OrderResult> {
  const echo =
    legacy.kind === "publish"
      ? "Ye article abhi aapki live site pe daal dun?"
      : legacy.kind === "unpublish"
        ? "Ye article abhi live site se hata dun?"
        : "Saare booked orders cancel kar dun?";

  const saved = await deps.state.save(
    { v: 1, route: "legacy", action: `legacy:${legacy.kind}`, echo, message: legacy.message, legacy: { kind: legacy.kind, which: legacy.which } },
    CONFIRM_SLOT,
    0
  );
  if (!saved.ok) {
    return nothingStarted(
      `Ye wapas nahi liya ja sakta, isliye pehle poochhna tha — par aapka jawab yaad rakhne ki jagah nahi mili, to maine kuch nahi kiya.` +
        `${saved.missingTable ? " (Dev: migration 017 chalao.)" : ""}`,
      { kind: "failed", title: "Kuch nahi hua", detail: saved.error }
    );
  }

  return nothingStarted("Ek baar confirm kar dijiye.", {
    kind: "needs_confirm",
    title: echo,
    detail: "Ye wapas nahi liya ja sakta, isliye ek baar poochh raha hun.",
    actions: [
      { label: "Haan, karo", action: "confirm", payload: { text: "haan, kar do" } },
      { label: "Nahi", action: "cancel", payload: { text: "nahi, rehne do" } },
    ],
  });
}
