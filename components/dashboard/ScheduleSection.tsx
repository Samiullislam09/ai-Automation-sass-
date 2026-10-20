"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { startPolling } from "@/lib/poll";
import { nextRunAt } from "@/lib/schedule-time";

/** /dashboard/schedule — rebuilt 2026-10-21 to match the owner-supplied reference
 *  (Downloads/Schedule.html): a Google-Material panel with a status pill, a four-tile stat
 *  strip, four tabs (Automation / Upcoming / Tasks from Mr Lxwa / History) and a modal editor
 *  per automation. Design ported 1:1 from that file; the palette is pinned to the reference's
 *  DARK tokens because this panel always lives inside the dark dashboard shell.
 *
 *  EVERY kind the backend honours is now a real row: article, LEADS and AUDIT — exactly what
 *  agent-server/src/scheduler.ts runs (line ~333) and what the DB check constraint allows after
 *  migrations 027 (audit) and 028 (leads + count ceiling 50). The web API route was extended in
 *  the same change (app/api/schedule/route.ts: KINDS + per-kind MAX_COUNT) so these actually
 *  save. Social stays a disabled "coming soon" row because its agent is still a stub.
 *
 *  Data is live: /api/schedule (+ PUT), /api/schedule/history, /api/scheduled-orders (+ DELETE),
 *  /api/integrations. Next-run instants come from the server; the page only formats and ticks.
 */

