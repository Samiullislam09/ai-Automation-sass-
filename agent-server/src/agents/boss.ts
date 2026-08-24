import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { supabase } from "../supabase.js";
import { completeJson } from "../lib/llm.js";
import { enqueue } from "../queues.js";

/** Mr Lxwa — the orchestrator. Until now every agent only ran when a human poked an
 *  endpoint, and nothing connected them: Mr. Keyword's research went into jobs_log and
 *  died there, and Mr. Writer had to be handed a topic by hand. This agent is the missing
 *  first link — it decides WHAT to work on, then starts the chain:
 *
 *      boss  ->  keyword (per topic)  ->  writer (auto, with a blueprint)
 *                                            -> quality gate -> awaiting_approval
 *
 *  It never publishes and never skips the human: the chain always ends in the approval
 *  queue, same as a manually-triggered writer job.
 *
 *  Topic choice is grounded in real tenant data (niche + what the crawler actually found
 *  on the site + what has already been written), not invented — if there is nothing to
 *  ground it in, it says so and enqueues nothing rather than making topics up. */
export class BossAgent extends Agent {
  type = "boss";

  async run(job: Job<AgentJobData>) {
    const { tenantId } = job.data;
    // How many articles to plan this run. Kept small on purpose: writer's daily cap is 10
    // (agent-server/src/config/caps.ts) and every one of these becomes a real LLM call.
    const count = Math.min(Math.max(Number((job.data as any).count) || 3, 1), 5);

    const [{ data: tenant }, { data: pages }, { data: existing }] = await Promise.all([
      supabase.from("tenants").select("name, website_url, niche, tone_profile").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).limit(40),
      supabase.from("content_items").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30),
    ]);

    const pageTitles = (pages ?? []).map((p: any) => p.title).filter(Boolean);
    const alreadyWritten = (existing ?? []).map((c: any) => c.title).filter(Boolean);

    // Nothing to reason from = no plan. The alternative is inventing topics for a business
    // we know nothing about, which is exactly what this product is not supposed to do.
    if (!tenant?.niche && !pageTitles.length) {
      return {
        planned: 0,
        reason: "No niche set and no crawled pages yet — run the site crawler (or finish onboarding) before planning content.",
      };
    }

    const prompt = [
      "You plan blog topics for a small business's content team.",
      `Business: ${tenant?.name ?? "unknown"}${tenant?.website_url ? ` (${tenant.website_url})` : ""}`,
      tenant?.niche ? `Niche: ${tenant.niche}` : "",
      pageTitles.length ? `Existing pages on their site:\n- ${pageTitles.slice(0, 25).join("\n- ")}` : "",
      alreadyWritten.length ? `Already written (DO NOT repeat these):\n- ${alreadyWritten.join("\n- ")}` : "",
      "",
      `Choose exactly ${count} NEW blog topics this business should publish next.`,
      "Rules: each topic must be something their real customers would search for; specific, not generic;",
      "no topic may duplicate or closely paraphrase anything listed above.",
      "",
      'Reply with ONLY JSON: {"topics":[{"topic":"...","why":"one short sentence"}]}',
    ].filter(Boolean).join("\n");

    const plan = await completeJson<{ topics?: { topic?: string; why?: string }[] }>(prompt);
    const topics = (plan?.topics ?? [])
      .map((t) => ({ topic: String(t?.topic ?? "").trim(), why: String(t?.why ?? "").trim() }))
      .filter((t) => t.topic.length > 3)
      .slice(0, count);

    if (!topics.length) return { planned: 0, reason: "The planner returned no usable topics." };

    // Hand each topic to Mr. Keyword. `chain: true` is what makes him pass it on to Mr.
    // Writer once the keyword data comes back (see keyword.ts) — a keyword job without it
    // stays a one-off lookup, which is what the manual /jobs/keyword endpoint still does.
    for (const t of topics) {
      await enqueue("keyword", {
        tenantId,
        topic: t.topic,
        chain: true,
        taskLabel: `Researching "${t.topic}"`,
      });
    }

    return { planned: topics.length, topics };
  }
}
