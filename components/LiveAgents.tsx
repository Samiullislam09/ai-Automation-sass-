"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS, useStore, type AgentState } from "@/lib/store";
import { playError, playSuccess } from "@/lib/chime";

/** The single live poll for the whole /app shell.
 *
 *  It used to live inside the dashboard page, which meant the chat had no idea what the team
 *  was doing and every other page was blind. Now it sits in the layout: one request every few
 *  seconds, pushed into the store, read by the office (rooms light up), the stat row, and the
 *  chat's "who is working right now" strip.
 *
 *  It also announces transitions: when a job it hasn't seen before comes back success/error,
 *  the office pops a receipt over that agent's room and a toast fires. Only jobs that finish
 *  AFTER this component mounts are announced — otherwise every page load would replay
 *  yesterday's work as if it had just happened.
 *
 *  Renders nothing. */

type RoomState = { state: "working" | "off" | "error" | "waiting"; task: string };
type Job = { id: string; agentId?: string; task: string; status: string; at: string; summary: string; items: string[] };

const ROOM_TO_AGENT: Record<string, string> = { keyword: "kw", webstory: "story" };
const LIVE = new Set(AGENTS.filter((a) => a.live).map((a) => a.id));
const NAME = Object.fromEntries(AGENTS.map((a) => [a.id, a.name]));

function toAgentState(agentId: string, r: RoomState): AgentState {
  if (r.state === "working") return { st: "w", task: r.task };
  if (r.state === "error") return { st: "e", task: r.task };
  if (r.state === "waiting") return { st: "i", task: r.task };
  return LIVE.has(agentId) ? { st: "i", task: "Idle" } : { st: "o", task: "Coming soon" };
}

/** The resting cadence. */
export const POLL_MS = 4000;
/** While a run is in flight.
 *
 *  Four seconds is fine for an idle office and far too slow for one that was just given an
 *  order: the whole complaint was that nothing appeared to happen for several seconds after
 *  asking for an article. A run is minutes of real work, so a second-by-second poll for its
 *  duration is a handful of extra requests, not a load problem — and it is what makes the
 *  handoff from one room to the next land while you are still looking at it. */
const BUSY_POLL_MS = 1200;
/** How long an accepted-but-not-yet-visible order is allowed to stand on its own.
 *
 *  pg-boss normally picks a job up in well under a second. If ninety seconds pass with no
 *  jobs_log row at all, the worker is not running — and the office must stop saying the team
 *  is on it, because at that point nobody is. */
const RUN_GRACE_MS = 90_000;

/** Rows sorted the way the question is asked: the biggest real audience first.
 *
 *  "Ranking" here means measured demand, and the sources do not measure the same thing —
 *  DataForSEO gives monthly search volume for the market, Search Console gives impressions
 *  for THIS site, and the AI fallback gives neither. So they sort in that order of evidence
 *  and a row with no number sinks to the bottom rather than being given an invented one. */
