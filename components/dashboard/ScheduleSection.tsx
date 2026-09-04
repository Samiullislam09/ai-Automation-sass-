"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronDown, Clock, Globe,
  History, Loader2, Megaphone, Rocket, RotateCw, Send, Timer, TriangleAlert, X, Zap,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { humanTime } from "@/lib/chat-context";

/** /dashboard/schedule — rebuilt 2026-09-05 on the same look as Approvals / Content (owner:
 *  "schedule page ka ui bhi theme se match kare, har schedule ka option ho, user friendly"):
 *  one panel, a header, a real stat strip, and three tabs — Automation (the recurring rule),
 *  Upcoming (one-off orders booked in the chat) and History (past runs).
 *
 *  EVERY option the backend actually supports is on this page now: on/off, frequency
 *  (daily / weekdays / weekly), day of week, time of day, timezone, articles per run (1-5) and
 *  auto-publish — the exact set app/api/schedule/route.ts validates. Nothing beyond that is
 *  offered, because the scheduler (agent-server/src/scheduler.ts) wouldn't honour it.
 *
 *  Logic and API calls are unchanged from the previous version: /api/schedule,
 *  /api/schedule/history, /api/scheduled-orders, /api/integrations, and the rule that the
 *  next-run instant is always computed server-side and only formatted/ticked here.
 */

