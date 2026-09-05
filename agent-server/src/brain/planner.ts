/** The planner — one Intent in, one ordered Plan out. No LLM anywhere in this file.
 *
 *  Plan §5.5 is explicit about two things and this file is a direct transcription of both:
 *
 *   "Planner tay karta hai, aur Planner LLM nahi hai — code hai."
 *   "Planner peeche se aage nahi, TARGET SE PEECHE chalta hai: publish chahiye → uske liye
 *    article → uske liye keywords. Target keyword hai to wahin ruk jaata hai."
 *
 *  So the algorithm is target-backwards. It starts at the action the intent names, walks that
 *  action's `needs` to whoever `provides` them, recursively, and stops. Nothing pulls a step in
 *  from the front. That is why "sirf keywords do" is a one-step plan and never wakes the writer.
 *
 *  ── THE THREE RULES ─────────────────────────────────────────────────────────────────────
 *
 *  1. BACKWARD CLOSURE. target → its needs → their providers → their needs → … , and a need the
 *     intent already carries as a param is satisfied there and then, with no producer step. That
 *     is what stops "is article ki image badlo" from writing a second article, and what makes
 *     "isko publish kar do (existing)" the 1-2 step plan §5.5 predicts instead of the full five.
 *
 *  2. DELIVERY. `delivery: "publish"` appends the irreversible delivery action — the registered
 *     action that (a) is `irreversible` and (b) directly needs what the target provides. Today
 *     that is `publish_article`, which needs `seo_passed`, which is why asking to publish drags
 *     Mr. SEO into the plan and asking for a draft does not. `delivery: "approvals"` never
 *     appends it.
 *
 *  3. FINISHERS (why "article likho" is 4 steps and not 2). Plan §5.5's step table runs the
 *     image and SEO steps even when the article is only going to Approvals — a human reviewing
 *     a draft should see its SEO score and its images. That is not something the target's own
 *     `needs` can express, so it is derived from the graph instead of hard-coded:
 *
 *         F is a finisher of the target when
 *           (a) target.provides ∈ F.needs                    — F works ON the target's output
 *           (b) the actions that need F.provides are exactly {D}, and there is at least one
 *                                                             — F's only customer is delivery
 *
 *     `check_seo` provides `seo_passed`, which only `publish_article` consumes → finisher.
 *     An image action provides `images`, which only `publish_article` consumes → finisher.
 *     `draft_social` provides `social_posts`, which nobody consumes → NOT a finisher, so social
 *     stays off unless the user asked for it (plan: "Social — sirf agar schedule me on ho").
 *     `write_article` provides `article`, consumed by seo/image/social/publish → not a finisher
 *     of `find_keywords`, so "sirf keywords do" stays one step.
 *
 *     A finisher pulled in for Approvals is advisory: if its agent is down the step is SKIPPED
 *     with a note. The same action pulled in as a hard need of `publish_article` is required and
 *     its absence fails the plan — "publish ke liye SEO check zaroori hai".
 *
 *  ── INPUT THREADING (the `__from` convention) ───────────────────────────────────────────
 *
 *  A step's `input` is two things merged:
 *
 *    • the literal intent params whose names match a field in the action's `input` schema
 *      (so `topic` reaches both Mr. Keyword and Mr. Writer without anybody wiring it), and
 *    • `__from`, a declaration of provenance the orchestrator resolves at run time:
 *
 *          __from: { "<need name>": "step:<no>:<agent_id>" }
 *
 *      e.g. Mr. Writer gets `{ topic: "solar", __from: { keywords: "step:1:keyword" } }`.
 *
 *  `step:<no>:<agent_id>` is used rather than a bare step number because `no` is NOT unique —
 *  parallel steps share it on purpose. `(no, agent_id)` is exactly the unique key of
 *  `task_steps` in migration 017 (`unique (task_id, no, agent_id)`), so the orchestrator can
 *  resolve a reference with a single lookup and no extra bookkeeping. The value it merges in is
 *  that step's `output`, under the need's name. A need that was skipped gets no `__from` entry
 *  and no entry in `needs` — the orchestrator must not wait for a step that will never run.
 *
 *  ── TIME AND MONEY ARE COUNTED DIFFERENTLY ──────────────────────────────────────────────
 *
 *  `cost_units` is the SUM: every step that runs is paid for, parallel or not.
 *  `estimated_seconds` is the CRITICAL PATH: steps sharing a `no` run at the same time, so a
 *  level costs its slowest member, not its total. Image (60s) ‖ SEO (40s) is 60 seconds of
 *  waiting and 18 credits of spending. Telling the user "100s" would be a lie in the one
 *  direction that makes the product feel slower than it is.
 *
 *  ── FAILURES ARE VALUES ─────────────────────────────────────────────────────────────────
 *
 *  Nothing here throws. Every way a plan can fail is a `PlanFailure` plus one sentence the user
 *  can actually read, because all of them are reachable from a normal chat message and the user
 *  is owed a reason, not a stack trace. Plan §5.5's panga table: caught while planning, "0
 *  credits kharch".
 */

