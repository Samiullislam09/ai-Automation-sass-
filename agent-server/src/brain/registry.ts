/** The registry — the brain's list of who works here and what they can do.
 *
 *  It does exactly two jobs:
 *
 *   1. Hold the manifests in a shape the planner and the intent engine can read fast
 *      (agent id → agent, action id → {agent, spec}).
 *   2. REFUSE to accept a set of manifests that contradict itself.
 *
 *  Job 2 is the whole point. Plan §5.5's "panga" table lists six ways the team could go wrong
 *  and two of them are structural: two agents claiming the same phrase (the router picks a
 *  different agent on Tuesday than it did on Monday) and a cycle in `needs`/`provides` (the
 *  planner never terminates). Both are bugs in the manifests, not in the user's message, and
 *  both are cheap to detect at boot. So they are detected at boot, and `assertHealthyRegistry`
 *  throws on them.
 *
 *  BOOT POLICY. `assertHealthyRegistry(result)` throws; it does NOT call `process.exit`. The
 *  caller (src/index.ts) is the only place allowed to decide the process dies — a module that
 *  kills the process cannot be imported by a test. The intended call site is:
 *
 *      const registry = buildRegistry(MANIFESTS, { stubs: STUB_AGENTS, notRouted: NOT_YET_ROUTED });
 *      assertHealthyRegistry(registry);   // throws → the server must not come up
 *
 *  A duplicate action id or an invalid manifest is NOT fatal: that agent's actions simply are
 *  not registered, the problem is reported, and the rest of the team keeps working. A phrase
 *  collision or a cycle IS fatal, because there is no safe partial answer — either would make
 *  the product behave differently run to run.
 *
 *  DISABLED ≠ ABSENT. A stub agent (Mr. SEO today) and an agent with no adapter yet
 *  (Mr. Publish today) are both registered but `enabled: false`. They stay in the graph so the
 *  planner can say "publish needs an SEO check and Mr. SEO is not available" instead of "I have
 *  never heard of SEO". They are kept out of `enabledActions()` so the intent engine never
 *  offers the model a tool whose agent would answer "stub — Phase 3 wires in…".
 */

import { validateManifest } from "../vendor/agent-contract/index.js";
import type { ActionSpec, Manifest } from "../vendor/agent-contract/index.js";
import type { RegisteredAgent, RegistryProblem } from "./types.js";

/** action id → who owns it and what it declares. */
export type RegisteredAction = { agent_id: string; spec: ActionSpec };

export type Registry = {
  agents: Map<string, RegisteredAgent>;
  actions: Map<string, RegisteredAction>;
  problems: RegistryProblem[];
};

export type RegistryOptions = {
  /** Agent ids whose implementation is still a stub. Registered, but `enabled: false`. */
  stubs?: Set<string>;
  /** Agent ids with a manifest but no adapter wired up yet. Same treatment as a stub. */
  notRouted?: Set<string>;
  /** agent id → HTTP base URL. Absent = in-process adapter (today: all of them). */
  baseUrls?: Record<string, string>;
  /** agent id → last health-check result. Default: an enabled agent is healthy (an
   *  in-process adapter is up whenever this process is up); a disabled one never is. */
  healthy?: Record<string, boolean>;
  /** agent id → ISO timestamp of that health check. Default null, so the registry itself
   *  is a pure function of its inputs and a test can compare two builds. */
  healthyAt?: Record<string, string | null>;
};

/** Case- and whitespace-insensitive, because "Article Likho" and "article  likho" are the
 *  same claim on the router and must collide. Punctuation is left alone on purpose: an agent
 *  that wants "publish?" and another that wants "publish" is a real distinction we would
 *  rather see reported as two phrases than silently merged. */
export function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Build the registry from raw manifests. Never throws — everything wrong is a problem in
 *  the returned list, so a caller can log all of them at once instead of one per restart. */
