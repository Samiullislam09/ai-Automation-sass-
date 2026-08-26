import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cached, sessionKey, TTL } from "@/lib/chat-cache";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getDashboardStats, getAgentRoomStates, getRecentJobs, getRunningCrawl, getPendingKeywordChoice } from "@/lib/dashboard-data";
import { buildTimeline, getNextRun } from "@/lib/office-timeline";
import { listPending } from "@/lib/scheduled-orders";
import { AGENTS as STORE_AGENTS } from "@/lib/agents-data";

/** The office's live feed — the ONLY source of truth for what animates in the pixel scene.
 *  Nothing here is a demo loop: every field is read back out of jobs_log / content_items /
 *  schedules, and components/LiveAgents.tsx pushes the result into the store that the office,
 *  the stat row, the run log and the chat's work strip all read.
 *
 *  WHY ?full=1 EXISTS. This route was answering in 27-39 SECONDS on a dev machine while
 *  /api/memory next door answered in 650ms. It was making fifteen Supabase round trips per
 *  poll, and five of them — the raw jobs/content event cursors, the pending list, the donut's
 *  full status scan, the activity feed — are read by exactly one component,
 *  components/dashboard/AICommandCenter.tsx, which is kept in the repo but is not routed
 *  anywhere. A poll that runs a full-table status scan for a screen nobody can open is not a
 *  cost the office can carry, least of all now that it polls every 1.2s while a job is
 *  running. They are still served, on request, so re-routing that component is a one-word
 *  change to its fetch URL and not a hunt through this file. */