import type { Intent, Plan, PlanFailure, PlanResult, PlanStep } from "./types.js";
import type { RegisteredAction, Registry } from "./registry.js";
import { consumersOf, isAvailable, providersOf } from "./registry.js";

// ── the words the user reads ─────────────────────────────────────────────────────────────

/** What a `provides` name is called in a sentence. Anything not listed falls back to the
 *  raw name, which is ugly but never wrong. */
const NOUN: Record<string, string> = {
  keywords: "keywords",
  article: "article",
  seo_passed: "SEO check",
  images: "images",
  published_url: "publish",
  brief: "research brief",
  site_pages: "site ka content",
  site_profile: "site profile",
  topics: "topics",
  topic: "topic",
  social_posts: "social posts",
  leads: "leads",
};

/** What a step is doing, in the outline. */
const VERB: Record<string, string> = {
  keywords: "keywords nikalega",
  article: "article likhega",
  seo_passed: "SEO check karega",
  images: "images banayega",
  published_url: "site pe live karega",
  brief: "research brief banayega",
  site_pages: "site padhega",
  site_profile: "site profile banayega",
  topics: "topics chunega",
  topic: "best topic chunega",
  social_posts: "social posts banayega",
  leads: "leads dhundega",
};

const noun = (provides: string): string => NOUN[provides] ?? provides;
const verb = (provides: string): string => VERB[provides] ?? `${provides} banayega`;

export function humanSeconds(secs: number): string {
  if (secs < 90) return `~${secs}s`;
  return `~${Math.round(secs / 60)} min`;
}

// ── internals ────────────────────────────────────────────────────────────────────────────

type Fail = { failure: PlanFailure; message: string };
const isFail = (x: unknown): x is Fail => !!x && typeof x === "object" && "failure" in (x as object);

type Picked = { entry: RegisteredAction; required: boolean };