export function buildRegistry(manifests: readonly unknown[], opts: RegistryOptions = {}): Registry {
  const stubs = opts.stubs ?? new Set<string>();
  const notRouted = opts.notRouted ?? new Set<string>();
  const baseUrls = opts.baseUrls ?? {};

  const agents = new Map<string, RegisteredAgent>();
  const actions = new Map<string, RegisteredAction>();
  const problems: RegistryProblem[] = [];

  // ── 1. validate, then register ────────────────────────────────────────────────────────
  for (const raw of manifests) {
    const result = validateManifest(raw);
    if (!result.ok) {
      problems.push({
        kind: "invalid_manifest",
        agent_id: guessAgentId(raw),
        errors: result.errors,
      });
      continue; // its actions are not registered — a manifest we cannot trust routes nothing
    }

    const manifest: Manifest = result.manifest;
    const enabled = !stubs.has(manifest.id) && !notRouted.has(manifest.id);
    const healthy = opts.healthy?.[manifest.id] ?? enabled;

    const registeredActions: Record<string, ActionSpec> = {};
    for (const spec of manifest.actions) {
      const already = actions.get(spec.id);
      if (already) {
        // First registration wins. Two agents answering to one action id is ambiguous
        // routing; keeping the first is arbitrary but at least it is stable across boots.
        problems.push({ kind: "duplicate_action", action: spec.id, agents: [already.agent_id, manifest.id] });
        continue;
      }
      actions.set(spec.id, { agent_id: manifest.id, spec });
      registeredActions[spec.id] = spec;
    }

    agents.set(manifest.id, {
      id: manifest.id,
      manifest,
      base_url: baseUrls[manifest.id] ?? null,
      enabled,
      healthy,
      healthy_at: opts.healthyAt?.[manifest.id] ?? null,
      actions: registeredActions,
    });
  }

  // ── 2. phrase collisions across the registered actions ────────────────────────────────
  const byPhrase = new Map<string, Set<string>>();
  for (const [actionId, { spec }] of actions) {
    for (const phrase of spec.phrases) {
      const key = normalizePhrase(phrase);
      if (!key) continue;
      const claimants = byPhrase.get(key) ?? new Set<string>();
      claimants.add(actionId); // a Set, so one action listing a phrase twice is not a collision
      byPhrase.set(key, claimants);
    }
  }
  for (const [phrase, claimants] of byPhrase) {
    if (claimants.size > 1) {
      problems.push({ kind: "phrase_collision", phrase, actions: [...claimants].sort() });
    }
  }

  // ── 3. cycles in the needs/provides graph ─────────────────────────────────────────────
  for (const involved of findCycles(actions)) {
    problems.push({ kind: "cycle", involved });
  }

  return { agents, actions, problems };
}

/** The registry's own id guess for a manifest that failed validation — the object may not
 *  even be an object, so this is deliberately defensive. */
function guessAgentId(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return "<unknown>";
}

/** Which actions produce a given `provides` name. The planner walks the same map. */
export function providersOf(registry: Registry, need: string): RegisteredAction[] {
  const out: RegisteredAction[] = [];
  for (const entry of registry.actions.values()) {
    if (entry.spec.provides === need) out.push(entry);
  }
  return out;
}

/** Which actions consume a given `provides` name. Used by the planner's finisher rule. */
export function consumersOf(registry: Registry, provided: string): RegisteredAction[] {
  const out: RegisteredAction[] = [];
  for (const entry of registry.actions.values()) {
    if (entry.spec.needs.includes(provided)) out.push(entry);
  }
  return out;
}

/** DFS over "action A depends on action B when B.provides ∈ A.needs".
 *  Returns one path per distinct cycle, each starting and ending on the same action id. */
function findCycles(actions: Map<string, RegisteredAction>): string[][] {
  const provider = new Map<string, string[]>(); // provides name → action ids
  for (const [id, { spec }] of actions) {
    const list = provider.get(spec.provides) ?? [];
    list.push(id);
    provider.set(spec.provides, list);
  }

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];
  const found: string[][] = [];
  const seen = new Set<string>();

  const visit = (id: string): void => {
    colour.set(id, GREY);
    stack.push(id);
    const spec = actions.get(id)!.spec;
    for (const need of spec.needs) {
      for (const dep of provider.get(need) ?? []) {
        const c = colour.get(dep) ?? WHITE;
        if (c === GREY) {
          const from = stack.indexOf(dep);
          const path = [...stack.slice(from), dep];
          // Canonical key so A→B→A and B→A→B are reported once.
          const key = [...path.slice(0, -1)].sort().join(">");
          if (!seen.has(key)) {
            seen.add(key);
            found.push(path);
          }
        } else if (c === WHITE) {
          visit(dep);
        }
      }
    }
    stack.pop();
    colour.set(id, BLACK);
  };

  for (const id of actions.keys()) {
    if ((colour.get(id) ?? WHITE) === WHITE) visit(id);
  }
  return found;
}

/** The two problem kinds that make routing non-deterministic. See the header. */
export type FatalProblem = Extract<RegistryProblem, { kind: "phrase_collision" } | { kind: "cycle" }>;

/** The problems the process must not boot through. */
export function fatalProblems(registry: Registry): FatalProblem[] {
  return registry.problems.filter((p): p is FatalProblem => p.kind === "phrase_collision" || p.kind === "cycle");
}

/** Throw if the registry contains a structural contradiction, naming exactly what collides.
 *  Call this once at boot, before any queue is started. It never exits the process itself. */
