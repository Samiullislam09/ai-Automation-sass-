import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { supabase } from "../supabase.js";
import { loadActiveProfile } from "../lib/siteProfile.js";
import { completeJson } from "../lib/llm.js";
import { enqueue } from "../queues.js";
import { loadInsights, planningBlock } from "../lib/insights.js";
import { syncGoogleInsights } from "../lib/googleSync.js";
import { checkDuplicate, type DuplicateVerdict } from "../lib/dedupe.js";
import { duplicateSentence } from "./writer.js";

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
/** The site-analysis + LLM call + duplicate locks shared by both of Mr Lxwa's actions:
 *  `plan_topics` (several topics, then enqueues Mr. Keyword for each — the "kya likhun" chat
 *  flow and the scheduler) and `pick_topic` (exactly one, returned as the step's own output for
 *  the planner's graph to hand to Mr. Keyword/Mr. Writer — the "article likho" chat flow when
 *  no topic was given). One prompt-builder, one duplicate check, so the two paths can never
 *  drift into picking topics by different rules. */
async function planTopics(
  tenantId: string,
  count: number,
): Promise<
  | { ok: true; kept: PlannedTopic[]; dropped: DroppedTopic[]; groundedIn: Record<string, unknown> }
  | { ok: false; reason: string; dropped?: DroppedTopic[] }