/** Turn one intent into an ordered plan, or into one sentence saying why not. */
export function plan(intent: Intent, registry: Registry): PlanResult {
  // ── 0. does this action exist at all? ──────────────────────────────────────────────────
  const target = registry.actions.get(intent.action);
  if (!target) {
    return {
      ok: false,
      failure: { kind: "unknown_action", action: intent.action },
      message: unknownActionMessage(intent.action, registry),
    };
  }

  // ── 1. slots. Checked on the TARGET only, on purpose: the intent engine fills slots for the
  //      tool the user named. Every other step is fed by the graph (see `__from`), so a gap
  //      there is a manifest bug, not something to ask the user about. ─────────────────────
  //      A required field that is also one of the action's `needs` is NOT a missing slot: a
  //      previous step will feed it through `__from`. Asking the user to paste an article into
  //      chat because `make_images.input.article` is required would be absurd.
  const required = Object.entries(target.spec.input)
    .filter(([field, type]) => !type.endsWith("?") && !target.spec.needs.includes(field))
    .map(([field]) => field);
  const missing = [...new Set([...intent.missing, ...required.filter((f) => isBlank(intent.params[f]))])];
  if (missing.length > 0) {
    return { ok: false, failure: { kind: "missing_slots", slots: missing }, message: missingSlotsMessage(missing) };
  }

  // ── 2. who delivers, and who finishes ──────────────────────────────────────────────────
  const delivery = findDeliveryAction(registry, target);
  const finishers = delivery ? findFinishers(registry, target, delivery) : [];

  // ── 3. backward closure from the roots ─────────────────────────────────────────────────
  const chosen = new Map<string, Picked>();
  /** action id → need name → the action id that will provide it (only for needs in the plan) */
  const bindings = new Map<string, Record<string, string>>();
  /** action id → the one line telling the user it was skipped */
  const skips = new Map<string, string>();
  const visiting: string[] = [];

  const add = (actionId: string, isRequired: boolean, forAction: RegisteredAction | null): Fail | "added" | "skipped" => {
    const existing = chosen.get(actionId);
    if (existing) {
      if (isRequired) existing.required = true;
      return "added";
    }
    if (skips.has(actionId)) return "skipped";

    const cycleAt = visiting.indexOf(actionId);
    if (cycleAt >= 0) {
      const involved = [...visiting.slice(cycleAt), actionId];
      return { failure: { kind: "cycle", involved }, message: cycleMessage(involved) };
    }

    const entry = registry.actions.get(actionId);
    if (!entry) {
      // Only reachable if a provider vanished between lookups; treated as "nobody provides it".
      const need = forAction ? actionId : intent.action;
      return { failure: { kind: "no_provider", need, forStep: forAction?.spec.id ?? intent.action }, message: noProviderMessage(need, forAction) };
    }

    const skippable = !isRequired || entry.spec.optional === true;
    const available = isAvailable(registry, actionId);

    if (!available && skippable) {
      skips.set(actionId, skipMessage(registry, entry));
      return "skipped";
    }

    visiting.push(actionId);
    const bound: Record<string, string> = {};
    for (const need of entry.spec.needs) {
      // The user already handed us this one. "Is article ki image badlo" carries the article,
      // so the planner must not walk back and write a new article to satisfy `needs: [article]`.
      // This is what makes §5.5's "isko publish kar do (existing)" a 1-2 step plan instead of
      // the full 5: the thing being published already exists.
      if (!isBlank(intent.params[need])) continue;

      const providers = providersOf(registry, need);
      if (providers.length === 0) {
        visiting.pop();
        if (skippable) {
          skips.set(actionId, skipMessage(registry, entry));
          return "skipped";
        }
        return { failure: { kind: "no_provider", need, forStep: entry.spec.id }, message: noProviderMessage(need, entry) };
      }
      // Prefer a provider we can actually reach; ties broken by id so the plan is reproducible.
      const provider =
        [...providers].sort((a, b) => a.spec.id.localeCompare(b.spec.id)).find((p) => isAvailable(registry, p.spec.id)) ??
        [...providers].sort((a, b) => a.spec.id.localeCompare(b.spec.id))[0];

      // "images optional hai, seo_passed nahi" — optionality lives on the PROVIDER's manifest.
      const childRequired = isRequired && provider.spec.optional !== true;
      const res = add(provider.spec.id, childRequired, entry);

      if (isFail(res)) {
        // A cycle is a manifest bug and must surface even from inside an optional branch;
        // an unavailable agent inside a branch we are allowed to drop just drops the branch.
        if (res.failure.kind === "cycle" || !skippable) {
          visiting.pop();
          return res;
        }
        visiting.pop();
        skips.set(actionId, skipMessage(registry, entry));
        return "skipped";
      }
      if (res === "added") bound[need] = provider.spec.id;
    }
    visiting.pop();

    // Health is checked AFTER the needs walk so the user hears about the deepest missing
    // agent ("Mr. SEO abhi available nahi hai") rather than the last one in the chain.
    if (!available) {
      return { failure: { kind: "agent_unhealthy", agent_id: entry.agent_id, required: true }, message: unhealthyMessage(registry, entry, forAction) };
    }

    chosen.set(actionId, { entry, required: isRequired });
    bindings.set(actionId, bound);
    return "added";
  };

  // Target first, then the delivery action (so its hard needs are reported as hard failures),
  // then the advisory finishers.
  const rootTarget = add(target.spec.id, true, null);
  if (isFail(rootTarget)) return { ok: false, failure: rootTarget.failure, message: rootTarget.message };
  if (rootTarget === "skipped") {
    // The target itself is unavailable and marked optional — still nothing we can run.
    return {
      ok: false,
      failure: { kind: "agent_unhealthy", agent_id: target.agent_id, required: true },
      message: unhealthyMessage(registry, target, null),
    };
  }

  if (intent.delivery === "publish" && delivery && delivery.spec.id !== target.spec.id) {
    const res = add(delivery.spec.id, true, null);
    if (isFail(res)) return { ok: false, failure: res.failure, message: res.message };
  }

  for (const f of finishers) {
    const res = add(f.spec.id, false, null);
    if (isFail(res) && res.failure.kind === "cycle") return { ok: false, failure: res.failure, message: res.message };
  }

  // ── 3b. the extras the user asked for by name ──────────────────────────────────────────
  //
  // A Web Story is not part of DELIVERING an article — nothing consumes `web_story`, so the
  // graph walk above will never reach it, and that is correct: a story is a second deliverable,
  // not a step on the way to the first. It is planned only when the user said yes, which they
  // are asked once while the order is being taken (MASTER_PLAN §19.4.6, `with_story`).
  //
  // Added as OPTIONAL: a story that cannot be built must not take the article down with it.
  for (const [param, actionId] of Object.entries(EXTRAS)) {
    if (intent.params[param] !== true) continue;
    const extra = registry.actions.get(actionId);
    if (!extra) continue; // the agent is not in this deployment — nothing to plan, nothing to claim
    const res = add(actionId, false, null);
    if (isFail(res) && res.failure.kind === "cycle") return { ok: false, failure: res.failure, message: res.message };
  }

  // ── 4. numbering: independent steps share a `no` so the orchestrator runs them together ──
  const numbers = new Map<string, number>();
  const numberOf = (actionId: string): number => {
    const cached = numbers.get(actionId);
    if (cached !== undefined) return cached;
    const bound = bindings.get(actionId) ?? {};
    let n = 1;
    for (const providerId of Object.values(bound)) {
      if (chosen.has(providerId)) n = Math.max(n, numberOf(providerId) + 1);
    }
    numbers.set(actionId, n);
    return n;
  };
  for (const id of chosen.keys()) numberOf(id);

  const ordered = [...chosen.entries()].sort((a, b) => {
    const byNo = numberOf(a[0]) - numberOf(b[0]);
    if (byNo !== 0) return byNo;
    // Slowest first inside a level: it is the one that sets the level's duration.
    const byTime = b[1].entry.spec.estimated_seconds - a[1].entry.spec.estimated_seconds;
    return byTime !== 0 ? byTime : a[0].localeCompare(b[0]);
  });

  const steps: PlanStep[] = ordered.map(([actionId, picked]) => {
    const bound = bindings.get(actionId) ?? {};
    const literal: Record<string, unknown> = {};
    for (const field of Object.keys(picked.entry.spec.input)) {
      if (intent.params[field] !== undefined) literal[field] = intent.params[field];
    }
    const from: Record<string, string> = {};
    for (const [need, providerId] of Object.entries(bound)) {
      from[need] = `step:${numberOf(providerId)}:${chosen.get(providerId)!.entry.agent_id}`;
    }
    return {
      no: numberOf(actionId),
      agent_id: picked.entry.agent_id,
      action: actionId,
      // Only the needs that a real step in THIS plan satisfies — a skipped need must not
      // become something the orchestrator waits forever for.
      needs: Object.keys(bound),
      provides: picked.entry.spec.provides,
      optional: picked.entry.spec.optional === true || !picked.required,
      input: Object.keys(from).length > 0 ? { ...literal, __from: from } : literal,
    };
  });

  // ── 5. what it costs and how long it takes ──────────────────────────────────────────────
  const cost_units = steps.reduce((sum, s) => sum + specOf(registry, s.action).cost_units, 0);
  const byLevel = new Map<number, number>();
  for (const s of steps) {
    const secs = specOf(registry, s.action).estimated_seconds;
    byLevel.set(s.no, Math.max(byLevel.get(s.no) ?? 0, secs));
  }
  const estimated_seconds = [...byLevel.values()].reduce((a, b) => a + b, 0);

  const outline = buildOutline(registry, steps, [...skips.values()]);

  return { ok: true, plan: { steps, outline, estimated_seconds, cost_units } satisfies Plan };
}