/* ───────────────────────── icons (ported from the reference IC map) ───────────────────────── */
const IC: Record<string, string> = {
  article: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  search: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  check: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  hourglass: "M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z",
  bolt: "M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z",
  event: "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z",
  robot: "M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z",
  history: "M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  publish: "M5 4v2h14V4H5zm0 10h4v6h6v-6h4l-7-7-7 7z",
  idea: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z",
  error: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  refresh: "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};
function Ic({ n, z = 22 }: { n: string; z?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={z} height={z} fill="currentColor" aria-hidden="true">
      <path d={IC[n]} />
    </svg>
  );
}

/* ───────────────────────── types & kind config ───────────────────────── */
type Kind = "article" | "leads" | "audit";

type Sched = {
  kind: Kind;
  enabled: boolean;
  frequency: "daily" | "weekdays" | "weekly";
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  count: number;
  autoPublish: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

type Run = {
  id: string;
  firedAt: string;
  status: "running" | "finished" | "partial" | "failed";
  planned: number | null;
  reason: string | null;
  autoPublish: boolean | null;
  bossError: string | null;
  topics: string[];
  linkedBy: "run-id" | "time";
  articles: { id: string; title: string; status: string; words: number | null; publishedUrl: string | null; publishError: string | null }[];
  failures: { agent: string; task: string; message: string; at: string }[];
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQ: Record<string, string> = { daily: "Every day", weekdays: "Mon–Fri", weekly: "Weekly" };

const TZS = ["UTC", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "America/New_York", "Australia/Sydney"];

const META: Record<Kind, { icon: string; name: string; desc: string; q: string; max: number; hasCount: boolean; hasAuto: boolean }> = {
  article: { icon: "article", name: "Articles", desc: "The team writes articles on its own.", q: "When should the team write?", max: 5, hasCount: true, hasAuto: true },
  leads: { icon: "people", name: "Leads", desc: "Fresh buyer leads, delivered after you approve them.", q: "When should the team find leads?", max: 50, hasCount: true, hasAuto: false },
  audit: { icon: "search", name: "Site audit (Mr Audit)", desc: "A report on how your site is doing.", q: "When should Mr Audit check your site?", max: 5, hasCount: false, hasAuto: false },
};

const browserTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};
const DEFAULT = (kind: Kind, tz: string): Sched => ({
  kind, enabled: false, frequency: kind === "audit" ? "weekly" : kind === "leads" ? "weekdays" : "daily",
  dayOfWeek: 1, timeOfDay: kind === "audit" ? "08:00" : kind === "leads" ? "10:00" : "09:00",
  timezone: tz, count: kind === "leads" ? 10 : 2, autoPublish: false, lastRunAt: null, nextRunAt: null,
});

/* ───────────────────────── tz-aware date helpers ───────────────────────── */
const toRow = (s: Sched) => ({ frequency: s.frequency, day_of_week: s.dayOfWeek, time_of_day: s.timeOfDay, timezone: s.timezone });
const ymd = (d: Date, tz: string) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); } catch { return d.toISOString().slice(0, 10); } };
const dayOffset = (d: Date, tz: string, nowMs: number) => Math.round((Date.parse(ymd(d, tz)) - Date.parse(ymd(new Date(nowMs), tz))) / 86400000);
const time12 = (d: Date, tz: string) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d); } catch { return ""; } };
/** A plain "HH:MM" turned into a 12-hour label, with no timezone shift. */
const hm12 = (hhmm: string) => { const [h, m] = String(hhmm).split(":").map(Number); if (!Number.isFinite(h)) return hhmm; return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
function dayLabel(d: Date, tz: string, nowMs: number) {
  const off = dayOffset(d, tz, nowMs);
  if (off === 0) return "Today";
  if (off === 1) return "Tomorrow";
  if (off === -1) return "Yesterday";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "short" }).format(d); } catch { return d.toDateString(); }
}
function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${h}h ${pad(m)}m`;
  return `${h}h ${pad(m)}m ${pad(s)}s`;
}

/* ═════════════════════════════════════════════════════════════════════════ */
export default function ScheduleSection() {
  const { toast, confirmAction } = useStore();
  // Seeded with (disabled) defaults so the page paints instantly instead of flashing a
  // full-panel "Loading…" on every visit; the real rows arrive from /api/schedule a moment
  // later. "UTC" keeps the first paint deterministic for SSR — loadSchedule swaps in the real
  // timezone right away.
  const [scheds, setScheds] = useState<Record<Kind, Sched>>(() => ({
    article: DEFAULT("article", "UTC"), leads: DEFAULT("leads", "UTC"), audit: DEFAULT("audit", "UTC"),
  }));
  const [autoPublishAvailable, setAutoPublishAvailable] = useState(true);
  const [canPublish, setCanPublish] = useState<boolean | null>(null);
  const [publishTarget, setPublishTarget] = useState<string | null>(null);
  const [migration, setMigration] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [orders, setOrders] = useState<any[] | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [tab, setTab] = useState<"auto" | "up" | "tasks" | "hist">("auto");

  // modal editor
  const [modalKind, setModalKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Sched | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalErr, setModalErr] = useState("");

  // filters / search
  const [tf, setTf] = useState("all");
  const [hf, setHf] = useState("all");
  const [uf, setUf] = useState("7");
  const [ud, setUd] = useState("");
  const [qTasks, setQTasks] = useState("");
  const [qHist, setQHist] = useState("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState("");

  const skewRef = useRef(0);

  const loadSchedule = useCallback(async () => {
    const tz = browserTz();
    const blank = { article: DEFAULT("article", tz), leads: DEFAULT("leads", tz), audit: DEFAULT("audit", tz) };
    try {
      const d = await fetch("/api/schedule", { cache: "no-store" }).then((r) => r.json());
      if (d.serverNow) skewRef.current = Date.parse(d.serverNow) - Date.now();
      if (!d.ok) { setLoadError(d.error ?? "Couldn't load the schedule."); setMigration(!!d.needsMigration); setScheds(blank); return; }
      setLoadError(""); setMigration(false);
      setAutoPublishAvailable(d.autoPublishAvailable !== false);
      const next = { ...blank };
      for (const row of d.schedules ?? []) {
        const k = row.kind as Kind;
        if (k !== "article" && k !== "leads" && k !== "audit") continue;
        next[k] = {
          kind: k, enabled: row.enabled, frequency: row.frequency, dayOfWeek: row.day_of_week,
          timeOfDay: row.time_of_day, timezone: row.timezone, count: row.count,
          autoPublish: row.auto_publish === true, lastRunAt: row.last_run_at, nextRunAt: row.nextRunAt ?? null,
        };
      }
      setScheds(next);
    } catch (e: any) {
      setLoadError(e?.message ?? "Network error.");
      setScheds((s) => s ?? blank);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const d = await fetch("/api/schedule/history", { cache: "no-store" }).then((r) => r.json());
      if (!d.ok) { setHistoryError(d.error ?? "Couldn't load run history."); return; }
      setHistoryError(""); setRuns(d.runs ?? []);
    } catch (e: any) { setHistoryError(e?.message ?? "Network error."); }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const d = await fetch("/api/scheduled-orders", { cache: "no-store" }).then((r) => r.json());
      setOrders(d.ok ? [...(d.pending ?? []), ...(d.recent ?? [])] : []);
    } catch { setOrders([]); }
  }, []);

  useEffect(() => {
    void loadSchedule(); void loadHistory(); void loadOrders();
    fetch("/api/integrations", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (!d.ok) { setCanPublish(false); return; }
      const t = (d.items ?? []).find((i: any) => (i.type === "wordpress" || i.type === "webhook") && i.status === "connected");
      setCanPublish(!!t); setPublishTarget(t ? (t.type === "wordpress" ? "WordPress" : "Webhook") : null);
    }).catch(() => setCanPublish(false));
  }, [loadSchedule, loadHistory, loadOrders]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    setNow(Date.now() + skewRef.current);
    return () => clearInterval(t);
  }, []);

  const anyRunning = !!runs?.some((r) => r.status === "running");
  useEffect(() => startPolling(() => void loadHistory(), anyRunning ? 20_000 : 120_000), [anyRunning, loadHistory]);
  useEffect(() => startPolling(() => void loadOrders(), 30_000), [loadOrders]);

  /* ---- save (PUT) ---- */
  const put = useCallback(async (s: Sched): Promise<boolean> => {
    const body = {
      kind: s.kind, enabled: s.enabled, frequency: s.frequency, dayOfWeek: s.dayOfWeek,
      timeOfDay: s.timeOfDay, timezone: s.timezone, count: s.count, autoPublish: s.autoPublish,
    };
    const res = await fetch("/api/schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!d.ok) { setModalErr(d.error ?? "Couldn't save."); toast(d.error ?? "Couldn't save.", "error"); return false; }
    if (d.autoPublishAvailable === false) setAutoPublishAvailable(false);
    await loadSchedule();
    return true;
  }, [loadSchedule, toast]);

  const toggleRow = async (k: Kind) => {
    if (!scheds) return;
    const next = { ...scheds[k], enabled: !scheds[k].enabled };
    setScheds({ ...scheds, [k]: next });            // optimistic
    const ok = await put(next);
    if (ok) toast(next.enabled ? `${META[k].name} schedule is on.` : `${META[k].name} schedule turned off.`);
  };

  const cancelOrder = async (id: string) => {
    const ok = await confirmAction({ title: "Cancel this task?", body: "It will not run. You can ask Mr Lxwa again in the chat.", confirmLabel: "Cancel task", danger: true });
    if (!ok) return;
    setCancelling(id);
    try {
      const d = await fetch(`/api/scheduled-orders?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json());
      await loadOrders();
      toast(d.ok ? "Task cancelled." : d.error ?? "Couldn't cancel.", d.ok ? "ok" : "error");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setCancelling(""); }
  };

  /* ---- modal ---- */
  const openModal = (k: Kind) => { if (!scheds) return; setModalKind(k); setDraft({ ...scheds[k] }); setModalErr(""); };
  const closeModal = () => { setModalKind(null); setDraft(null); };
  const saveModal = async () => {
    if (!draft) return;
    setSaving(true); setModalErr("");
    const ok = await put(draft);
    setSaving(false);
    if (ok) { toast("Saved."); closeModal(); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- derived ---- */
  const tz = scheds?.article.timezone || browserTz();
  const pendingOrders = useMemo(() => (orders ?? []).filter((o) => o.status === "pending"), [orders]);

  const nextInfo = useMemo(() => {
    if (!scheds) return null;
    const cands = (Object.values(scheds) as Sched[]).filter((s) => s.enabled && s.nextRunAt).map((s) => ({ s, at: new Date(s.nextRunAt!) }));
    cands.sort((a, b) => a.at.getTime() - b.at.getTime());
    return cands[0] ?? null;
  }, [scheds]);

  const onCount = scheds ? (Object.values(scheds) as Sched[]).filter((s) => s.enabled).length : 0;
  const doneToday = (runs ?? []).filter((r) => ymd(new Date(r.firedAt), tz) === ymd(new Date(now), tz) && r.status === "finished").length;
  const failedToday = (runs ?? []).filter((r) => ymd(new Date(r.firedAt), tz) === ymd(new Date(now), tz) && r.status === "failed").length;

  const anyOn = (Object.values(scheds) as Sched[]).some((s) => s.enabled);
  const summary = (k: Kind) => {
    const c = scheds[k];
    if (!c.enabled) return "Off";
    const f = c.frequency === "weekly" ? "Every " + DAYS[c.dayOfWeek] : FREQ[c.frequency];
    const extra = k === "article" ? ` · ${c.count} article${c.count > 1 ? "s" : ""}` : k === "leads" ? ` · ${c.count} leads` : "";
    return `${f} · ${hm12(c.timeOfDay)}${extra}`;
  };

  return (
    <div className="sched">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="panel">
          {/* header */}
          <div className="top">
            <div className="t">
              <h1>Schedule</h1>
              <p className="sub">Set it once and the team works on its own. Tap any item to change it.</p>
            </div>
            <button className="icobtn" title="Refresh" onClick={() => { void loadSchedule(); void loadHistory(); void loadOrders(); }}><Ic n="refresh" z={18} /></button>
            <div className={"pill" + (anyOn ? "" : " off")}><i /><span>{anyOn ? "Schedule is ON" : "Schedule is OFF"}</span></div>
          </div>

          {migration && (
            <div className="banner">Database migration required — run <code>supabase/migrations/006_schedules.sql</code> in the Supabase SQL editor. Nothing will save until you do.</div>
          )}
          {loadError && !migration && <div className="banner">{loadError}</div>}

          {/* stats */}
          <div className="stats">
            <div className="st a"><span className="sbox"><Ic n="clock" /></span><div>
              <div className="sv" suppressHydrationWarning>{!nextInfo ? "Paused" : countdown(nextInfo.at.getTime() - now)}</div>
              <div className="sl">Next task</div>
              <div className="sl" suppressHydrationWarning>{nextInfo ? `${nextInfo.s.kind === "article" ? "Articles" : nextInfo.s.kind === "leads" ? "Leads" : "Site audit"} · ${dayLabel(nextInfo.at, tz, now)} ${time12(nextInfo.at, tz)}` : "nothing scheduled"}</div>
            </div></div>
            <div className="st b"><span className="sbox"><Ic n="check" /></span><div>
              <div className="sv">{runs === null ? "…" : doneToday}</div>
              <div className="sl">Completed today</div>
              <div className="sl">{failedToday ? `${failedToday} failed, check History` : "all went well"}</div>
            </div></div>
            <div className="st c"><span className="sbox"><Ic n="hourglass" /></span><div>
              <div className="sv">{orders === null ? "…" : pendingOrders.length}</div>
              <div className="sl">Tasks from Mr Lxwa</div>
              <div className="sl">{pendingOrders.length ? "waiting to run" : "nothing booked"}</div>
            </div></div>
            <div className="st"><span className="sbox"><Ic n="bolt" /></span><div>
              <div className="sv">{onCount} of 3</div>
              <div className="sl">Automations on</div>
              <div className="sl">article · leads · audit</div>
            </div></div>
          </div>

          {/* tabs */}
          <div className="tabs">
            {([["auto", "Automation", 0], ["up", "Upcoming", 0], ["tasks", "Tasks from Mr Lxwa", pendingOrders.length], ["hist", "History", runs?.length ?? 0]] as [string, string, number][]).map(([k, l, c]) => (
              <button key={k} className={"tab" + (tab === k ? " a" : "")} onClick={() => setTab(k as any)}>
                {l}{c ? <span className={"cnt" + (k === "tasks" ? " hi" : "")}>{c}</span> : null}
              </button>
            ))}
          </div>

          <div className="view">
            {tab === "auto" && (
              <div className="list">
                {(["article", "leads", "audit"] as Kind[]).map((k) => {
                  const c = scheds[k];
                  const nAt = c.nextRunAt ? new Date(c.nextRunAt) : null;
                  return (
                    <div key={k} className="row" role="button" tabIndex={0} onClick={() => openModal(k)}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget === e.target) openModal(k); }}>
                      <span className="ico"><Ic n={META[k].icon} /></span>
                      <span className="info">
                        <div className="name">{META[k].name}</div>
                        <div className="desc">{META[k].desc}</div>
                        <div className={"meta" + (c.enabled ? "" : " off")}>{summary(k)}</div>
                        {c.enabled && nAt && <small suppressHydrationWarning>Next run: {dayLabel(nAt, tz, now)}, {time12(nAt, tz)}</small>}
                      </span>
                      <button className={"tg" + (c.enabled ? " on" : "")} role="switch" aria-checked={c.enabled}
                        aria-label={`${META[k].name} on or off`} onClick={(e) => { e.stopPropagation(); void toggleRow(k); }} />
                      <span className="chev">›</span>
                    </div>
                  );
                })}
                <div className="row dis">
                  <span className="ico"><Ic n="share" /></span>
                  <span className="info"><div className="name">Social posts</div><div className="desc">Post on your social channels automatically.</div></span>
                  <span className="badge">Coming soon</span>
                </div>
                <div className="tip"><Ic n="bolt" z={20} /><div><b>How it runs</b><small>The schedule fires inside agent-server. If that service is down a run is skipped — missed runs are not replayed; the next scheduled time simply runs.</small></div></div>
              </div>
            )}

            {tab === "up" && <Upcoming scheds={scheds} orders={orders} pendingOrders={pendingOrders} now={now} tz={tz} uf={uf} setUf={setUf} ud={ud} setUd={setUd} skip={skip} setSkip={setSkip} onCancel={cancelOrder} cancelling={cancelling} />}

            {tab === "tasks" && <Tasks orders={orders} now={now} tz={tz} tf={tf} setTf={setTf} q={qTasks} setQ={setQTasks} onCancel={cancelOrder} cancelling={cancelling} />}

            {tab === "hist" && <HistoryTab runs={runs} error={historyError} now={now} tz={tz} hf={hf} setHf={setHf} q={qHist} setQ={setQHist} />}
          </div>
        </div>
      </div>

      {/* modal */}
      {modalKind && draft && (
        <div className="ov open" onClick={(e) => { if ((e.target as HTMLElement).classList.contains("ov")) closeModal(); }} role="dialog" aria-modal="true">
          <div className="modal">
            <div className="mh"><span className="ico"><Ic n={META[modalKind].icon} /></span><h2>{META[modalKind].name}</h2><button className="x" aria-label="Close" onClick={closeModal}><Ic n="close" z={22} /></button></div>
            <div className="mb">
              <div className="sw">
                <div><b>{META[modalKind].q}</b><small>{draft.enabled ? "On — runs automatically" : "Off — nothing will run"}</small></div>
                <button className={"tg" + (draft.enabled ? " on" : "")} role="switch" aria-checked={draft.enabled} aria-label="On or off" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} />
              </div>

              <div><label className="l">How often</label>
                <div className="seg">
                  {(["daily", "weekdays", "weekly"] as const).map((f) => (
                    <button key={f} type="button" className={draft.frequency === f ? "a" : ""} onClick={() => setDraft({ ...draft, frequency: f })}>{FREQ[f]}</button>
                  ))}
                </div>
              </div>

              {draft.frequency === "weekly" && (
                <div><label className="l">Which day</label>
                  <select value={draft.dayOfWeek} onChange={(e) => setDraft({ ...draft, dayOfWeek: Number(e.target.value) })}>
                    {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </div>
              )}

              <div><label className="l">Time of day</label><input type="time" value={draft.timeOfDay} onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value || draft.timeOfDay })} /></div>

              <div><label className="l">Timezone</label>
                <div className="tzr">
                  <select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
                    {Array.from(new Set([draft.timezone, browserTz(), ...TZS])).map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                  <button className="btn" type="button" onClick={() => setDraft({ ...draft, timezone: browserTz() })}>Use mine</button>
                </div>
              </div>

              {modalKind === "article" && (
                <>
                  <div><label className="l">Articles per run</label>
                    <div className="seg">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={draft.count === n ? "a" : ""} onClick={() => setDraft({ ...draft, count: n })}>{n}</button>)}</div>
                  </div>
                  <div className="sw">
                    <div><b>Publish without asking me</b><small>{draft.autoPublish ? "Articles go live once all checks pass." : "Articles wait in Approvals for you to okay."}</small></div>
                    <button className={"tg" + (draft.autoPublish ? " on" : "")} role="switch" aria-checked={draft.autoPublish} aria-label="Publish without asking me"
                      disabled={!autoPublishAvailable || canPublish === false}
                      onClick={async () => {
                        if (!draft.autoPublish) {
                          const ok = await confirmAction({ title: "Publish without review?", body: "Every scheduled article that passes the quality gate goes live on your site without you seeing it first.", confirmLabel: "Turn on auto-publish", danger: true });
                          if (!ok) return;
                        }
                        setDraft({ ...draft, autoPublish: !draft.autoPublish });
                      }} />
                  </div>
                  {!autoPublishAvailable && <small className="bad">Run <code>supabase/migrations/014_schedule_auto_publish.sql</code> to enable auto-publish.</small>}
                  {autoPublishAvailable && canPublish === false && <small className="bad">Nowhere to publish yet — connect WordPress or a webhook in <Link href="/dashboard/connect" className="lnk">Connect</Link>.</small>}
                  {autoPublishAvailable && canPublish === true && publishTarget && <small>Goes to: {publishTarget}.</small>}
                  <div className="box">Topics are chosen automatically, and images are made for every article.</div>
                </>
              )}

              {modalKind === "leads" && (
                <>
                  <div><label className="l">Leads per run</label>
                    <input type="number" min={1} max={META.leads.max} value={draft.count}
                      onChange={(e) => setDraft({ ...draft, count: Math.max(1, Math.min(META.leads.max, Number(e.target.value) || 1)) })} />
                    <small className="hint">Your plan allows up to {META.leads.max} per run.</small>
                  </div>
                  <div className="box">Buyer groups rotate automatically, duplicates are removed, and leads are delivered once you approve them.</div>
                </>
              )}

              {modalKind === "audit" && (
                <div className="box">One report is created on every run. Even without a schedule here, a weekly auto-audit keeps running on its own.</div>
              )}

              <div className="next" suppressHydrationWarning>Next: {draft.enabled ? nextPreview(draft, now) : "Paused"}</div>
              <small className="hint">Last run: {draft.lastRunAt ? `${dayLabel(new Date(draft.lastRunAt), tz, now)}, ${time12(new Date(draft.lastRunAt), tz)}` : modalKind === "audit" ? "Weekly auto-audit is running" : "Never run"}</small>
              {modalErr && <small className="bad">{modalErr}</small>}
            </div>
            <div className="mf">
              <button className="btn" onClick={closeModal}>Cancel</button>
              <button className="btn p" disabled={saving} onClick={saveModal}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function nextPreview(draft: Sched, nowMs: number): string {
  const d = nextRunAt(toRow(draft), new Date(nowMs));
  if (!d) return "Paused";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: draft.timezone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) + " " + draft.timezone; }
  catch { return d.toISOString(); }
}