type Sched = {
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

type Article = {
  id: string;
  title: string;
  status: string;
  words: number | null;
  at: string;
  publishedUrl: string | null;
  publishError: string | null;
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
  articles: Article[];
  failures: { agent: string; task: string; message: string; at: string }[];
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A short list of common IANA zones — the field still accepts anything, this is just the
 *  shortcut. The API validates the name with Intl before it ever reaches the scheduler. */
const TZ_COMMON = [
  "UTC", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Singapore",
  "Asia/Tokyo", "Europe/London", "Europe/Berlin", "Europe/Madrid", "America/New_York",
  "America/Chicago", "America/Los_Angeles", "Australia/Sydney",
];

const DEFAULTS: Sched = {
  enabled: false,
  frequency: "daily",
  dayOfWeek: 1,
  timeOfDay: "09:00",
  timezone: "UTC",
  count: 2,
  autoPublish: false,
  lastRunAt: null,
  nextRunAt: null,
};

const browserTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};

export default function ScheduleSection() {
  const { toast, confirmAction } = useStore();
  const [sched, setSched] = useState<Sched | null>(null);
  const [saved, setSaved] = useState<Sched | null>(null);   // what the server currently holds
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [migration, setMigration] = useState(false);
  const [autoPublishAvailable, setAutoPublishAvailable] = useState(true);
  const [canPublish, setCanPublish] = useState<boolean | null>(null);
  const [publishTarget, setPublishTarget] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const [orders, setOrders] = useState<any[] | null>(null);
  const [cancelling, setCancelling] = useState("");
  const [tab, setTab] = useState<"automation" | "upcoming" | "history">("automation");

  const skewRef = useRef(0);

  const loadSchedule = useCallback(async () => {
    const tz = browserTz();
    try {
      const d = await fetch("/api/schedule", { cache: "no-store" }).then((r) => r.json());
      if (d.serverNow) skewRef.current = Date.parse(d.serverNow) - Date.now();
      if (!d.ok) {
        setError(d.error ?? "Schedule load nahi ho paya.");
        setMigration(!!d.needsMigration);
        setSched({ ...DEFAULTS, timezone: tz });
        setSaved({ ...DEFAULTS, timezone: tz });
        return;
      }
      setError("");
      setMigration(false);
      setAutoPublishAvailable(d.autoPublishAvailable !== false);
      const row = (d.schedules ?? []).find((s: any) => s.kind === "article");
      const next: Sched = row
        ? {
            enabled: row.enabled,
            frequency: row.frequency,
            dayOfWeek: row.day_of_week,
            timeOfDay: row.time_of_day,
            timezone: row.timezone,
            count: row.count,
            autoPublish: row.auto_publish === true,
            lastRunAt: row.last_run_at,
            nextRunAt: row.nextRunAt ?? null,
          }
        : { ...DEFAULTS, timezone: tz };
      setSched(next);
      setSaved(next);
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
      setSched((s) => s ?? { ...DEFAULTS, timezone: tz });
      setSaved((s) => s ?? { ...DEFAULTS, timezone: tz });
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const d = await fetch("/api/schedule/history", { cache: "no-store" }).then((r) => r.json());
      if (!d.ok) { setHistoryError(d.error ?? "Run history load nahi ho payi."); return; }
      setHistoryError("");
      setRuns(d.runs ?? []);
    } catch (e: any) {
      setHistoryError(e?.message ?? "Network error.");
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const d = await fetch("/api/scheduled-orders", { cache: "no-store" }).then((r) => r.json());
      setOrders(d.ok ? [...(d.pending ?? []), ...(d.recent ?? [])] : []);
    } catch {
      setOrders([]);
    }
  }, []);

  const cancel = async (id: string) => {
    const ok = await confirmAction({
      title: "Cancel this order?",
      body: "It will not run. You can book it again in the chat.",
      confirmLabel: "Cancel order",
      danger: true,
    });
    if (!ok) return;
    setCancelling(id);
    try {
      const d = await fetch(`/api/scheduled-orders?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json());
      await loadOrders();
      toast(d.ok ? "Cancel ho gaya — ab ye nahi chalega." : d.error ?? "Cancel nahi ho paya.", d.ok ? "ok" : "error");
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setCancelling("");
    }
  };

  useEffect(() => {
    void loadSchedule();
    void loadHistory();
    void loadOrders();

    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setCanPublish(false); return; }
        const target = (d.items ?? []).find(
          (i: any) => (i.type === "wordpress" || i.type === "webhook") && i.status === "connected"
        );
        setCanPublish(!!target);
        setPublishTarget(target ? (target.type === "wordpress" ? "WordPress" : "Webhook") : null);
      })
      .catch(() => setCanPublish(false));
  }, [loadSchedule, loadHistory, loadOrders]);

  useEffect(() => {
    setNow(Date.now() + skewRef.current);
    const t = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  const anyRunning = !!runs?.some((r) => r.status === "running");
  useEffect(() => {
    const t = setInterval(() => void loadHistory(), anyRunning ? 20_000 : 120_000);
    return () => clearInterval(t);
  }, [anyRunning, loadHistory]);

  useEffect(() => {
    const t = setInterval(() => void loadOrders(), 30_000);
    return () => clearInterval(t);
  }, [loadOrders]);

  const set = (patch: Partial<Sched>) => setSched((s) => (s ? { ...s, ...patch } : s));

  const save = async (override?: Partial<Sched>) => {
    const body = { ...sched, ...override, kind: "article" };
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Save nahi hua."); return; }
      if (override) set(override);
      if (data.autoPublishAvailable === false) setAutoPublishAvailable(false);
      await loadSchedule();
      toast(body.enabled ? "Schedule chalu — team apne aap kaam karegi." : "Schedule band kar diya.");
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
    } finally {
      setSaving(false);
    }
  };

  const pendingOrders = useMemo(() => (orders ?? []).filter((o) => o.status === "pending"), [orders]);

  if (!sched || !saved) {
    return (
      <div className="sc-panel flex items-center justify-center p-10">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <Loader2 size={18} className="sc-spin lx-mut" /><span className="lx-11 lx-mut ml-2">Loading…</span>
      </div>
    );
  }

  const nextAt = sched.nextRunAt ? new Date(sched.nextRunAt) : null;
  const remaining = nextAt && now != null ? nextAt.getTime() - now : null;
  const autoPublishOn = sched.autoPublish && autoPublishAvailable;
  const autoPublishBlocked = !autoPublishAvailable || canPublish === false;
  // Only the form fields matter here — lastRunAt/nextRunAt come from the server.
  const dirty =
    sched.frequency !== saved.frequency || sched.dayOfWeek !== saved.dayOfWeek ||
    sched.timeOfDay !== saved.timeOfDay || sched.timezone !== saved.timezone || sched.count !== saved.count;

  return (
    <div className="sc-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="sc-panel flex min-w-0 flex-1 flex-col">
        {/* ---------- header ---------- */}
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--lx-border)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="sc-h1">Schedule</h1>
              <CalendarClock size={18} style={{ color: "#3b82f6" }} />
            </div>
            <p className="lx-mut mt-0.5" style={{ fontSize: 12 }}>
              Set it once and the team writes on its own — {autoPublishOn ? "straight to your site" : "into Approvals for you to okay"}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="sc-icobtn" onClick={() => { void loadSchedule(); void loadHistory(); void loadOrders(); }} title="Refresh">
              <RotateCw size={15} />
            </button>
            <button
              className={`sc-power ${sched.enabled ? "on" : ""}`}
              disabled={saving}
              onClick={() => save({ enabled: !sched.enabled })}
              title={sched.enabled ? "Turn the schedule off" : "Turn the schedule on"}
            >
              <span className="sc-power-dot" />
              {sched.enabled ? "Schedule is ON" : "Schedule is OFF"}
            </button>
          </div>
        </header>

        <div className="lx-scroll flex-1 overflow-y-auto px-4 pb-4">
          {migration && (
            <div className="sc-alert mt-3">
              <TriangleAlert size={15} style={{ color: "#f87171", flexShrink: 0 }} />
              <div>
                <b className="lx-12">Database migration baaki hai</b>
                <p className="lx-11 lx-mut mt-1">
                  Supabase SQL editor me <code className="lx-mono">supabase/migrations/006_schedules.sql</code> chalao — tab tak yahan kuch save nahi hoga.
                </p>
              </div>
            </div>
          )}

          {/* ---------- stat strip (all real) ---------- */}
          <div className="sc-stats mt-3">
            <Stat
              color="#8b5cf6" Icon={Timer} label="Next automatic run"
              value={!sched.enabled ? "Off" : remaining == null ? "—" : remaining <= 0 ? "now" : countdown(remaining)}
              sub={sched.enabled && nextAt ? humanTime(nextAt, sched.timezone) : "switch it on to schedule"}
            />
            <Stat
              color="#3b82f6" Icon={CalendarDays} label="How often"
              value={sched.frequency === "weekly" ? `Weekly` : sched.frequency === "weekdays" ? "Mon–Fri" : "Daily"}
              sub={`${sched.timeOfDay} · ${sched.frequency === "weekly" ? DAYS[sched.dayOfWeek] : sched.timezone}`}
            />
            <Stat
              color="#f59e0b" Icon={Rocket} label="Articles per run"
              value={String(sched.count)}
              sub={autoPublishOn ? "published automatically" : "sent to Approvals"}
            />
            <Stat
              color={pendingOrders.length ? "#22c55e" : "#8b8ba0"} Icon={AlarmClock} label="One-off orders"
              value={orders === null ? "…" : String(pendingOrders.length)}
              sub={pendingOrders.length ? "booked in the chat" : "nothing booked"}
            />
          </div>

          {/* ---------- tabs ---------- */}
          <div className="sc-tabs mt-3">
            <button className={`sc-tab ${tab === "automation" ? "on" : ""}`} onClick={() => setTab("automation")}>
              <Zap size={13} /> Automation
            </button>
            <button className={`sc-tab ${tab === "upcoming" ? "on" : ""}`} onClick={() => setTab("upcoming")}>
              <AlarmClock size={13} /> Upcoming{pendingOrders.length ? ` (${pendingOrders.length})` : ""}
            </button>
            <button className={`sc-tab ${tab === "history" ? "on" : ""}`} onClick={() => setTab("history")}>
              <History size={13} /> History{runs?.length ? ` (${runs.length})` : ""}
            </button>
          </div>

          {/* ================= AUTOMATION ================= */}
          {tab === "automation" && (
            <div className="mt-3 space-y-3">
              <div className="sc-card">
                <div className="sc-card-h">
                  <Clock size={14} style={{ color: "#a78bfa" }} />
                  <span>When should the team write?</span>
                </div>

                <div className="sc-fields">
                  <Field label="How often">
                    <div className="sc-seg">
                      {(["daily", "weekdays", "weekly"] as const).map((f) => (
                        <button key={f} className={sched.frequency === f ? "on" : ""} onClick={() => set({ frequency: f })}>
                          {f === "daily" ? "Every day" : f === "weekdays" ? "Mon–Fri" : "Weekly"}
                        </button>
                      ))}
                    </div>
                  </Field>

                  {sched.frequency === "weekly" && (
                    <Field label="Which day">
                      <div className="sc-days">
                        {DAY_SHORT.map((d, i) => (
                          <button key={d} className={sched.dayOfWeek === i ? "on" : ""} onClick={() => set({ dayOfWeek: i })} title={DAYS[i]}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </Field>
                  )}

                  <div className="sc-row2">
                    <Field label="Time of day">
                      <input type="time" value={sched.timeOfDay} onChange={(e) => set({ timeOfDay: e.target.value })} className="sc-in" />
                    </Field>
                    <Field label="Articles per run">
                      <div className="sc-seg">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} className={sched.count === n ? "on" : ""} onClick={() => set({ count: n })}>{n}</button>
                        ))}
                      </div>
                    </Field>
                  </div>

                  <Field label="Timezone">
                    <div className="sc-tz">
                      <span className="sc-select">
                        <Globe size={13} className="lx-mut" />
                        <select
                          value={TZ_COMMON.includes(sched.timezone) ? sched.timezone : "__custom"}
                          onChange={(e) => { if (e.target.value !== "__custom") set({ timezone: e.target.value }); }}
                        >
                          {!TZ_COMMON.includes(sched.timezone) && <option value="__custom">{sched.timezone || "Custom…"}</option>}
                          {TZ_COMMON.map((z) => <option key={z} value={z}>{z}</option>)}
                        </select>
                        <ChevronDown size={13} className="lx-mut" />
                      </span>
                      <input
                        value={sched.timezone}
                        onChange={(e) => set({ timezone: e.target.value.trim() })}
                        placeholder="Asia/Dubai"
                        className="sc-in"
                        style={{ flex: 1, minWidth: 130 }}
                      />
                      <button className="sc-btn" onClick={() => set({ timezone: browserTz() })} title="Use this device's timezone">
                        Use mine
                      </button>
                    </div>
                    <p className="sc-hint">Every time on this page is read in this zone — {sched.timezone || "not set"}.</p>
                  </Field>
                </div>

                {error && <p className="lx-11 mt-3" style={{ color: "#f87171" }}>{error}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className="lx-grad sc-save" disabled={saving || !dirty} onClick={() => save()}>
                    {saving ? <Loader2 size={14} className="sc-spin" /> : <Check size={14} />}
                    {saving ? "Saving…" : dirty ? "Save schedule" : "Saved"}
                  </button>
                  {dirty && <span className="lx-11" style={{ color: "#fbbf24" }}>Unsaved changes</span>}
                  {!dirty && sched.enabled && nextAt && (
                    <span className="lx-11 lx-mut">Next: {humanTime(nextAt, sched.timezone)}</span>
                  )}
                </div>
              </div>

              {/* ---------- auto-publish ---------- */}
              <div className="sc-card">
                <div className="sc-card-h">
                  <Send size={14} style={{ color: autoPublishOn ? "#fbbf24" : "#a78bfa" }} />
                  <span>Publish without asking me</span>
                  <button
                    className={`sc-switch ml-auto ${autoPublishOn ? "on" : ""}`}
                    disabled={saving || autoPublishBlocked}
                    aria-label="Toggle auto-publish"
                    onClick={async () => {
                      if (!sched.autoPublish) {
                        const ok = await confirmAction({
                          title: "Publish without review?",
                          body: "Every scheduled article that passes the quality gate will be published to your live site without you seeing it first.",
                          confirmLabel: "Turn on auto-publish",
                          danger: true,
                        });
                        if (!ok) return;
                      }
                      save({ autoPublish: !sched.autoPublish });
                    }}
                  >
                    <i />
                  </button>
                </div>
                <p className="lx-11 lx-mut mt-1">
                  {autoPublishOn
                    ? <b style={{ color: "#fbbf24" }}>On: nothing waits in Approvals — an article goes live as soon as it is written.</b>
                    : "Off: every article waits in Approvals until you approve it."}
                </p>
                <p className="lx-10 lx-mut mt-1.5">
                  The quality gate still runs. If it fails — or publishing errors — the article lands in Approvals with the
                  reason attached. A manual run is never auto-published.
                </p>
                {!autoPublishAvailable && (
                  <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>
                    Ye column abhi database me nahi hai — Supabase SQL editor me{" "}
                    <code className="lx-mono">supabase/migrations/014_schedule_auto_publish.sql</code> chalao.
                  </p>
                )}
                {autoPublishAvailable && canPublish === false && (
                  <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>
                    Nowhere to publish yet — connect WordPress or a webhook in{" "}
                    <Link href="/dashboard/connect" className="sc-link">Connect</Link>.
                  </p>
                )}
                {autoPublishAvailable && canPublish === true && publishTarget && (
                  <p className="lx-10 lx-mut mt-1.5">Goes to: {publishTarget}.</p>
                )}
              </div>

              {/* ---------- the pipeline, plainly ---------- */}
              <div className="sc-card">
                <div className="sc-card-h"><Zap size={14} style={{ color: "#a78bfa" }} /><span>What happens on each run</span></div>
                <div className="sc-flow">
                  {["Mr Lxwa picks the topic", "Mr. Keyword researches", "Mr. Writer writes", "Quality gate", autoPublishOn ? "Published live" : "Waits in Approvals"].map((s, i, a) => (
                    <span key={s} className="sc-step">
                      <b>{i + 1}</b>{s}{i < a.length - 1 && <em>›</em>}
                    </span>
                  ))}
                </div>
              </div>

              {/* ---------- social (honest state) ---------- */}
              <div className="sc-card">
                <div className="sc-card-h">
                  <Megaphone size={14} style={{ color: "#8b8ba0" }} />
                  <span>Social posts</span>
                  <span className="sc-tag ml-auto">Not available yet</span>
                </div>
                <p className="lx-11 lx-mut mt-1">
                  The schedule can hold a social rule, but Miss Social doesn&apos;t post anywhere yet
                  (<code className="lx-mono">agent-server/src/agents/social.ts</code> is still a stub), so switching one on
                  would schedule nothing. Add the relay in <Link href="/dashboard/connect" className="sc-link">Connect</Link> today;
                  the moment the agent is live its own schedule appears here.
                </p>
              </div>

              <p className="lx-10 lx-mut">
                This schedule runs inside agent-server (Railway). If that service is down the schedule doesn&apos;t fire, and
                missed runs are not replayed afterwards — the next scheduled time simply runs.
              </p>
            </div>
          )}

          {/* ================= UPCOMING ================= */}
          {tab === "upcoming" && (
            <div className="mt-3 space-y-2">
              {orders === null && <div className="sc-card lx-11 lx-mut">Loading…</div>}
              {orders?.length === 0 && (
                <div className="sc-empty">
                  <AlarmClock size={20} className="lx-mut" />
                  <b className="lx-12 mt-2">Nothing booked right now</b>
                  <p className="lx-11 lx-mut mt-1">
                    Ask in the chat — <b>&ldquo;30 min baad ek article publish kar do&rdquo;</b> or{" "}
                    <b>&ldquo;kal 9 baje isko publish karna&rdquo;</b> — and it shows up here with a live countdown.
                  </p>
                </div>
              )}
              {orders?.map((o) => {
                const at = new Date(o.run_at).getTime();
                const left = now != null ? at - now : null;
                const isPending = o.status === "pending";
                const what =
                  o.kind === "publish" ? "Publish an article that is already written"
                  : o.kind === "research" ? `Research keywords${o.topic ? ` for "${o.topic}"` : ""}`
                  : o.kind === "plan" ? "Pick this week's topics and write them"
                  : `Write an article${o.topic ? ` about "${o.topic}"` : ""}`;

                return (
                  <div key={o.id} className="sc-order">
                    <div className="min-w-0 flex-1">
                      <div className="lx-12 font-semibold" style={{ overflowWrap: "anywhere" }}>{what}</div>
                      <div className="lx-10 lx-mut mt-0.5" style={{ overflowWrap: "anywhere" }}>
                        {new Intl.DateTimeFormat("en-GB", {
                          timeZone: sched.timezone, weekday: "short", day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit", hourCycle: "h23",
                        }).format(new Date(at))} · {sched.timezone} ·{" "}
                        {o.kind === "research" ? "nothing gets published"
                          : o.auto_publish || o.kind === "publish" ? "goes straight to the site" : "lands in Approvals"}
                      </div>
                      {o.request && <div className="lx-10 lx-mut mt-1 italic opacity-75">&ldquo;{o.request}&rdquo;</div>}
                      {o.error && <div className="lx-11 mt-1" style={{ color: "#f87171" }}>{o.error}</div>}
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      {isPending ? (
                        <>
                          <span className="sc-count">{left == null ? "…" : left > 0 ? countdown(left) : "starting"}</span>
                          <button className="sc-btn danger" disabled={cancelling === o.id} onClick={() => cancel(o.id)}>
                            {cancelling === o.id ? <Loader2 size={13} className="sc-spin" /> : <X size={13} />} Cancel
                          </button>
                        </>
                      ) : (
                        <span className={"lx-pill " + (o.status === "done" ? "green" : o.status === "cancelled" ? "mut" : o.status === "running" ? "blue" : "red")}>
                          {o.status === "done" ? "Done" : o.status === "cancelled" ? "Cancelled" : o.status === "running" ? "Running" : "Failed"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ================= HISTORY ================= */}
          {tab === "history" && (
            <div className="mt-3 space-y-2">
              {historyError && <p className="lx-11" style={{ color: "#f87171" }}>{historyError}</p>}
              {!historyError && runs === null && <div className="sc-card lx-11 lx-mut">Loading…</div>}
              {!historyError && runs?.length === 0 && (
                <div className="sc-empty">
                  <History size={20} className="lx-mut" />
                  <b className="lx-12 mt-2">No automatic run yet</b>
                  <p className="lx-11 lx-mut mt-1">
                    As soon as the first one fires you&apos;ll see the whole account here — when it ran, how many articles it
                    made, which ones, and anything that failed.
                  </p>
                </div>
              )}
              {runs?.map((run) => <RunCard key={run.id} run={run} tz={sched.timezone} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */

function Stat({ color, Icon, label, value, sub }: { color: string; Icon: React.ElementType; label: string; value: string; sub: string }) {
  return (
    <div className="sc-stat" style={{ ["--c" as any]: color }}>
      <span className="sc-stat-ico"><Icon size={16} /></span>
      <div className="min-w-0">
        <div className="sc-stat-n" suppressHydrationWarning>{value}</div>
        <div className="lx-10 lx-mut">{label}</div>
        <div className="sc-stat-sub" title={sub} suppressHydrationWarning>{sub}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="sc-label">{label}</label>
      {children}
    </div>
  );
}

function RunCard({ run, tz }: { run: Run; tz: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sc-run">
      <button className="sc-run-h" onClick={() => setOpen((o) => !o)}>
        <span className={"lx-pill " + RUN_PILL[run.status]}>{RUN_LABEL[run.status]}</span>
        <span className="lx-11 font-semibold" suppressHydrationWarning>{humanTime(new Date(run.firedAt), tz)}</span>
        <span className="lx-10 lx-mut">
          {run.articles.length} article{run.articles.length === 1 ? "" : "s"}
          {run.planned != null ? ` · ${run.planned} topics planned` : ""}
          {run.autoPublish === true ? " · auto-publish" : ""}
        </span>
        <ChevronDown size={14} className={`lx-mut ml-auto sc-chev ${open ? "on" : ""}`} />
      </button>

      {run.bossError && <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>{run.bossError}</p>}
      {!run.bossError && run.reason && <p className="lx-11 lx-mut mt-1.5">{run.reason}</p>}

      {open && (
        <>
          {run.articles.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {run.articles.map((a) => (
                <div key={a.id} className="sc-run-item">
                  <Link href={`/dashboard/content/${a.id}`} className="min-w-0 flex-1">
                    <div className="lx-11 truncate" style={{ color: "#e8e8f2" }}>{a.title}</div>
                    {a.publishError && <div className="lx-10 mt-0.5" style={{ color: "#f87171" }}>Publish failed: {a.publishError}</div>}
                  </Link>
                  <span className="lx-10 lx-mut whitespace-nowrap">{a.words != null ? `${a.words} words` : "—"}</span>
                  {a.publishedUrl && (
                    <a href={a.publishedUrl} target="_blank" rel="noreferrer" className="sc-link lx-10 whitespace-nowrap">open live</a>
                  )}
                  <span className={"lx-pill " + ITEM_PILL(a.status)}>{ITEM_LABEL(a.status)}</span>
                </div>
              ))}
            </div>
          )}
          {run.failures.map((f, i) => (
            <p key={i} className="lx-11 mt-1.5" style={{ color: "#f87171" }}>{f.task} — {f.message}</p>
          ))}
          {run.linkedBy === "time" && run.articles.length > 0 && (
            <p className="lx-10 lx-mut mt-1.5">
              These articles are matched to the run by time (an older run with no run id), so manual work from the same
              window can appear in this list too.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const RUN_LABEL: Record<Run["status"], string> = {
  running: "Running",
  finished: "Finished",
  partial: "Partial",
  failed: "Failed",
};

const RUN_PILL: Record<Run["status"], string> = {
  running: "blue",
  finished: "green",
  partial: "amber",
  failed: "red",
};

function ITEM_LABEL(status: string): string {
  if (status === "published") return "Published";
  if (status === "awaiting_approval") return "In Approvals";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "failed") return "Failed";
  return "Draft";
}

function ITEM_PILL(status: string): string {
  if (status === "published") return "green";
  if (status === "awaiting_approval") return "amber";
  if (status === "failed" || status === "rejected") return "red";
  return "mut";
}

/** "3h 12m 04s" — and days once it is far enough out that seconds stop meaning anything. */
function countdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

/* Same visual language as Approvals / Content: one dark panel, a stat strip, compact cards.
   Injected with dangerouslySetInnerHTML — React escapes ">" inside a <style> text child, which
   turns every child selector into a hydration mismatch. */
const CSS = `
.sc-wrap{display:flex;height:100%;min-height:0;container-type:inline-size;container-name:sc}
.sc-panel{background:#0a0a11;border:1px solid var(--lx-border);border-radius:16px;min-width:0;width:100%}
.sc-h1{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#fff}
.sc-icobtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--lx-border);background:#0d0d16;color:#9a9ab2;cursor:pointer;transition:.15s;flex-shrink:0}
.sc-icobtn:hover{color:#fff;border-color:rgba(139,92,246,.55)}
.sc-power{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:9px;white-space:nowrap;
  background:#0d0d16;border:1px solid var(--lx-border);color:#8b8ba0;font-size:12px;font-weight:600;cursor:pointer;transition:.15s}
.sc-power:hover:not(:disabled){color:#fff}
.sc-power .sc-power-dot{width:7px;height:7px;border-radius:50%;background:#4b4b5c}
.sc-power.on{color:#4ade80;border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.08)}
.sc-power.on .sc-power-dot{background:#22c55e;box-shadow:0 0 8px #22c55e}
.sc-power:disabled{opacity:.5;cursor:not-allowed}
.sc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.sc-stat{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:11px;min-width:0;
  background:color-mix(in srgb,var(--c) 9%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
.sc-stat-ico{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;flex-shrink:0;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,#0b0b12);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
.sc-stat-n{font-size:17px;font-weight:800;line-height:1.15;color:#fff;font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-stat-sub{margin-top:2px;font-size:10px;color:var(--lx-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-tabs{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:2px}
.sc-tab{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px;font-size:12px;font-weight:600;
  background:#0d0d16;border:1px solid var(--lx-border);color:#9a9ab2;cursor:pointer;transition:.15s}
.sc-tab:hover{color:#fff}
.sc-tab.on{color:#fff;background:linear-gradient(135deg,rgba(79,70,229,.55),rgba(124,58,237,.35));border-color:rgba(139,92,246,.6)}
.sc-card{background:#0d0d16;border:1px solid var(--lx-border);border-radius:12px;padding:14px}
.sc-card-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#fff}
.sc-fields{margin-top:12px;display:flex;flex-direction:column;gap:12px}
.sc-row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.sc-label{display:block;margin-bottom:6px;font-size:11px;color:var(--lx-mut)}
.sc-hint{margin-top:6px;font-size:10.5px;color:var(--lx-dim)}
.sc-seg{display:inline-flex;flex-wrap:wrap;gap:4px;padding:3px;border-radius:10px;background:#0a0a11;border:1px solid var(--lx-border)}
.sc-seg button{height:28px;padding:0 12px;border-radius:7px;border:none;background:none;color:#9a9ab2;font-size:12px;
  font-weight:600;cursor:pointer;transition:.15s}
.sc-seg button:hover{color:#fff}
.sc-seg button.on{color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed);box-shadow:0 2px 10px rgba(124,58,237,.3)}
.sc-days{display:flex;flex-wrap:wrap;gap:4px}
.sc-days button{width:44px;height:30px;border-radius:8px;background:#0a0a11;border:1px solid var(--lx-border);
  color:#9a9ab2;font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s}
.sc-days button:hover{color:#fff}
.sc-days button.on{color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-color:rgba(139,92,246,.7)}
.sc-in{height:34px;padding:0 10px;border-radius:9px;background:#0a0a11;border:1px solid var(--lx-border);color:#e8e8f2;
  font-size:12.5px;outline:none}
.sc-in:focus{border-color:rgba(139,92,246,.55)}
.sc-tz{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.sc-select{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 8px 0 10px;border-radius:9px;
  background:#0a0a11;border:1px solid var(--lx-border)}
.sc-select select{appearance:none;-webkit-appearance:none;background:none;border:none;outline:none;color:#e8e8f2;
  font-size:12.5px;cursor:pointer;max-width:150px}
.sc-select select option{background:#12121c;color:#e8e8f2}
.sc-btn{display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 12px;border-radius:9px;white-space:nowrap;
  background:#12121c;border:1px solid var(--lx-border);color:#d6d6e4;font-size:12px;font-weight:600;cursor:pointer;transition:.15s}
.sc-btn:hover:not(:disabled){color:#fff;border-color:rgba(139,92,246,.5)}
.sc-btn:disabled{opacity:.45;cursor:not-allowed}
.sc-btn.danger{color:#f87171;border-color:rgba(239,68,68,.4)}
.sc-btn.danger:hover:not(:disabled){background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.6);color:#fff}
.sc-save{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 16px;border-radius:9px;font-size:12.5px;font-weight:600}
.sc-save:disabled{opacity:.45;cursor:not-allowed;filter:none}
.sc-switch{position:relative;width:42px;height:24px;flex-shrink:0;border-radius:999px;background:#1a1a26;
  border:1px solid var(--lx-border);cursor:pointer;transition:.15s}
.sc-switch i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#6b6b80;transition:.18s}
.sc-switch.on{background:linear-gradient(135deg,#4f46e5,#7c3aed);border-color:rgba(139,92,246,.7)}
.sc-switch.on i{left:21px;background:#fff}
.sc-switch:disabled{opacity:.45;cursor:not-allowed}
.sc-alert{display:flex;gap:10px;padding:12px;border-radius:12px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.35)}
.sc-tag{padding:2px 7px;border-radius:6px;font-size:10px;font-weight:700;color:#8b8ba0;background:rgba(255,255,255,.05);
  border:1px solid var(--lx-border)}
.sc-link{color:#818cf8;text-decoration:none}
.sc-link:hover{text-decoration:underline}
.sc-flow{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.sc-step{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#d6d6e4}
.sc-step b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;
  background:rgba(139,92,246,.18);border:1px solid rgba(139,92,246,.45);color:#c4b5fd;font-size:10px}
.sc-step em{margin-left:6px;color:var(--lx-dim);font-style:normal}
.sc-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:28px 20px;border-radius:12px;
  background:#0d0d16;border:1px dashed var(--lx-border)}
.sc-order{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px;border-radius:12px;background:#0d0d16;
  border:1px solid var(--lx-border)}
.sc-count{font-size:14px;font-weight:800;color:#22d3ee;font-variant-numeric:tabular-nums;white-space:nowrap}
.sc-run{padding:12px;border-radius:12px;background:#0d0d16;border:1px solid var(--lx-border)}
.sc-run-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;background:none;border:none;padding:0;
  color:inherit;cursor:pointer;text-align:left}
.sc-chev{transition:transform .15s}
.sc-chev.on{transform:rotate(180deg)}
.sc-run-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;background:#0a0a11;
  border:1px solid var(--lx-border)}
.sc-run-item a{text-decoration:none}
.sc-spin{animation:scSpin 1s linear infinite}
@keyframes scSpin{to{transform:rotate(360deg)}}
`;