// ── graph helpers ────────────────────────────────────────────────────────────────────────

/** The irreversible action that takes what the target produces — `publish_article` today.
 *  "Directly needs" is deliberate: `publish_article` needs `article`, so it is the delivery
 *  action for `write_article` but NOT for `find_keywords`, which is why "sirf keywords do"
 *  never grows a publish step. */
export function findDeliveryAction(registry: Registry, target: RegisteredAction): RegisteredAction | null {
  if (target.spec.irreversible) return target;
  const candidates = consumersOf(registry, target.spec.provides)
    .filter((a) => a.spec.irreversible)
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id));
  return candidates[0] ?? null;
}

/** Steps that work on the target's output and whose only customer is the delivery action.
 *  See rule 3 in the header for why this is the definition. */
export function findFinishers(registry: Registry, target: RegisteredAction, delivery: RegisteredAction): RegisteredAction[] {
  if (delivery.spec.id === target.spec.id) return [];
  const extras = new Set(Object.values(EXTRAS));
  const out: RegisteredAction[] = [];
  for (const candidate of registry.actions.values()) {
    if (candidate.spec.id === target.spec.id || candidate.spec.id === delivery.spec.id) continue;
    if (!candidate.spec.needs.includes(target.spec.provides)) continue;
    // An EXTRA does not count as a customer. Mr. Story needs `images`, but it is a second
    // deliverable the user opted into — not part of delivering the article — and letting it
    // count made Mr. Image stop being a finisher the moment Mr. Story was registered, so
    // "article likho" quietly lost its pictures (caught by planner.test.ts, 2026-09-05).
    const customers = consumersOf(registry, candidate.spec.provides).filter((c) => !extras.has(c.spec.id));
    if (customers.length === 0) continue; // nobody wants it → not part of delivering the target
    if (customers.every((c) => c.spec.id === delivery.spec.id)) out.push(candidate);
  }
  return out.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}