/* ───────────────────────── Upcoming tab (one row per automation, expandable) ───────────────────────── */
function Upcoming({ scheds, orders, pendingOrders, now, tz, uf, setUf, ud, setUd, skip, setSkip, onCancel, cancelling }: any) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const items = useMemo(() => {
    const out: any[] = [];
    (["article", "leads", "audit"] as Kind[]).forEach((k) => {
      const c: Sched = scheds[k];
      if (!c.enabled) return;
      const freq = (c.frequency === "weekly" ? "Every " + DAYS[c.dayOfWeek] : FREQ[c.frequency]) + " at " + hm12(c.timeOfDay);
      let cursor = new Date(now);
      for (let i = 0; i < 60; i++) {
        const d = nextRunAt(toRow(c), cursor);
        if (!d || d.getTime() - now > 30 * 86400000) break;
        const key = `${k}|${ymd(d, tz)}|${c.timeOfDay}`;
        if (!skip.has(key)) out.push({
          at: d, icon: META[k].icon, kind: "auto", srcKind: k, freq, skipKey: key,
          title: k === "article" ? `Write ${c.count} article${c.count > 1 ? "s" : ""}` : k === "leads" ? `Find ${c.count} leads` : "Run site audit",
          sub: k === "article" ? (c.autoPublish ? "Published directly" : "Goes to Approvals") : k === "leads" ? "Delivered after you approve" : "Report made after the run",
        });
        cursor = new Date(d.getTime() + 60000);
      }
    });
    (pendingOrders ?? []).forEach((o: any) => out.push({
      at: new Date(o.run_at), icon: orderIcon(o), kind: "chat", id: o.id, tag: "Mr Lxwa", title: orderWhat(o), sub: orderType(o),
    }));
    out.sort((a, b) => a.at.getTime() - b.at.getTime());
    return out;
  }, [scheds, pendingOrders, now, tz, skip, orders]);

  if (!items.length) return <Empty icon="event" title="Nothing coming up" desc="Turn on an automation, or ask Mr Lxwa in Chat." />;

  const inRange: Record<string, (x: any) => boolean> = {
    today: (x) => dayOffset(x.at, tz, now) === 0,
    tomorrow: (x) => dayOffset(x.at, tz, now) === 1,
    "7": (x) => dayOffset(x.at, tz, now) < 7,
    "14": (x) => dayOffset(x.at, tz, now) < 14,
    "30": (x) => dayOffset(x.at, tz, now) < 30,
    date: (x) => !!ud && ymd(x.at, tz) === ud,
  };
  const pred = inRange[uf] || inRange["7"];
  const list = items.filter(pred);

  // One summary row per recurring automation (grouped by its kind) + chat one-offs as single rows,
  // all interleaved by their earliest time so the order still reads chronologically.
  const groups: Record<string, any[]> = {};
  const entries: { at: number; node: any }[] = [];
  for (const x of list) {
    if (x.kind === "auto") (groups[x.srcKind] ||= []).push(x);
    else entries.push({
      at: x.at.getTime(),
      node: (
        <div key={"c-" + (x.id ?? x.at.getTime())} className="tr up">
          <div className="c main"><span className="ico sm"><Ic n={x.icon} z={20} /></span><div className="info"><div className="name">{x.title}</div><small>{x.sub}</small></div></div>
          <div className="c hide"><span className="tag chat">{x.tag}</span></div>
          <div className="c" suppressHydrationWarning>{dayLabel(x.at, tz, now)}, {time12(x.at, tz)}</div>
          <div className="c end"><button className="lnk" disabled={cancelling === x.id} onClick={() => onCancel(x.id)}>Cancel</button></div>
        </div>
      ),
    });
  }
  Object.entries(groups).forEach(([k, occ]) => {
    const first = occ[0];
    const isOpen = open.has(k);
    entries.push({
      at: first.at.getTime(),
      node: (
        <div key={"g-" + k}>
          <button className="tr up grp-row" onClick={() => toggleOpen(k)} aria-expanded={isOpen}>
            <div className="c main"><span className="ico sm"><Ic n={first.icon} z={20} /></span>
              <div className="info"><div className="name">{first.title} <span className="cnt">{occ.length}</span></div><small>{first.freq} · {first.sub}</small></div>
            </div>
            <div className="c hide"><span className="tag auto">Schedule</span></div>
            <div className="c" suppressHydrationWarning>Next: {dayLabel(first.at, tz, now)}, {time12(first.at, tz)}</div>
            <div className="c end"><span className={"chev" + (isOpen ? " open" : "")}>›</span></div>
          </button>
          {isOpen && occ.map((x: any, i: number) => (
            <div key={i} className="tr up child">
              <div className="c main"><span className="dot" /><div className="info"><div className="name" suppressHydrationWarning>{dayLabel(x.at, tz, now)}</div></div></div>
              <div className="c hide" />
              <div className="c" suppressHydrationWarning>{time12(x.at, tz)}</div>
              <div className="c end"><button className="lnk" onClick={() => setSkip(new Set(skip).add(x.skipKey))}>Skip</button></div>
            </div>
          ))}
        </div>
      ),
    });
  });
  entries.sort((a, b) => a.at - b.at);

  return (
    <>
      <div className="chips">
        {[["today", "Today"], ["tomorrow", "Tomorrow"], ["7", "Next 7 days"], ["14", "Next 14 days"], ["30", "Next 30 days"]].map(([k, l]) => (
          <button key={k} className={"chip" + (uf === k ? " a" : "")} onClick={() => { setUf(k); setUd(""); }}>{l} {items.filter(inRange[k]).length}</button>
        ))}
        <label className={"chip dp" + (uf === "date" ? " a" : "")}>Pick a date
          <input type="date" value={ud} onChange={(e) => { setUd(e.target.value); setUf(e.target.value ? "date" : "7"); }} />
        </label>
      </div>
      <div className="tbl">
        <div className="tr th up"><div className="c">Task</div><div className="c">Given by</div><div className="c">Time</div><div className="c" /></div>
        {entries.length ? entries.map((e) => e.node) : <Empty icon="event" title="Nothing on this day" desc="Pick another day above." />}
      </div>
    </>
  );
}