export function assertHealthyRegistry(registry: Registry): void {
  const fatal = fatalProblems(registry);
  if (fatal.length === 0) return;

  const lines = fatal.map((p) => {
    if (p.kind === "phrase_collision") {
      return `  • phrase collision: "${p.phrase}" is claimed by ${p.actions.join(" and ")}`;
    }
    return `  • cycle in needs/provides: ${p.involved.join(" → ")}`;
  });

  throw new Error(
    `Registry refuses to start — ${fatal.length} structural problem(s) in the manifests:\n` +
      lines.join("\n") +
      `\nFix the manifests; these would make routing non-deterministic, so the server must not boot.`,
  );
}

/** The actions the intent engine is allowed to offer the model: registered, and owned by an
 *  agent that is both enabled and healthy. Everything else is answered with
 *  "ye abhi nahi kar sakta" rather than accepted and dropped. */
export function enabledActions(registry: Registry): RegisteredAction[] {
  const out: RegisteredAction[] = [];
  for (const entry of registry.actions.values()) {
    const agent = registry.agents.get(entry.agent_id);
    if (agent && agent.enabled && agent.healthy) out.push(entry);
  }
  return out.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}

/** True when the planner may put this action in a plan. */
export function isAvailable(registry: Registry, actionId: string): boolean {
  const entry = registry.actions.get(actionId);
  if (!entry) return false;
  const agent = registry.agents.get(entry.agent_id);
  return !!agent && agent.enabled && agent.healthy;
}

/** A compact text block for the conversation model's context (plan §5.2: "registry + live
 *  task list", so "kya tum leads dhund sakte ho?" gets a true answer). Deliberately short —
 *  it is prepended to every turn, so every line costs tokens on every message. */
export function describeCapabilities(registry: Registry): string {
  const can: string[] = [];
  const cannot: string[] = [];

  for (const agent of [...registry.agents.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const spec of Object.values(agent.actions)) {
      const secs = spec.estimated_seconds;
      const time = secs < 90 ? `~${secs}s` : `~${Math.round(secs / 60)} min`;
      const line = `  ${agent.manifest.name} · ${spec.id} (${time}) — ${spec.phrases.slice(0, 3).join(" / ")}`;
      if (agent.enabled && agent.healthy) can.push(line);
      else cannot.push(`  ${agent.manifest.name} · ${spec.id} — ${agent.enabled ? "abhi down hai" : "abhi ban raha hai"}`);
    }
  }

  const parts = [`TEAM (${can.length} kaam abhi ho sakte hain, ${cannot.length} nahi)`, "", "CAN DO NOW", ...can];
  if (cannot.length) {
    parts.push("", "CANNOT DO YET — offer nahi karna, saaf mana karna", ...cannot);
  }
  if (registry.problems.length) {
    parts.push("", `NOTE: registry me ${registry.problems.length} problem(s) hain — dev ko dekhna chahiye.`);
  }
  return parts.join("\n");
}

// ── database sync ────────────────────────────────────────────────────────────────────────

/** One row of the `agents` table in migration 017. */
export type AgentRow = {
  id: string;
  name: string;
  version: string;
  manifest: Manifest;
  base_url: string | null;
  enabled: boolean;
  healthy_at: string | null;
  updated_at: string;
};

/** The only bit of supabase-js this module uses. Typed structurally so a test can pass a
 *  three-line fake and never open a socket. */
export type SupabaseLike = {
  from(table: string): {
    upsert(rows: AgentRow[], options?: { onConflict?: string }): PromiseLike<{ error: { message: string } | null }>;
  };
};

export function toAgentRows(registry: Registry, now: string = new Date().toISOString()): AgentRow[] {
  return [...registry.agents.values()].map((a) => ({
    id: a.id,
    name: a.manifest.name,
    version: a.manifest.version,
    manifest: a.manifest,
    base_url: a.base_url,
    enabled: a.enabled,
    healthy_at: a.healthy ? (a.healthy_at ?? now) : a.healthy_at,
    updated_at: now,
  }));
}

/** Upsert the registry into `agents` so the dashboard and the office can draw rooms from
 *  manifests instead of a hard-coded list (plan §6.2, last bullet).
 *
 *  `client` is injectable and defaults to the service-role client in `../supabase.js`, which
 *  is imported lazily — importing it at module scope would read env vars and make this file
 *  unimportable from a test. */
export async function syncToDatabase(
  client: SupabaseLike | null | undefined,
  registry: Registry,
  now: string = new Date().toISOString(),
): Promise<{ upserted: number }> {
  const db: SupabaseLike = client ?? ((await import("../supabase.js")).supabase as unknown as SupabaseLike);
  const rows = toAgentRows(registry, now);
  if (rows.length === 0) return { upserted: 0 };
  const { error } = await db.from("agents").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`registry sync failed: ${error.message}`);
  return { upserted: rows.length };
}