function specOf(registry: Registry, actionId: string) {
  return registry.actions.get(actionId)!.spec;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function agentName(registry: Registry, agentId: string): string {
  return registry.agents.get(agentId)?.manifest.name ?? agentId;
}

// ── the sentences ────────────────────────────────────────────────────────────────────────

function buildOutline(registry: Registry, steps: PlanStep[], skipNotes: string[]): string[] {
  const levelSize = new Map<number, number>();
  for (const s of steps) levelSize.set(s.no, (levelSize.get(s.no) ?? 0) + 1);
  const seenInLevel = new Map<number, number>();

  const lines = steps.map((s) => {
    const spec = specOf(registry, s.action);
    const parallel = (levelSize.get(s.no) ?? 1) > 1;
    const idx = seenInLevel.get(s.no) ?? 0;
    seenInLevel.set(s.no, idx + 1);
    const label = parallel ? `${s.no}${String.fromCharCode(97 + idx)}` : `${s.no}`;
    const first = s.no === 1 && steps.length > 1 ? "pehle " : "";
    const time = humanSeconds(spec.estimated_seconds);
    const tail = parallel ? " ‖ saath me" : "";
    return `${label}. ${agentName(registry, s.agent_id)} ${first}${verb(spec.provides)} (${time})${tail}`;
  });

  return [...lines, ...skipNotes.map((n) => `— ${n}`)];
}

function unknownActionMessage(action: string, registry: Registry): string {
  const tokens = action.split(/[_\s]+/).filter((t) => t.length > 2);
  const near = [...registry.actions.keys()]
    .filter((id) => id !== action && tokens.some((t) => id.includes(t)))
    .sort()
    .slice(0, 2);
  const base = `"${action}" jaisa koi kaam abhi team ke paas nahi hai, isliye main ye nahi kar sakta.`;
  if (near.length === 0) return `${base} Jab ye agent ban jaayega, main khud bataunga.`;
  const list = near.map((id) => `${id} (${agentName(registry, registry.actions.get(id)!.agent_id)})`).join(" ya ");
  return `${base} Shayad aap ${list} chahte the?`;
}

/** A slot the user can be asked about in words rather than by its field name. A field with no
 *  entry here is still asked for — by name — which is ugly but honest; adding a sentence here
 *  is how a new question stops looking like a form. */
const SLOT_QUESTION: Record<string, string> = {
  // MASTER_PLAN §19.4.6. Asked once, while the order is being taken, so the answer costs
  // nothing later: a story reuses the article's own pictures and only makes two of its own.
  with_story:
    "Iska Web Story bhi bana doon? (Google Discover me alag carousel milta hai — article ki apni images reuse hoti hain, sirf 2 nayi banti hain.) Haan ya nahi.",
};

/** "Say yes and you also get X." A boolean param on the ORDER, mapped to an action that is
 *  planned alongside it. Deliberately tiny and explicit: these are the only things that get
 *  into a plan without the needs-graph asking for them, and each one is a question the user
 *  was asked out loud first (see SLOT_QUESTION). */
const EXTRAS: Record<string, string> = { with_story: "make_story" };

function missingSlotsMessage(slots: string[]): string {
  const asked = slots.map((s) => SLOT_QUESTION[s]).filter(Boolean);
  // When every gap has a real question, ask THOSE — the field names never reach the user.
  if (asked.length === slots.length) return asked.join(" ");

  const list = slots.map((s) => SLOT_QUESTION[s] ?? s).join(", ");
  return slots.length === 1
    ? `Ek cheez batani baaki hai: ${list}. Bina uske main guess nahi karunga — bata dijiye, main turant shuru kar deta hoon.`
    : `Ye cheezein batani baaki hain: ${list}. Bina inke main guess nahi karunga — bata dijiye, main turant shuru kar deta hoon.`;
}

function noProviderMessage(need: string, forAction: RegisteredAction | null): string {
  const what = noun(need);
  const forWhat = forAction ? noun(forAction.spec.provides) : "ye kaam";
  return `${what} kaun banata hai, ye kisi agent ne register hi nahi kiya — isliye ${forWhat} ka plan nahi ban sakta. Ye hamari taraf ki kami hai, aapki nahi.`;
}

function unhealthyMessage(registry: Registry, entry: RegisteredAction, forAction: RegisteredAction | null): string {
  const who = agentName(registry, entry.agent_id);
  if (!forAction) {
    return `${who} abhi available nahi hai, isliye ${noun(entry.spec.provides)} abhi nahi ho sakta. Wo ready hote hi main aapko bata dunga.`;
  }
  return `${who} abhi available nahi hai, aur ${noun(forAction.spec.provides)} ke liye ${noun(entry.spec.provides)} zaroori hai — isliye ye order abhi nahi chal sakta.`;
}

function skipMessage(registry: Registry, entry: RegisteredAction): string {
  const who = agentName(registry, entry.agent_id);
  return `${who} abhi available nahi hai, isliye ${noun(entry.spec.provides)} is baar skip — baaki kaam chalta rahega.`;
}

function cycleMessage(involved: string[]): string {
  return `Manifests me ek gol chakkar hai (${involved.join(" → ")}) — ek doosre ka intezaar kar rahe hain. Ye hamari galti hai, aapki nahi; theek hone tak ye plan nahi ban sakta.`;
}
