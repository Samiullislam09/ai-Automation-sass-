import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { supabase } from "../supabase.js";
import { completeJson } from "../lib/llm.js";
import { enqueue } from "../queues.js";
import { loadInsights, planningBlock } from "../lib/insights.js";
import { syncGoogleInsights } from "../lib/googleSync.js";

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
    // Passed straight through to Mr. Keyword, so the caller decides what happens after
    // research: write immediately (true), research only (false), or put the keywords in front
    // of the human first ("choose"). Defaults to writing, which is what "run the team" means.
    const chain = (job.data as any).chain ?? true;
    // Set only by the scheduler (scheduler.ts). Both ride the whole chain down to the writer:
    // `scheduleRunId` so the articles this run produced can be found again by id rather than
    // by timestamp, `autoPublish` so the writer knows this run was approved in advance.
    const scheduleRunId = (job.data as any).scheduleRunId as string | undefined;
    const autoPublish = (job.data as any).autoPublish === true;
    const source = (job.data as any).source as string | undefined;

    // Ask the web app to refresh Search Console / GA4 first, so a scheduled 9am run plans
    // against this week's numbers rather than whatever was last pulled by hand. Best-effort:
    // it no-ops when Google isn't connected, and a failure must not stop the plan.
    await syncGoogleInsights(tenantId);

    const [{ data: tenant }, { data: pages }, { data: existing }, insights] = await Promise.all([
      supabase.from("tenants").select("name, website_url, niche, tone_profile").eq("id", tenantId).single(),
      supabase.from("site_pages").select("title").eq("tenant_id", tenantId).limit(40),
      supabase.from("content_items").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30),
      loadInsights(tenantId),
    ]);

    const pageTitles = (pages ?? []).map((p: any) => p.title).filter(Boolean);
    const alreadyWritten = (existing ?? []).map((c: any) => c.title).filter(Boolean);

    // Nothing to reason from = no plan. The alternative is inventing topics for a business
    // we know nothing about, which is exactly what this product is not supposed to do.
    if (!tenant?.niche && !pageTitles.length && !insights.connected) {
      return {
        planned: 0,
        source,
        scheduleRunId,
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
      insights.connected
        ? "Because real search data is given above, at least half the topics MUST come from the striking-distance or high-impression lists, quoted closely enough that the article can target that exact query."
        : "",
      "",
      'Reply with ONLY JSON: {"topics":[{"topic":"...","why":"one short sentence"}]}',
    ].filter(Boolean).join("\n");

    const plan = await completeJson<{ topics?: { topic?: string; why?: string }[] }>(prompt);
    const topics = (plan?.topics ?? [])
      .map((t) => ({ topic: String(t?.topic ?? "").trim(), why: String(t?.why ?? "").trim() }))
      .filter((t) => t.topic.length > 3)
      .slice(0, count);

    if (!topics.length) return { planned: 0, source, scheduleRunId, reason: "The planner returned no usable topics." };

    // Hand each topic to Mr. Keyword. `chain: true` is what makes him pass it on to Mr.
    // Writer once the keyword data comes back (see keyword.ts) — a keyword job without it
    // stays a one-off lookup, which is what the manual /jobs/keyword endpoint still does.
    for (const t of topics) {
      await enqueue("keyword", {
        tenantId,
        topic: t.topic,
        chain,
        scheduleRunId,
        autoPublish,
        taskLabel: `Researching "${t.topic}"`,
      });
    }

    return {
      planned: topics.length,
      topics,
      chain,
      // Echoed into jobs_log so /api/schedule/history can tell a scheduled run from a
      // hand-started one, tie it to the articles it produced, and say whether THAT run was
      // set to publish on its own — not merely what the toggle happens to say today.
      source,
      scheduleRunId,
      autoPublish,
      // Recorded in jobs_log so the dashboard can say WHY these topics, not just which.
      groundedIn: insights.connected
        ? { source: "google-search-console", period: insights.period, strikingDistance: insights.strikingDistance.length }
        : { source: "site-crawl-and-niche" },
    };
  }
}