> {
  // Ask the web app to refresh Search Console / GA4 first, so a scheduled 9am run plans
  // against this week's numbers rather than whatever was last pulled by hand. Best-effort:
  // it no-ops when Google isn't connected, and a failure must not stop the plan.
  await syncGoogleInsights(tenantId);

  const [{ data: tenant }, { data: pages }, { data: existing }, insights, profileRow] = await Promise.all([
    supabase.from("tenants").select("name, website_url, niche, tone_profile").eq("id", tenantId).single(),
    supabase.from("site_pages").select("title").eq("tenant_id", tenantId).limit(40),
    supabase.from("content_items").select("title").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30),
    loadInsights(tenantId),
    // The Site Brain, if Mr. Analyst has run. Absent is normal and costs nothing: without
    // it this agent plans exactly as it did before (§25.3).
    loadActiveProfile(tenantId).catch((e: any) => {
      console.warn("[boss] site profile unavailable, planning from titles only:", e?.message);
      return null;
    }),
  ]);

  // loadActiveProfile hands back the row (version, sources, built_from); the planning below
  // only wants what the analyst concluded.
  const profile = profileRow?.profile ?? null;

  const pageTitles = (pages ?? []).map((p: any) => p.title).filter(Boolean);
  const alreadyWritten = (existing ?? []).map((c: any) => c.title).filter(Boolean);

  // Nothing to reason from = no plan. The alternative is inventing topics for a business
  // we know nothing about, which is exactly what this product is not supposed to do.
  if (!tenant?.niche && !pageTitles.length && !insights.connected) {
    return { ok: false, reason: "No niche set and no crawled pages yet — run the site crawler (or finish onboarding) before planning content." };
  }

  // ── What to write about next, in the order the plan puts it (§25.3, §25.4) ───────────────
  //
  //  1. CONTENT GAPS — searches this site is already shown for with no page answering them.
  //     Not a guess: Google is reporting demand this business is failing to meet, so the
  //     article has a measured audience before a word is written.
  //  2. CLUSTER ROTATION — round-robin across the site's own subjects, so coverage spreads
  //     instead of piling onto whatever the model finds most interesting. The offset comes
  //     from how much has already been written, so consecutive runs continue the rotation
  //     rather than restarting it every time.
  //  3. Whatever the model adds from the niche and the page titles — the old behaviour,
  //     which is still exactly what happens when there is no profile at all.
  const gaps = (profile?.content_gaps ?? []).slice().sort((a, b) => b.impressions - a.impressions);
  const clusters = (profile?.topic_clusters ?? []).slice().sort((a, b) => b.size - a.size);
  const rotationOffset = alreadyWritten.length;
  const rotated = clusters.length
    ? Array.from({ length: clusters.length }, (_, i) => clusters[(rotationOffset + i) % clusters.length])
    : [];

  const gapBlock = gaps.length
    ? [
        "SEARCHES GOOGLE ALREADY SHOWS THIS SITE FOR, WITH NO PAGE ANSWERING THEM.",
        "These are the strongest candidates there are, because the demand is measured, not guessed:",
        ...gaps
          .slice(0, 8)
          .map((g) => `- ${g.query} (${g.impressions} impressions${g.position != null ? `, currently position ${g.position.toFixed(1)}` : ""})`),
      ].join("\n")
    : "";

  const clusterBlock = rotated.length
    ? [
        "SUBJECTS THIS SITE COVERS, least-recently-served first. Spread the topics across these",
        "rather than putting them all into one:",
        ...rotated.slice(0, 6).map((c) => `- ${c.name} (${c.size} page${c.size === 1 ? "" : "s"})`),
      ].join("\n")
    : "";

  const prompt = [
    "You plan blog topics for a small business's content team.",
    `Business: ${tenant?.name ?? "unknown"}${tenant?.website_url ? ` (${tenant.website_url})` : ""}`,
    profile?.what_they_do ? `What they do: ${profile.what_they_do}` : tenant?.niche ? `Niche: ${tenant.niche}` : "",
    profile?.audience ? `Their customers: ${profile.audience}` : "",
    profile?.geo ? `Where they work: ${profile.geo}` : "",
    profile?.goals?.primary ? `What this content is FOR: ${profile.goals.primary}` : "",
    gapBlock,
    clusterBlock,
    pageTitles.length ? `Existing pages on their site:\n- ${pageTitles.slice(0, 25).join("\n- ")}` : "",
    alreadyWritten.length ? `Already written (DO NOT repeat these):\n- ${alreadyWritten.join("\n- ")}` : "",
    "",
    `Choose exactly ${count} NEW blog topic${count === 1 ? "" : "s"} this business should publish next.`,
    "Rules: each topic must be something their real customers would search for; specific, not generic;",
    "no topic may duplicate or closely paraphrase anything listed above.",
    gaps.length
      ? "PRIORITY: take topics from the gap list first, quoted closely enough that the article can target that exact search. Only invent new ones once the gaps are used up."
      : insights.connected
      ? "Because real search data is given above, at least half the topics MUST come from the striking-distance or high-impression lists, quoted closely enough that the article can target that exact query."
      : "",
    profile?.goals?.primary
      ? "For each topic, the `why` must say how it serves the goal above — not why the subject is interesting."
      : "",
    "",
    'Reply with ONLY JSON: {"topics":[{"topic":"...","why":"one short sentence"}]}',
  ].filter(Boolean).join("\n");

  const plan = await completeJson<{ topics?: { topic?: string; why?: string }[] }>(prompt);
  const topics = (plan?.topics ?? [])
    .map((t) => ({ topic: String(t?.topic ?? "").trim(), why: String(t?.why ?? "").trim() }))
    .filter((t) => t.topic.length > 3)
    .slice(0, count);

  if (!topics.length) return { ok: false, reason: "The planner returned no usable topics." };

  // ── the duplicate locks, at the point suggestions are made (§25.5) ─────────────────────────
  // "Already written (DO NOT repeat these)" in the prompt above is a request, and a model
  // request is not a lock: it sees 30 titles, it does not see the 400 pages the crawler
  // found, and it cannot see what another run enqueued ninety seconds ago. So every topic
  // is checked against the database before it is ever shown, and a topic that fails is
  // DROPPED HERE — not carried down the chain to be refused by the writer three jobs later,
  // by which time the user has already been told it was planned.
  const checked = await dropDuplicateTopics(topics, (topic) => checkDuplicate(tenantId, { title: topic, topic }));
  if (checked.dropped.length) {
    console.log(`[boss] dropped ${checked.dropped.length} of ${topics.length} planned topic(s) as duplicates: ${checked.dropped.map((d) => d.topic).join("; ")}`);
  }

  const groundedIn = insights.connected
    ? { source: "google-search-console", period: insights.period, strikingDistance: insights.strikingDistance.length }
    : { source: "site-crawl-and-niche" };

  if (!checked.kept.length) {
    return {
      ok: false,
      dropped: checked.dropped,
      reason: `Jitne topic plan hue the (${checked.dropped.length}), wo sab aapke paas pehle se hain — isliye kuch naya shuru nahi kiya. Neeche har ek ka page diya hai; unhe update karwao, ya mujhe koi naya subject batao.`,
    };
  }

  return { ok: true, kept: checked.kept, dropped: checked.dropped, groundedIn };
}

export class BossAgent extends Agent {
  type = "boss";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;

    // pick_topic (the brain's own action, §25.3/§25.4 read via the planner's graph): exactly
    // one topic, returned as this step's output for Mr. Keyword/Mr. Writer to receive through
    // the planner's normal __from wiring — no enqueue here, the orchestrator dispatches the
    // next step itself once this one is marked done. `written: false` on a miss is the same
    // convention brain/orchestrator.ts's onStepDone() already reads for Mr. Writer's declines,
    // so a tenant with nothing to plan from gets an honest `needs_attention`, not a false "Done".
    //
    // Returned as `{ topic }`, an object — NOT a bare string. Every agent's return value passes
    // through workers.ts's withCost() before it is stored, and withCost() only MERGES `cost` in
    // when the result is already a plain object; a bare string gets silently wrapped as
    // `{ value: <string>, cost }` instead. Returning a string here (2026-08-31's first attempt)
    // meant Mr. Keyword's own `topic` field resolved to that `{ value, cost }` object at
    // dispatch time, not the string — "topic?.trim is not a function", found live, task
    // `needs_attention` with 0 steps ever completing past Mr Lxwa's own. adapter.ts's `topicOf()`
    // is the one place that unwraps `{ topic }` back to a plain string for every consumer.
    if ((job.data as any).pickOne === true) {
      const result = await planTopics(tenantId, 1);
      if (!result.ok) return { written: false, reason: result.reason };
      const picked = result.kept[0];
      ctx.data("topic_picked", { topic: picked.topic, why: picked.why, groundedIn: result.groundedIn });
      return { topic: picked.topic, why: picked.why };
    }

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

