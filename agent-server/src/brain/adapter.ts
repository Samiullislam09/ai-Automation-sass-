/** How the brain reaches today's agents — without rewriting them first.
 *
 *  The plan's end state is every agent behind `POST /run` in its own repo (§6). The end state
 *  is not where we start: seven pg-boss workers already run, already respect per-tenant caps,
 *  already write `jobs_log`, already report progress to the dashboard. Throwing that away on
 *  day one of the brain would mean re-earning all of it before anything works again.
 *
 *  So the adapter puts the step on the agent's OWN existing queue, with one extra field:
 *
 *      enqueue("keyword", { tenantId, topic: "solar", __brain: { task_id, step_id } })
 *
 *  The existing worker runs exactly as it does today. The only new code in `workers.ts` is a
 *  few lines at the end: if `__brain` is present, tell the orchestrator how it went. Caps,
 *  retries, logging and the office panel all keep working, and a step is simply a job that
 *  happens to belong to a task.
 *
 *  When an agent moves out to its own service, its entry here is replaced by the contract's
 *  HTTP client and nothing else in the brain changes — that is the whole point of the
 *  indirection.
 *
 *  TRANSLATION IS THE OTHER HALF OF THIS FILE. A manifest action has clean inputs
 *  (`{topic, keywords}`); today's agents take the job shapes they grew into (`{topic, chain,
 *  blueprint, autoPublish}`). Every one of those translations lives here, in one place, so
 *  the brain never learns an agent's private vocabulary.
 */

import { enqueue, AGENT_TYPES, type AgentType } from "../queues.js";
import type { StepRunner } from "./orchestrator.js";
import { NOT_YET_ROUTED, STUB_AGENTS } from "./manifests.js";

/** What the orchestrator smuggles through the job so the worker can report back. */
export type BrainJobRef = { task_id: string; step_id: string; tenant_id: string };

export function brainRefOf(data: unknown): BrainJobRef | null {
  const ref = (data as any)?.__brain;
  if (ref && typeof ref.task_id === "string" && typeof ref.step_id === "string") return ref as BrainJobRef;
  return null;
}

/** Manifest action → the job body today's worker expects.
 *
 *  Anything not listed is refused loudly. A silent "close enough" translation is how an agent
 *  ends up researching the string "undefined". */
function translate(agentId: string, action: string, input: Record<string, unknown>): { queue: AgentType; data: Record<string, unknown> } {
  const t = (v: unknown) => (typeof v === "string" ? v.trim() : v);

  switch (`${agentId}.${action}`) {
    case "keyword.find_keywords":
      // chain:false is the whole difference between "sirf keyword do" and "article likho" —
      // in the brain, chaining is the planner's job, so the agent must never chain itself.
      return { queue: "keyword", data: { topic: t(input.topic), chain: false, taskLabel: `Keywords for "${t(input.topic)}"` } };

    case "writer.write_article":
      return {
        queue: "writer",
        data: {
          topic: t(input.topic),
          blueprint: input.blueprint ?? blueprintFromKeywords(input.keywords),
          // The brain decides publishing with its own step; the writer must not also publish.
          autoPublish: false,
          taskLabel: `Writing "${t(input.topic)}"`,
        },
      };

    case "writer.research_brief":
      return { queue: "writer", data: { topic: t(input.topic), researchOnly: true, taskLabel: `Research on "${t(input.topic)}"` } };

    case "boss.plan_topics":
      return { queue: "boss", data: { count: input.count ?? null, taskLabel: "Planning topics" } };

    case "crawler.crawl_site":
      return { queue: "crawler", data: { limit: input.limit ?? null, taskLabel: "Reading your site" } };

    case "analyst.build_site_profile":
      return { queue: "analyst", data: { pages: input.pages ?? null, taskLabel: "Understanding your site" } };

    case "seo.check_seo":
      return {
        queue: "seo",
        data: {
          // The agent takes any of these: the article inline, an id to load it by, or the
          // keyword step's whole output. Passing all three costs nothing and means the step
          // works wherever in the chain it is placed.
          article: input.article ?? null,
          content_item_id: input.content_item_id ?? (input.article as any)?.contentItemId ?? (input.article as any)?.id ?? null,
          keywords: input.keywords ?? null,
          taskLabel: "SEO check",
        },
      };

    case "leads.find_leads":
      // The agent takes `query` but the phrase the user typed often arrives as `topic` (the
      // intent engine's generic slot), so both are passed and the agent prefers `query`.
      return {
        queue: "leads",
        data: { query: t(input.query) ?? t(input.topic), count: input.count ?? null, taskLabel: `Finding leads: "${t(input.query) ?? t(input.topic)}"` },
      };

    case "publish.publish_article":
      return {
        queue: "publish",
        data: {
          content_item_id: input.content_item_id ?? (input.article as any)?.contentItemId ?? (input.article as any)?.id ?? null,
          // Passed through so the publish agent can refuse a draft the SEO step failed —
          // the guard belongs next to the irreversible action, not only in the planner.
          seo_passed: input.seo_passed ?? null,
          taskLabel: "Publishing to your site",
        },
      };

    default:
      throw new Error(`No route for ${agentId}.${action}. Add it to brain/adapter.ts — do not guess a job shape.`);
  }
}

/** The keyword step hands the writer whatever it produced. Today's writer wants a plain-text
 *  blueprint; if the step output already carries one, use it, otherwise build a minimal one
 *  from the keyword list rather than sending the writer a raw object it cannot read. */
function blueprintFromKeywords(keywords: unknown): string | null {
  if (!keywords) return null;
  if (typeof keywords === "string") return keywords;
  const k = keywords as any;
  if (typeof k.blueprint === "string") return k.blueprint;
  const list: string[] = Array.isArray(k) ? k : Array.isArray(k.relatedKeywords) ? k.relatedKeywords.map((r: any) => r?.keyword ?? r) : [];
  if (!list.length) return null;
  return [`Primary keyword: ${k.recommended ?? list[0]}`, "", "Related queries to cover:", ...list.filter(Boolean).map((s) => `- ${s}`)].join("\n");
}

/** Why a step cannot run at all, in a sentence a person can read. Checked before anything is
 *  queued, so "Mr. SEO abhi available nahi hai" arrives instead of a job that dies quietly. */
export function unavailableReason(agentId: string): string | null {
  if (STUB_AGENTS.has(agentId)) return `${agentId} abhi asli kaam nahi karta — ye Phase 2/3 me aayega.`;
  if (NOT_YET_ROUTED.has(agentId)) return `${agentId} ke liye abhi koi worker nahi hai — ye agle phase me judega.`;
  if (!AGENT_TYPES.includes(agentId as AgentType)) return `${agentId} naam ka koi agent chal hi nahi raha.`;
  return null;
}

/** The runner the orchestrator is configured with. Throwing here is a retryable failure by
 *  the orchestrator's rules, which is right for "could not enqueue"; a permanently
 *  unavailable agent is reported before we get that far. */
export function makeStepRunner(): StepRunner {
  return async (call) => {
    const blocked = unavailableReason(call.agent_id);
    if (blocked) throw new Error(blocked);

    const { queue, data } = translate(call.agent_id, call.action, call.input);
    await enqueue(queue, {
      tenantId: call.tenant_id,
      ...data,
      __brain: { task_id: call.task_id, step_id: call.step_id, tenant_id: call.tenant_id },
    } as any);
  };
}