function byRanking(a: any, b: any) {
  const rank = (c: any) => (c.searchVolume != null ? 2 : c.impressions != null ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(b) - rank(a);
  if (a.searchVolume != null && b.searchVolume != null) return b.searchVolume - a.searchVolume;
  if (a.impressions != null && b.impressions != null) return b.impressions - a.impressions;
  return String(a.keyword).localeCompare(String(b.keyword));
}

/** The keyword options as a table the chat can actually render.
 *
 *  This used to be one green paragraph of "keyword · 12000/mo · low competition · ←
 *  recommended" per line, which is a table written out longhand and unreadable at chat width.
 *  A markdown table is stored as-is in the transcript (migration 013 keeps the text), stays
 *  legible if anything ever shows it raw, and components/kit.tsx turns it into a real one.
 *
 *  A dash is the honest cell for a source that does not measure that column. */
function keywordTable(topic: string, candidates: any[]): string {
  const rows = candidates.slice().sort(byRanking).slice(0, 8);
  const cell = (c: any) => [
    c.recommended ? `**${c.keyword}**` : c.keyword,
    c.searchVolume != null ? Number(c.searchVolume).toLocaleString() : "—",
    c.competitionLevel ? String(c.competitionLevel).toLowerCase() : "—",
    c.impressions != null ? `${c.impressions}${c.position != null ? ` · pos ${Number(c.position).toFixed(1)}` : ""}` : "—",
  ];
  return [
    `Mr. Keyword's options for “${topic}” — best first:`,
    "",
    "| # | Keyword | Searches/mo | Competition | On your site |",
    "|---|---|---|---|---|",
    ...rows.map((c, i) => `| ${i + 1} | ${cell(c).join(" | ")} |`),
    "",
    "Pick one on the dashboard, or the recommended one (bold) starts automatically.",
  ].join("\n");
}

export default function LiveAgents() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const stopped = useRef(false);
  const inFlight = useRef(false);
  const seenJobs = useRef<Set<string>>(new Set());
  const primed = useRef(false); // first poll only records history, it never announces it
  const flashTimer = useRef<any>(null);
  const announcedChoice = useRef<string | null>(null);
  // Drives the interval below. Not a ref: changing the cadence has to re-run the effect.
  const [busy, setBusy] = useState(false);

  const poll = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    inFlight.current = true;
    const api = storeRef.current;
    try {
      const res = await fetch("/api/dashboard/live", { cache: "no-store" });
      if (res.status === 401) { stopped.current = true; return; }
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Live feed returned non-JSON (status ${res.status})`); }
      if (!data?.ok) throw new Error(data?.error ?? `Live feed failed (status ${res.status})`);

      for (const [room, r] of Object.entries<RoomState>(data.agentStates ?? {})) {
        const id = ROOM_TO_AGENT[room] ?? room;
        const next = toAgentState(id, r);
        api?.setAgent?.(id, next.st, next.task);
      }

      // The keyword options go into the chat from here rather than from the panel that draws
      // the table: the panel only exists on the dashboard, and someone reading Reports when
      // the countdown starts still needs to see what they were offered.
      const choice = data.keywordChoice;
      if (choice?.id && announcedChoice.current !== choice.id) {
        announcedChoice.current = choice.id;
        api?.patch?.((prev: any) => ({
          chatNotices: [
            ...(prev.chatNotices ?? []),
            { id: `choice-${choice.id}`, tone: "done" as const, text: keywordTable(choice.topic, choice.candidates ?? []) },
          ].slice(-20),
        }));
      }

      const jobs: Job[] = data.recentJobs ?? [];
      const timeline: any[] = data.timeline ?? [];

      // An accepted order stops being ours to display the moment the database can speak for
      // itself. Anything else would leave two claims about the same work on screen at once.
      const run = api?.s?.run ?? null;
      const newestForRun = run ? timeline.filter((e) => e.agentId === run.agentId).slice(-1)[0]?.id ?? null : null;
      const supersededRun = run && (newestForRun !== (run.after ?? null) || Date.now() - run.at > RUN_GRACE_MS);

      api?.patch?.({
        stats: data.stats ?? null,
        recentJobs: jobs,
        timeline,
        handoffs: data.handoffs ?? [],
        nextRun: data.nextRun ?? null,
        orders: data.orders ?? [],
        crawl: data.crawl ?? null,
        keywordChoice: data.keywordChoice ?? null,
        liveError: null,
        ...(supersededRun ? { run: null } : {}),
      });

      // Poll hard while there is something to watch: a job running, a keyword countdown, a
      // crawl in progress, or an order we have just accepted.
      const anythingLive =
        timeline.some((e) => e.status === "running" || e.status === "queued") ||
        !!data.keywordChoice ||
        !!data.crawl ||
        (!!run && !supersededRun);
      setBusy(anythingLive);

      const finished = jobs.filter((j) => j.status === "success" || j.status === "error");
      if (!primed.current) {
        finished.forEach((j) => seenJobs.current.add(j.id));
        primed.current = true;
      } else {
        // oldest first, so the newest job is the one left on screen
        const fresh = finished.filter((j) => !seenJobs.current.has(j.id)).reverse();
        for (const j of fresh) {
          seenJobs.current.add(j.id);
          const id = j.agentId ?? "";
          const tone = j.status === "error" ? "error" : "done";
          api?.patch?.({
            flash: { id, text: j.summary, tone },
            // The office steps aside and the result fills the screen. Only the newest job
            // survives this loop, which is why `fresh` is walked oldest-first.
            celebration: { id: j.id, agentId: id, status: j.status, summary: j.summary, items: j.items ?? [] },
          });
          // Opt-in, remembered per browser (lib/chime.ts). Silent unless you turned it on.
          if (j.status === "error") playError(); else playSuccess();
          api?.toast?.(`${NAME[id] ?? "Your team"}: ${j.summary.slice(0, 90)}`);
          // Into the conversation as well. A toast lasts three seconds; "did the article get
          // written?" gets asked long after that, and the chat is where it gets asked.
          api?.patch?.((prev: any) => ({
            chatNotices: [
              ...(prev.chatNotices ?? []),
              // agentId travels with the notice so the chat can draw the name as a chip on the
              // system card instead of repeating it inside the sentence (lib/chat-events.ts).
              { id: j.id, text: `${NAME[id] ?? "Your team"} — ${j.summary}`, tone, agentId: id || undefined },
            ].slice(-20),
          }));
          api?.act?.(j.summary, NAME[id] ?? "Team");
          clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => storeRef.current?.patch?.({ flash: null }), 7000);
        }
      }
    } catch (e: any) {
      storeRef.current?.patch?.({ liveError: e?.message ?? "Could not reach the live feed." });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    poll();
    const t = setInterval(poll, busy ? BUSY_POLL_MS : POLL_MS);
    return () => { stopped.current = true; clearInterval(t); clearTimeout(flashTimer.current); };
  }, [poll, busy]);

  return null;
}
