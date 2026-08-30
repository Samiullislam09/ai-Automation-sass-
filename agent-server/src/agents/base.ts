import type { Job } from "pg-boss";

export type AgentJobData = {
  tenantId: string;
  [key: string]: unknown;
};

/** Every agent (Keyword, Writer, Social, SEO, Leads) is a class with a run(job) method.
 *  Step 6 only builds the framework — real logic per agent lands in later Build Guide
 *  steps (9: Keyword, 10-11: SERP/Writer, Phase 2: Social/SEO, Phase 3: Leads).
 *
 *  Queue backend: Postgres via pg-boss (not Redis/BullMQ — see db.ts for why). */
/** Handed to every agent so a long job can say where it has got to.
 *  A crawl takes ten minutes; without this the dashboard shows a spinner for ten minutes and
 *  nobody can tell the difference between "working" and "stuck". */
export type AgentContext = {
  /** Merged into this job's jobs_log detail. Throttled by the worker — call it freely. */
  onProgress: (progress: Record<string, unknown>) => void;

  /** "One more real thing exists now": a keyword row, an article section, an image, a score.
   *
   *  This is what the live workspace renders (plan §24) — the artifact building itself in
   *  front of the user rather than a spinner. The granularity rule is one event per
   *  user-meaningful thing, never per token: `data("keyword", {...})` per keyword, not per
   *  character.
   *
   *  `kind` picks the renderer, so use the names the UI knows: "keyword", "section", "image",
   *  "score", "lead", "page". An unknown kind renders as a plain card rather than failing.
   *
   *  No-op unless the job belongs to a brain task — an agent never has to ask whether anyone
   *  is watching, and adding a call here can never break a plain job. */
  data: (kind: string, payload: unknown) => void;

  /** Where the agent has got to, as a fraction and a label the user may read.
   *  Unlike `onProgress` this is not throttled into jobs_log — it goes to the live channel. */
  progress: (fraction: number, label?: string) => void;

  /** A developer note. Deliberately NOT shown to users: the system writes what people read
   *  (brain/events.ts `userMessage`), so an agent's own words can never claim an outcome. */
  log: (message: string, level?: "debug" | "info" | "warn" | "error") => void;

  /** This run's own `jobs_log.id`, written by workers.ts before the agent starts.
   *
   *  Only one thing needs it, and it is not logging: the duplicate locks (lib/dedupe.ts) search
   *  `jobs_log` for a running job on the same topic, and THIS job is one of those rows by the
   *  time the agent looks. Without a way to say "everything except me", Mr. Writer found its own
   *  row and refused to write — found live 2026-08-31, the second self-block of the same shape
   *  as the `tasks` one fixed earlier the same day. `undefined` when the log insert failed, in
   *  which case the lock simply has nothing to exclude, exactly as before. */
  jobLogId?: string;
};

export abstract class Agent {
  abstract type: string;
  // Subclasses that don't need progress can still declare run(job) — TypeScript allows a
  // method to take fewer parameters than the signature it implements.
  abstract run(job: Job<AgentJobData>, ctx: AgentContext): Promise<unknown>;
}