/* ───────────────────────── Tasks from Mr Lxwa tab ───────────────────────── */
function Tasks({ orders, now, tz, tf, setTf, q, setQ, onCancel, cancelling }: any) {
  if (orders === null) return <div className="box">Loading…</div>;
  const mapStatus = (s: string) => s === "done" ? "Done" : s === "failed" ? "Failed" : s === "cancelled" ? "Cancelled" : s === "running" ? "Running" : "Pending";
  const list = (orders as any[])
    .map((o) => ({ ...o, S: mapStatus(o.status) }))
    .filter((o) => (tf === "all" || o.S === tf) && orderWhat(o).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.S === "Pending" ? 0 : 1) - (b.S === "Pending" ? 0 : 1) || new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
  const n = (s: string) => (orders as any[]).filter((o) => mapStatus(o.status) === s).length;

  return (
    <>
      <Search q={q} setQ={setQ} ph="Search tasks" />
      <div className="chips">
        {[["all", "All", orders.length], ["Pending", "Pending", n("Pending")], ["Done", "Done", n("Done")], ["Failed", "Failed", n("Failed")]].map(([k, l, c]: any) => (
          <button key={k} className={"chip" + (tf === k ? " a" : "")} onClick={() => setTf(k)}>{l} {c}</button>
        ))}
      </div>
      <div className="tbl">
        <div className="tr th tk"><div className="c">Task</div><div className="c hide">Type</div><div className="c">Scheduled for</div><div className="c">Status</div><div className="c" /></div>
        {list.length ? list.map((o) => {
          const at = new Date(o.run_at);
          const cl = o.S === "Done" ? "ok" : o.S === "Failed" ? "bad" : o.S === "Cancelled" ? "mut" : "pend";
          return (
            <div key={o.id} className="tr tk">
              <div className="c main"><span className="ico sm"><Ic n={orderIcon(o)} z={20} /></span><div className="info"><div className="name">{orderWhat(o)}</div><small>Asked in Chat{o.request ? ` · “${o.request}”` : ""}</small></div></div>
              <div className="c hide">{orderType(o)}</div>
              <div className="c" suppressHydrationWarning>{dayLabel(at, tz, now)}, {time12(at, tz)}{o.S === "Pending" ? <small>{at.getTime() > now ? "in " + countdown(at.getTime() - now) : "starting"}</small> : null}</div>
              <div className="c"><span className={"sp " + cl}>{o.S}</span></div>
              <div className="c end">{o.S === "Pending" ? <button className="lnk" disabled={cancelling === o.id} onClick={() => onCancel(o.id)}>Cancel</button> : null}{o.error ? <small className="bad">{o.error}</small> : null}</div>
            </div>
          );
        }) : <Empty icon="robot" title="No tasks found" desc="Try another filter, or ask Mr Lxwa in Chat." />}
      </div>
      <div className="tip"><Ic n="robot" z={22} /><div><b>Need something done later?</b><small>Tell Mr Lxwa in Chat, e.g. “30 min baad ye article publish kar do” or “kal 9 baje isko publish karna”.</small></div></div>
    </>
  );
}

