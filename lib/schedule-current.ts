"use client";
import { useSyncExternalStore } from "react";

/** One shared, adaptive poll of /api/schedule/current for everything that shows "what is the
 *  schedule doing" — the Dashboard card, the Leads card and the run view.
 *
 *  Three components reading the same endpoint must cost ONE request per tick, not three, and an
 *  idle account must not poll every few seconds forever (the 2026-09-05 egress incident). So:
 *   - the poll only exists while something is subscribed;
 *   - 6s while a scheduled run is in flight, 60s otherwise;
 *   - nothing is fetched while the tab is hidden, and the moment it is visible again it catches up. */

export type CurrentRun = {
  id: string;
  kind: "article" | "leads" | "audit";
  /** The agent working right now (article chains move boss → keyword → writer → …). */
  agent: string;
  title: string;
  startedAt: string;
  stage: string;
  line: string | null;
  steps: { id: string; label: string; state: "done" | "now" | "next" }[] | null;
};
export type CurrentSchedule = {
  kind: string;
  label: string;
  enabled: boolean;
  count: number | null;
  lastRunAt: string | null;
  timezone: string;
  nextRunAt: string | null;
};
export type ScheduleCurrent = { runs: CurrentRun[]; schedules: CurrentSchedule[] };

const BUSY_MS = 6_000;
const IDLE_MS = 60_000;

let data: ScheduleCurrent | null = null;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

function emit() { subs.forEach((f) => f()); }

async function load() {
  if (inflight) return;
  inflight = true;
  try {
    const r = await fetch("/api/schedule/current", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j?.ok) {
        data = { runs: j.runs ?? [], schedules: j.schedules ?? [] };
        emit();
      }
    }
  } catch {
    // Offline or a blip: keep what is on screen and try again on the next tick.
  } finally {
    inflight = false;
  }
}

function loop() {
  timer = setTimeout(async () => {
    if (typeof document === "undefined" || !document.hidden) await load();
    if (subs.size) loop();
  }, data?.runs.length ? BUSY_MS : IDLE_MS);
}

function onVisible() { if (!document.hidden && subs.size) void load(); }

function subscribe(cb: () => void) {
  subs.add(cb);
  if (subs.size === 1) {
    document.addEventListener("visibilitychange", onVisible);
    void load();
    loop();
  }
  return () => {
    subs.delete(cb);
    if (!subs.size) {
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** Ask for a fresh read now (after saving a schedule, say). */
export function refreshScheduleCurrent() { void load(); }

export function useScheduleCurrent(): ScheduleCurrent | null {
  return useSyncExternalStore(subscribe, () => data, () => null);
}

/* ── "Open this run" hand-off ─────────────────────────────────────────────────────────────
 *  The card can sit on the Leads page while the run view and the chat live on the Dashboard
 *  shell, so opening a run is a message, not a prop. */
export type FocusRun = Pick<CurrentRun, "id" | "kind" | "agent" | "title" | "startedAt">;
export const FOCUS_EVENT = "lx:focus-run";
const FOCUS_KEY = "lx:focus-run";

/** The chat thread a scheduled run lives in. Deterministic, so the same run always maps to the same
 *  conversation (the events API finds it by this title). */
export function runConversationTitle(run: FocusRun): string {
  const kind = run.kind === "leads" ? "leads" : run.kind === "audit" ? "audit" : "article";
  const at = new Date(run.startedAt);
  const stamp = `${at.toLocaleDateString([], { day: "numeric", month: "short" })}, ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return `Scheduled ${kind} run · ${stamp}`;
}

export function focusRun(run: FocusRun) {
  try { sessionStorage.setItem(FOCUS_KEY, JSON.stringify(run)); } catch {}
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: run }));
}

/** Reads and clears a pending request — for the case where the shell was not mounted yet. */
export function takeFocusRun(): FocusRun | null {
  try {
    const raw = sessionStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(FOCUS_KEY);
    const r = JSON.parse(raw);
    return r && typeof r.id === "string" ? (r as FocusRun) : null;
  } catch {
    return null;
  }
}