    const result = await planTopics(tenantId, count);
    if (!result.ok) {
      return {
        planned: 0,
        source,
        scheduleRunId,
        droppedDuplicates: result.dropped?.length ?? 0,
        dropped: result.dropped,
        reason: result.reason,
      };
    }

    // Hand each topic to Mr. Keyword. `chain: true` is what makes him pass it on to Mr.
    // Writer once the keyword data comes back (see keyword.ts) — a keyword job without it
    // stays a one-off lookup, which is what the manual /jobs/keyword endpoint still does.
    for (const t of result.kept) {
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
      // Only what was actually started. `topics` is what the dashboard lists, so it must be
      // the kept ones — reporting the planner's raw count would promise articles that were
      // deliberately not started.
      planned: result.kept.length,
      topics: result.kept,
      // How many the locks caught, and each one's sentence. This is the number that says
      // whether the planner is repeating itself, so it is reported even when it is zero.
      droppedDuplicates: result.dropped.length,
      dropped: result.dropped,
      chain,
      // Echoed into jobs_log so /api/schedule/history can tell a scheduled run from a
      // hand-started one, tie it to the articles it produced, and say whether THAT run was
      // set to publish on its own — not merely what the toggle happens to say today.
      source,
      scheduleRunId,
      autoPublish,
      // Recorded in jobs_log so the dashboard can say WHY these topics, not just which.
      groundedIn: result.groundedIn,
    };
  }
}

export type PlannedTopic = { topic: string; why: string };

export type DroppedTopic = {
  topic: string;
  status: "exists" | "in_progress";
  /** Where the thing that already covers it lives, so the UI can link straight to it. */
  url: string | null;
  /** The full sentence, same wording Mr. Writer uses when it refuses one (agents/writer.ts). */
  reason: string;
};

/** Run the duplicate locks over a planned list and keep only what is genuinely new (§25.5).
 *
 *  `check` is injected rather than imported so this can be tested without a database, and so
 *  the one call the planner makes per topic is visible at the call site rather than hidden
 *  three files down.
 *
 *  Two decisions worth stating:
 *
 *   · a LOOKUP FAILURE KEEPS the topic. checkDuplicate() already swallows its own missing-table
 *     and query errors and answers "free"; if it throws anyway, the safe direction is to plan
 *     the article and let the writer's own check (which runs seconds before the LLM call) catch
 *     it. Dropping on an error would silently stop planning for a tenant whose migration is
 *     half-applied, and nobody would know why;
 *
 *   · topics are checked SEQUENTIALLY, and each kept topic is remembered. Two topics in one
 *     plan that slug to the same thing ("ISO 9001 Cost" and "iso-9001 cost") are a duplicate
 *     the database cannot catch, because neither of them has been written yet. */
export async function dropDuplicateTopics(
  topics: PlannedTopic[],
  check: (topic: string) => Promise<DuplicateVerdict>
): Promise<{ kept: PlannedTopic[]; dropped: DroppedTopic[] }> {
  const kept: PlannedTopic[] = [];
  const dropped: DroppedTopic[] = [];
  const keptKeys = new Set<string>();

  for (const t of topics) {
    const key = t.topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (key && keptKeys.has(key)) {
      dropped.push({
        topic: t.topic,
        status: "exists",
        url: null,
        reason: `"${t.topic}" isi plan me pehle se hai — ek hi cheez do baar shuru karne ka koi matlab nahi.`,
      });
      continue;
    }

    let verdict: DuplicateVerdict;
    try {
      verdict = await check(t.topic);
    } catch (e: any) {
      console.error(`[boss] duplicate check failed for "${t.topic}", keeping it:`, e?.message);
      verdict = { status: "free" };
    }

    if (verdict.status === "free") {
      kept.push(t);
      if (key) keptKeys.add(key);
      continue;
    }

    dropped.push({
      topic: t.topic,
      status: verdict.status,
      url: verdict.status === "exists" ? verdict.url : null,
      reason: duplicateSentence(verdict),
    });
  }

  return { kept, dropped };
}