export async function GET(req: NextRequest) {
  // Phase stopwatch, kept in shipped code for the same reason /api/chat has one: "the office
  // feels laggy" is unanswerable without knowing whether the time went to proving who you are
  // or to reading the rows.
  const t0 = Date.now();
  const mark: Record<string, number> = {};
  const lap = (n: string) => { mark[n] = Date.now() - t0; };

  const supabase = await createClient();
  // Same trick, and same safety argument, as /api/chat: keyed by a SHA-256 of this browser's
  // own Supabase auth cookies, so a different or expired token is a different key and gets a
  // real verification. It saves two strictly serial network round trips (auth.getUser, then
  // the memberships row) on every single poll — and this endpoint is polled every 1.2 seconds
  // while a job runs.
  const sk = sessionKey((await cookies()).getAll());
  const tenantId = sk
    ? await cached(`live:${sk}`, TTL.session, () => getCurrentTenantId(supabase))
    : await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  lap("auth");

  // components/dashboard/AICommandCenter.tsx asks for this; the office does not.
  const full = req.nextUrl.searchParams.get("full") === "1";
  const since = req.nextUrl.searchParams.get("since");
  const sinceIso = since && !isNaN(Date.parse(since)) ? since : new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Not everything on this screen changes at the same speed, and the poll now runs every 1.2
  // seconds while a job is in flight. What an agent is doing right now has to be read every
  // time; the counters under the office and the next-run clock do not — a stat row that is
  // five seconds stale is indistinguishable from a live one, and re-running four COUNT queries
  // and a schedules read every 1.2s to prove that is the difference between a feed that
  // answers in under a second and one that piles up behind itself.
  const [rooms, stats, allJobs, crawl, keywordChoice, nextRun, orders] = await Promise.all([
    getAgentRoomStates(supabase, tenantId),
    cached(`live-stats:${tenantId}`, 5_000, () => getDashboardStats(supabase, tenantId)),
    // each with a human summary of what it produced — powers the "just finished" popup on the
    // office and the "who is working right now" strip in the chat. Twenty rather than eight
    // because the office log below is built from the SAME rows: a second query for "what has
    // the team been doing" is a second answer waiting to disagree with the first.
    getRecentJobs(supabase, tenantId, 20),
    // The site crawl has no office room and takes ~10 minutes; this is the only place it is
    // visible while it runs.
    getRunningCrawl(supabase, tenantId),
    // A keyword choice counting down in front of the user. Same poll — a second one just to
    // ask "is anything waiting?" would double the request rate for one small row.
    getPendingKeywordChoice(supabase, tenantId),
    // The board on the office wall: when the team next starts on its own, counted down from
    // the tenant's own timezone. Null when no schedule row exists or automation is off.
    // Thirty seconds: the countdown on the office wall ticks in the browser from the instant
    // this returns, and the Schedule page reloads its own copy the moment you change it.
    cached(`live-next:${tenantId}`, 30_000, () => getNextRun(supabase, tenantId)),
    // One-off orders booked in the chat ("30 min baad publish kar do"). On the same board as
    // the recurring run, because from where the customer is standing they are the same
    // question — "what is my team about to do without me?" — and answering it from two
    // screens is how the chat came to be the only place that knew.
    cached(`live-orders:${tenantId}`, 15_000, () => listPending(supabase, tenantId, 5)),
  ]);

  lap("reads");

  // The office's own log, oldest first, built from the rows above rather than from a fresh
  // query — see lib/office-timeline.ts for why the handoff arrows are the real pipeline and
  // not an inference about who probably passed what to whom.
  const { events, handoffs } = buildTimeline(allJobs);

  const base = {
    ok: true,
    serverTime: new Date().toISOString(),
    agentStates: rooms,
    // The strip in the chat only ever showed the newest few; the office needs the window.
    recentJobs: allJobs.slice(0, 8),
    timeline: events,
    handoffs,
    nextRun,
    orders,
    crawl,
    keywordChoice,
    stats,
    capacity: { liveAgents: STORE_AGENTS.filter((a) => a.live).length, totalAgents: STORE_AGENTS.length, pagesIndexed: stats.pagesIndexed },
  };

  if (!full) {
    console.log(`[live] timing ${JSON.stringify(mark)}`);
    return NextResponse.json(base, { headers: { "Server-Timing": Object.entries(mark).map(([k, v]) => `${k};dur=${v}`).join(", ") } });
  }

  const [{ data: jobs }, { data: contentItems }, { data: pendingItems }, { data: allStatuses }, { data: recentDone }] = await Promise.all([
    supabase.from("jobs_log").select("id, agent, status, created_at").eq("tenant_id", tenantId).gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(40),
    supabase.from("content_items").select("id, status, title, type, updated_at").eq("tenant_id", tenantId).gte("updated_at", sinceIso).order("updated_at", { ascending: true }).limit(40),
    supabase.from("content_items").select("id, title, type, created_at").eq("tenant_id", tenantId).eq("status", "awaiting_approval").order("created_at", { ascending: false }).limit(5),
    // Donut breakdown — real content_items lifecycle counts. This one has no filter and no
    // limit, which is exactly why it does not belong in the default poll.
    supabase.from("content_items").select("status").eq("tenant_id", tenantId),
    // Recent real activity for the feed card's initial hydrate.
    supabase.from("content_items").select("title, type, status, updated_at").eq("tenant_id", tenantId).in("status", ["published", "failed", "awaiting_approval"]).order("updated_at", { ascending: false }).limit(5),
  ]);

  const counts = { draft: 0, awaiting_approval: 0, published: 0, failed: 0, rejected: 0 };
  for (const c of allStatuses ?? []) if (c.status in counts) (counts as any)[c.status]++;
  const donutTotal = counts.draft + counts.awaiting_approval + counts.published + counts.failed;

  return NextResponse.json({
    ...base,
    jobs: jobs ?? [],
    contentEvents: contentItems ?? [],
    pending: (pendingItems ?? []).map((p) => ({ id: p.id, title: p.title ?? p.type, createdAt: p.created_at })),
    feed: (recentDone ?? []).map((r) => ({ title: r.title ?? r.type, status: r.status, at: r.updated_at })),
    donut: { inProgress: counts.draft, review: counts.awaiting_approval, published: counts.published, error: counts.failed, total: donutTotal },
  });
}