/* ───────────────────────── History tab ───────────────────────── */
function HistoryTab({ runs, error, now, tz, hf, setHf, q, setQ }: any) {
  if (error) return <div className="banner">{error}</div>;
  if (runs === null) return <div className="box">Loading…</div>;
  if (!runs.length) return <Empty icon="history" title="No automatic run yet" desc="As soon as the first run fires you'll see it here — when it ran, what it made, and anything that failed." />;

  const rows = (runs as Run[]).map((r) => {
    const failed = r.status === "failed";
    const result = r.bossError || (failed ? (r.failures[0]?.message ?? "The run failed") : r.reason || `${r.articles.length} article${r.articles.length === 1 ? "" : "s"}${r.articles.some((a) => a.status === "awaiting_approval") ? " sent to Approvals" : ""}`);
    return { r, failed, result, label: "Article run" };
  }).filter((x) => (hf === "all" || (hf === "Completed" ? !x.failed : x.failed)) && (x.label + x.result).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => new Date(b.r.firedAt).getTime() - new Date(a.r.firedAt).getTime());

  const nC = (runs as Run[]).filter((r) => r.status !== "failed").length;
  const nF = (runs as Run[]).filter((r) => r.status === "failed").length;

  return (
    <>
      <Search q={q} setQ={setQ} ph="Search history" />
      <div className="chips">
        {[["all", "All", runs.length], ["Completed", "Completed", nC], ["Failed", "Failed", nF]].map(([k, l, c]: any) => (
          <button key={k} className={"chip" + (hf === k ? " a" : "")} onClick={() => setHf(k)}>{l} {c}</button>
        ))}
      </div>
      <div className="tbl">
        <div className="tr th hs"><div className="c">Run</div><div className="c">Result</div><div className="c">When</div><div className="c">Status</div><div className="c" /></div>
        {rows.length ? rows.map((x) => (
          <div key={x.r.id} className="tr hs">
            <div className="c main"><span className={"ico sm " + (x.failed ? "bad" : "good")}><Ic n={x.failed ? "error" : "check"} z={20} /></span><div className="info"><div className="name">{x.label}</div></div></div>
            <div className={"c" + (x.failed ? " bad" : "")}>{x.result}</div>
            <div className="c" suppressHydrationWarning>{dayLabel(new Date(x.r.firedAt), tz, now)}, {time12(new Date(x.r.firedAt), tz)}</div>
            <div className="c"><span className={"sp " + (x.failed ? "bad" : "ok")}>{x.failed ? "Failed" : x.r.status === "running" ? "Running" : "Completed"}</span></div>
            <div className="c end">{x.r.articles.find((a) => a.publishedUrl) ? <a className="lnk" href={x.r.articles.find((a) => a.publishedUrl)!.publishedUrl!} target="_blank" rel="noreferrer">Open live</a> : null}</div>
          </div>
        )) : <Empty icon="history" title="No runs found" desc="Try another filter or search." />}
      </div>
    </>
  );
}

