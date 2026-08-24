"use client";
import { useCallback, useEffect, useRef } from "react";
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

export const POLL_MS = 4000;

export default function LiveAgents() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const stopped = useRef(false);
  const inFlight = useRef(false);
  const seenJobs = useRef<Set<string>>(new Set());
  const primed = useRef(false); // first poll only records history, it never announces it
  const flashTimer = useRef<any>(null);

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

      const jobs: Job[] = data.recentJobs ?? [];
      api?.patch?.({ stats: data.stats ?? null, recentJobs: jobs, crawl: data.crawl ?? null, liveError: null });

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
              { id: j.id, text: `${NAME[id] ?? "Your team"} — ${j.summary}`, tone },
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
    const t = setInterval(poll, POLL_MS);
    return () => { stopped.current = true; clearInterval(t); clearTimeout(flashTimer.current); };
  }, [poll]);

  return null;
}