/* ───────────────────────── small shared bits ───────────────────────── */
function Search({ q, setQ, ph }: { q: string; setQ: (s: string) => void; ph: string }) {
  return <div className="tools"><div className="search"><Ic n="search" z={18} /><input type="search" placeholder={ph} aria-label={ph} value={q} onChange={(e) => setQ(e.target.value)} /></div></div>;
}
function Empty({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return <div className="empty"><Ic n={icon} z={36} /><b>{title}</b><small>{desc}</small></div>;
}
function orderWhat(o: any): string {
  if (o.kind === "brain") return o.label || "Task";
  if (o.kind === "publish") return "Publish an article that is already written";
  if (o.kind === "research") return `Research keywords${o.topic ? ` for “${o.topic}”` : ""}`;
  if (o.kind === "plan") return "Pick this week's topics and write them";
  return `Write an article${o.topic ? ` about “${o.topic}”` : ""}`;
}
function orderType(o: any): string {
  if (o.kind === "publish") return "Delayed publishing";
  if (o.kind === "research") return "Keyword research";
  if (o.kind === "plan") return "Topic planning";
  if (o.kind === "write") return "Article writing";
  return "Task";
}
function orderIcon(o: any): string {
  if (o.kind === "publish") return "publish";
  if (o.kind === "research") return "search";
  if (o.kind === "plan") return "idea";
  if (o.kind === "brain") return "robot";
  return "article";
}

/* ═══════════════════ styles — ported from the reference, scoped to .sched, dark tokens ═══════════════════ */
const CSS = `
.sched{--bg:#f8f9fa;--panel:#fff;--card:#fff;--line:#dadce0;--tx:#202124;--mut:#5f6368;--ac:#1a73e8;--acs:#e8f0fe;--onac:#fff;--ok:#188038;--oks:#e6f4ea;--bad:#d93025;--warn:#b06000;--warns:#fef7e0;--off:#bdc1c6;--bads:#fce8e6;--pu:#8430ce;--pus:#f3e8fd;color-scheme:light;color:var(--tx);background:var(--bg);min-height:100%;width:100%;border-radius:12px;font:15px/1.5 "Google Sans",Roboto,"Segoe UI",Arial,sans-serif}
.sched *{box-sizing:border-box}
.sched .wrap{max-width:none;margin:0;padding:20px 20px 60px}
.sched .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px}
.sched .top{display:flex;align-items:flex-start;gap:12px;margin-bottom:20px}
.sched .top .t{flex:1;min-width:0}
.sched h1{font-size:26px;font-weight:500;margin:0;color:var(--tx)}
.sched .sub{color:var(--mut);font-size:14px;margin:2px 0 0}
.sched .icobtn{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--mut);cursor:pointer;display:grid;place-items:center;flex:none}
.sched .icobtn:hover{color:var(--tx);border-color:var(--off)}
.sched .pill{background:var(--oks);color:var(--ok);padding:7px 14px;border-radius:99px;font-weight:500;font-size:14px;white-space:nowrap;display:flex;align-items:center;gap:8px}
.sched .pill i{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.sched .pill.off{background:var(--bg);color:var(--mut);border:1px solid var(--line)}.sched .pill.off i{background:var(--mut)}
.sched .banner{background:var(--bads);color:var(--bad);border:1px solid var(--bad);border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px}
.sched .banner code{font-family:ui-monospace,monospace;font-size:12px}
.sched .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.sched .st{border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;gap:12px;align-items:center;background:var(--card);min-width:0}
.sched .st>div{min-width:0;flex:1}
.sched .st.a{background:var(--acs);border-color:transparent}.sched .st.b{background:var(--oks);border-color:transparent}.sched .st.c{background:var(--warns);border-color:transparent}
.sched .sbox{color:var(--mut);width:36px;height:36px;border-radius:50%;background:var(--panel);display:grid;place-items:center;flex:none}
.sched .st.a .sbox{color:var(--ac)}.sched .st.b .sbox{color:var(--ok)}.sched .st.c .sbox{color:var(--warn)}
.sched .sv{font-weight:500;font-size:19px;line-height:1.25;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.sched .sl{font-size:12px;color:var(--mut);overflow-wrap:anywhere}
.sched .tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.sched .tab{display:inline-flex;align-items:center;gap:8px;border:0;border-bottom:3px solid transparent;background:none;color:var(--mut);padding:10px 14px;font:inherit;font-weight:500;cursor:pointer;margin-bottom:-1px}
.sched .tab:hover{color:var(--tx)}
.sched .tab.a{color:var(--ac);border-bottom-color:var(--ac)}
.sched .cnt{background:var(--bg);color:var(--mut);border-radius:99px;font-size:12px;padding:0 8px;line-height:20px;min-width:20px;text-align:center}
.sched .cnt.hi,.sched .tab.a .cnt{background:var(--acs);color:var(--ac)}
.sched .list{display:flex;flex-direction:column;gap:10px}
.sched .row{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;cursor:pointer;width:100%;color:inherit;font:inherit;text-align:left}
.sched .row:hover{background:var(--bg);border-color:var(--off)}
.sched .row.dis{opacity:.6;cursor:default}.sched .row.dis:hover{background:var(--card);border-color:var(--line)}
.sched :focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.sched .ico{color:var(--ac);width:44px;height:44px;border-radius:50%;background:var(--acs);display:grid;place-items:center;flex:none}
.sched .ico.sm{width:36px;height:36px}.sched .ico.good{background:var(--oks);color:var(--ok)}.sched .ico.bad{background:var(--bads);color:var(--bad)}
.sched .info{flex:1;min-width:0}.sched .name{font-weight:500;color:var(--tx)}.sched .desc{color:var(--mut);font-size:13px}
.sched .meta{font-size:13px;margin-top:4px;color:var(--ac)}.sched .meta.off{color:var(--mut)}
.sched .info small{color:var(--mut);font-size:12px;display:block;margin-top:2px}
.sched .badge{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--warns);color:var(--warn);white-space:nowrap;font-weight:500}
.sched .chev{color:var(--mut);font-size:22px}
.sched .tg{width:38px;height:20px;border-radius:99px;background:var(--off);border:0;position:relative;cursor:pointer;flex:none;transition:background .15s}
.sched .tg::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:.15s}
.sched .tg.on{background:var(--ac)}.sched .tg.on::after{left:20px}
.sched .tg:disabled{opacity:.5;cursor:not-allowed}
.sched .tip{display:flex;gap:12px;align-items:center;background:var(--acs);border-radius:12px;padding:14px 16px;margin-top:16px;color:var(--ac)}.sched .tip b{color:var(--tx);font-weight:500;display:block}.sched .tip small{color:var(--mut)}
.sched .tools{display:flex;gap:12px;align-items:center;margin-bottom:12px}
.sched .search{position:relative;width:100%;max-width:300px;color:var(--mut)}.sched .search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none}
.sched .search input{padding-left:38px;border-radius:99px}
.sched .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.sched .chip{border:1px solid var(--line);background:none;color:var(--tx);padding:6px 14px;border-radius:99px;font:inherit;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.sched .chip:hover{background:var(--bg)}.sched .chip.a{background:var(--acs);color:var(--ac);border-color:transparent;font-weight:500}
.sched .chip.dp input{width:auto;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;color-scheme:light}
.sched .tbl{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.sched .tr{display:grid;gap:14px;align-items:center;padding:12px 16px;border-top:1px solid var(--line)}
.sched .tr:first-child{border-top:0}
.sched .tr.tk{grid-template-columns:minmax(0,2.4fr) minmax(0,1.2fr) minmax(0,1.3fr) 100px 90px}
.sched .tr.hs{grid-template-columns:minmax(0,1.6fr) minmax(0,2fr) minmax(0,1.3fr) 110px 90px}
.sched .tr.up{grid-template-columns:minmax(0,2.4fr) minmax(0,1fr) minmax(0,1.4fr) 80px}
.sched .tr.th{background:var(--bg);color:var(--mut);font-size:13px;font-weight:500}
.sched .tr .c{min-width:0;font-size:14px;color:var(--tx)}.sched .tr .c small{display:block;color:var(--mut);font-size:12px}.sched .tr .c.bad{color:var(--bad)}
.sched .c.main{display:flex;align-items:center;gap:12px}.sched .c.end{text-align:right}
.sched .grp-row{width:100%;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}
.sched .grp-row:hover{background:var(--bg)}
.sched .chev.open{display:inline-block;transform:rotate(90deg)}
.sched .tr.child{background:var(--bg)}
.sched .tr.child .c.main{padding-left:6px}
.sched .dot{width:7px;height:7px;border-radius:50%;background:var(--off);flex:none;margin:0 20px 0 14px}
.sched .sp{font-size:12px;font-weight:500;padding:3px 10px;border-radius:99px;white-space:nowrap}
.sched .sp.ok{background:var(--oks);color:var(--ok)}.sched .sp.pend{background:var(--warns);color:var(--warn)}.sched .sp.bad{background:var(--bads);color:var(--bad)}.sched .sp.mut{background:var(--bg);color:var(--mut)}
.sched .lnk{background:none;border:0;color:var(--ac);font:inherit;font-size:13px;font-weight:500;cursor:pointer;padding:2px 4px;text-decoration:none}.sched .lnk:hover{text-decoration:underline}.sched .lnk:disabled{opacity:.5;cursor:not-allowed}
.sched .tag{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--bg);border:1px solid var(--line);color:var(--mut);white-space:nowrap}
.sched .tag.auto{background:var(--acs);color:var(--ac);border-color:transparent}.sched .tag.chat{background:var(--pus);color:var(--pu);border-color:transparent}
.sched .empty{text-align:center;padding:36px 10px;color:var(--mut);display:flex;flex-direction:column;align-items:center;gap:6px}.sched .empty b{color:var(--tx);font-weight:500}
.sched .box{background:var(--bg);border-radius:8px;padding:12px 14px;font-size:14px;color:var(--mut)}
.sched input,.sched select{width:100%;background:var(--panel);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;color-scheme:light}
.sched input:hover,.sched select:hover{border-color:var(--off)}
.sched .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px;z-index:60}
.sched .modal{background:var(--panel);border-radius:16px;width:100%;max-width:500px;max-height:90vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:schedpop .15s ease-out}
@keyframes schedpop{from{transform:scale(.97);opacity:0}}
.sched .mh{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line)}
.sched .mh h2{margin:0;font-size:19px;font-weight:500;flex:1;color:var(--tx)}.sched .mh .ico{width:38px;height:38px}
.sched .x{background:none;border:0;color:var(--mut);cursor:pointer;line-height:1;display:grid;place-items:center}.sched .x:hover{color:var(--tx)}
.sched .mb{padding:20px;display:flex;flex-direction:column;gap:16px}
.sched .mf{padding:14px 20px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end}
.sched .l{display:block;font-weight:500;font-size:13px;margin-bottom:6px;color:var(--mut)}
.sched .seg{display:flex;border:1px solid var(--line);border-radius:99px;overflow:hidden}
.sched .seg button{flex:1;border:0;border-right:1px solid var(--line);background:none;color:var(--tx);padding:8px 6px;font:inherit;cursor:pointer}
.sched .seg button:last-child{border-right:0}
.sched .seg button.a{background:var(--acs);color:var(--ac);font-weight:500}
.sched .tzr{display:flex;gap:8px}
.sched .sw{display:flex;align-items:center;gap:12px;justify-content:space-between;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.sched .sw b{color:var(--tx);font-weight:500}
.sched small,.sched .hint{color:var(--mut);font-size:13px;display:block}
.sched small.bad{color:var(--bad)}
.sched .btn{border:1px solid var(--line);background:var(--panel);color:var(--ac);padding:9px 22px;border-radius:99px;font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}
.sched .btn:hover{background:var(--acs)}
.sched .btn.p{background:var(--ac);border-color:var(--ac);color:var(--onac)}.sched .btn.p:hover{opacity:.9}.sched .btn:disabled{opacity:.6;cursor:not-allowed}
.sched .next{background:var(--acs);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--tx)}
@media(max-width:720px){.sched .stats{grid-template-columns:1fr 1fr}.sched .top{flex-wrap:wrap}}
@media(max-width:700px){.sched .tr.th{display:none}.sched .tr.tk,.sched .tr.hs,.sched .tr.up{grid-template-columns:1fr auto}.sched .tr .c.main{grid-column:1/-1}.sched .tr .c.hide{display:none}.sched .tr .c.end{text-align:left}}
@media(max-width:600px){
  .sched .wrap{padding:2px 0 32px}
  .sched .panel{padding:16px;border-radius:12px}
  .sched h1{font-size:22px}
  .sched .sub{font-size:13px}
  .sched .top{gap:8px}
  .sched .pill{order:3;font-size:13px;padding:6px 12px}
  .sched .st{padding:12px;gap:10px}.sched .sv{font-size:17px}
  .sched .sl{white-space:normal;overflow:visible}
  .sched .tabs{flex-wrap:nowrap;overflow-x:auto;gap:2px;-webkit-overflow-scrolling:touch}
  .sched .tab{padding:10px 10px;font-size:14px;white-space:nowrap}
  .sched .row{padding:12px}.sched .ico{width:40px;height:40px}
  .sched .modal{max-width:100%}
  .sched .search{max-width:none}
}
@media(max-width:400px){.sched .stats{grid-template-columns:1fr}}
`;
