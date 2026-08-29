"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { humanTime } from "@/lib/chat-context";
import { LxSelect, LxSwitch } from "./ui";

/** /dashboard/schedule — same real logic and API calls as the old app/app/schedule/page.tsx
 *  (kept verbatim: /api/schedule, /api/schedule/history, /api/scheduled-orders, and the rule
 *  that the next-run instant is always computed server-side, never re-derived here), restyled
 *  to the new dashboard's theme per the owner's standing instruction (2026-08-29). Rendered
 *  inside <MrLxwaDashboard> as its `children` — see app/dashboard/schedule/page.tsx. */

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

export default function ScheduleSection() {
  const { toast, confirmAction } = useStore();
  const [sched, setSched] = useState<Sched | null>(null);
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

  const skewRef = useRef(0);

  const loadSchedule = useCallback(async () => {
    const browserTz = (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
    })();

    try {
      const d = await fetch("/api/schedule", { cache: "no-store" }).then((r) => r.json());
      if (d.serverNow) skewRef.current = Date.parse(d.serverNow) - Date.now();
      if (!d.ok) {
        setError(d.error ?? "Schedule load nahi ho paya.");
        setMigration(!!d.needsMigration);
        setSched({ ...DEFAULTS, timezone: browserTz });
        return;
      }
      setError("");
      setMigration(false);
      setAutoPublishAvailable(d.autoPublishAvailable !== false);
      const row = (d.schedules ?? []).find((s: any) => s.kind === "article");
      setSched(
        row
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
          : { ...DEFAULTS, timezone: browserTz }
      );
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
      setSched((s) => s ?? { ...DEFAULTS, timezone: browserTz });
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
  }, [loadSchedule, loadHistory]);

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

  if (!sched) return <p className="lx-11 lx-mut">Loading…</p>;

  const nextAt = sched.nextRunAt ? new Date(sched.nextRunAt) : null;
  const remaining = nextAt && now != null ? nextAt.getTime() - now : null;
  const autoPublishOn = sched.autoPublish && autoPublishAvailable;
  const autoPublishBlocked = !autoPublishAvailable || canPublish === false;
  const cyan = { color: "var(--lx-cyan)" } as const;

  return (
    <div className="space-y-4" style={{ maxWidth: 900 }}>
      <div>
        <h1 className="text-lg font-bold">Schedule</h1>
        <p className="lx-11 lx-mut mt-1">
          Har roz / har hafte team ko apne aap kaam pe laga do. Time tumhare apne timezone ka hai.
          {autoPublishOn
            ? " Auto-publish on hai — article seedha tumhari site pe chala jayega."
            : <> Article ban kar <Link href="/dashboard/approvals" className="underline" style={cyan}>Approvals</Link> me aata hai aur tumhare approve karne ka intezaar karta hai.</>}
        </p>
      </div>

      {migration && (
        <div className="lx-card2 p-4" style={{ borderColor: "var(--lx-red)" }}>
          <b className="lx-12">Database migration baaki hai</b>
          <p className="lx-11 lx-mut mt-1.5">
            Supabase SQL editor me <code className="lx-mono">supabase/migrations/006_schedules.sql</code> chalao — tab tak yahan kuch save nahi hoga.
          </p>
        </div>
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      <div className="lx-card2 p-4">
        <div className="lx-10 lx-mut font-bold uppercase tracking-wide">Agla automatic run</div>
        {!sched.enabled ? (
          <p className="lx-11 lx-mut mt-2">Schedule abhi band hai — kuch apne aap nahi chalega. Neeche switch on karo.</p>
        ) : !nextAt ? (
          <p className="lx-11 lx-mut mt-2">
            Server agla time nikal nahi paya — timezone <code className="lx-mono">{sched.timezone}</code> check karo.
          </p>
        ) : (
          <>
            <div className="mt-2 font-extrabold tabular-nums" style={{ fontSize: "clamp(26px,8vw,38px)", letterSpacing: "-.02em", lineHeight: 1.1 }} suppressHydrationWarning>
              {remaining == null ? "—" : remaining <= 0 ? "abhi chal raha hoga…" : countdown(remaining)}
            </div>
            <div className="lx-11 mt-1.5" suppressHydrationWarning>{humanTime(nextAt, sched.timezone)}</div>
            <p className="lx-10 lx-mut mt-2">
              {sched.count} article {sched.frequency === "weekly" ? `har ${DAYS[sched.dayOfWeek]}` : sched.frequency === "weekdays" ? "har weekday" : "har roz"} ·{" "}
              {autoPublishOn ? "seedha publish" : "Approvals me"}
              {sched.lastRunAt ? <> · pichhla run {humanTime(new Date(sched.lastRunAt), sched.timezone)}</> : " · abhi tak ek baar bhi nahi chala"}
            </p>
          </>
        )}
      </div>

      {/* ── Most recent run ───────────────────────────────────────────────── */}
      {runs && runs.length > 0 && <CurrentRun run={runs[0]} tz={sched.timezone} />}

      {/* ── Settings ──────────────────────────────────────────────────────── */}
      <div className="lx-card2 p-4">
        <div className="flex items-start gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="lx-12 font-bold">Automatic articles</div>
            <p className="lx-11 lx-mut mt-1">
              Mr Lxwa topic chunta hai → Mr. Keyword research karta hai → Mr. Writer likhta hai → quality gate →{" "}
              {autoPublishOn ? "tumhari site" : "Approvals"}.
            </p>
          </div>
          <LxSwitch on={sched.enabled} disabled={saving} onClick={() => save({ enabled: !sched.enabled })} label="Toggle schedule" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="lx-10 lx-mut mb-1 block">Kitni baar</label>
            <LxSelect value={sched.frequency} onChange={(e) => set({ frequency: e.target.value as Sched["frequency"] })}>
              <option value="daily">Har roz</option>
              <option value="weekdays">Sirf weekdays (Mon–Fri)</option>
              <option value="weekly">Hafte me ek baar</option>
            </LxSelect>
          </div>

          {sched.frequency === "weekly" && (
            <div>
              <label className="lx-10 lx-mut mb-1 block">Kis din</label>
              <LxSelect value={sched.dayOfWeek} onChange={(e) => set({ dayOfWeek: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </LxSelect>
            </div>
          )}

          <div>
            <label className="lx-10 lx-mut mb-1 block">Kitne baje</label>
            <input
              type="time"
              value={sched.timeOfDay}
              onChange={(e) => set({ timeOfDay: e.target.value })}
              className="lx-12 w-full rounded-lg px-3 py-2"
              style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
            />
          </div>

          <div>
            <label className="lx-10 lx-mut mb-1 block">Timezone</label>
            <input
              value={sched.timezone}
              onChange={(e) => set({ timezone: e.target.value.trim() })}
              placeholder="Asia/Dubai"
              className="lx-12 w-full rounded-lg px-3 py-2"
              style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
            />
          </div>

          <div>
            <label className="lx-10 lx-mut mb-1 block">Har run me kitne article</label>
            <LxSelect value={sched.count} onChange={(e) => set({ count: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </LxSelect>
          </div>
        </div>

        {/* ── Auto-publish ──────────────────────────────────────────────── */}
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--lx-border)" }}>
          <div className="flex items-start gap-3.5">
            <div className="min-w-0 flex-1">
              <div className="lx-12 font-bold">Scheduled articles publish straight to my site (no review)</div>
              <p className="lx-11 lx-mut mt-1">
                {autoPublishOn
                  ? <b style={{ color: "#fbbf24" }}>On hai: Approvals me kuch nahi rukega — article bante hi live ho jayega.</b>
                  : "Off hai: har article Approvals me rukega aur tumhare approve karne ka intezaar karega."}
              </p>
              <p className="lx-10 lx-mut mt-1">
                Quality gate phir bhi lagta hai. Gate fail hua — ya publish karte waqt error aaya — to article Approvals
                me chala jayega aur wajah wahan likhi hogi. Manual run isse nahi badalta.
              </p>
              {!autoPublishAvailable && (
                <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>
                  Ye column abhi database me nahi hai — Supabase SQL editor me{" "}
                  <code className="lx-mono">supabase/migrations/014_schedule_auto_publish.sql</code> chalao.
                </p>
              )}
              {autoPublishAvailable && canPublish === false && (
                <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>
                  Publish karne ki jagah hi nahi hai — pehle <Link href="/dashboard/connect" className="underline" style={cyan}>Connect</Link> me
                  WordPress ya webhook jodo.
                </p>
              )}
              {autoPublishAvailable && canPublish === true && publishTarget && (
                <p className="lx-10 lx-mut mt-1.5">Jayega: {publishTarget}.</p>
              )}
            </div>
            <LxSwitch
              on={autoPublishOn}
              disabled={saving || autoPublishBlocked}
              label="Toggle auto-publish"
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
            />
          </div>
        </div>

        {error && <p className="lx-11 mt-3" style={{ color: "#f87171" }}>{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button className="lx-grad lx-11 px-3.5 py-2" disabled={saving} onClick={() => save()}>
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </div>

      {/* ── One-off orders booked in the chat ─────────────────────────────── */}
      <div className="lx-card2 p-4">
        <div className="lx-10 lx-mut mb-2.5 font-bold uppercase tracking-wide">Chat me jo aapne bola</div>

        {orders === null && <p className="lx-11 lx-mut">Loading…</p>}
        {orders?.length === 0 && (
          <p className="lx-11 lx-mut">
            Abhi kuch book nahi hai. Chat me bolo — <b>&ldquo;30 min baad ek article publish kar do&rdquo;</b> ya{" "}
            <b>&ldquo;kal 9 baje isko publish karna&rdquo;</b> — aur wo yahan countdown ke saath dikhega.
          </p>
        )}

        {orders?.map((o, i) => {
          const at = new Date(o.run_at).getTime();
          const left = now != null ? at - now : null;
          const pending = o.status === "pending";
          const what =
            o.kind === "publish" ? "Publish an article that is already written"
            : o.kind === "research" ? `Research keywords${o.topic ? ` for "${o.topic}"` : ""}`
            : o.kind === "plan" ? "Pick this week's topics and write them"
            : `Write an article${o.topic ? ` about "${o.topic}"` : ""}`;

          return (
            <div
              key={o.id}
              className="flex flex-wrap items-start gap-2.5 py-2.5"
              style={i > 0 ? { borderTop: "1px solid var(--lx-border)" } : undefined}
            >
              <div className="min-w-0 flex-1 basis-64">
                <div className="lx-12 font-bold" style={{ overflowWrap: "anywhere" }}>{what}</div>
                <div className="lx-11 lx-mut mt-0.5" style={{ overflowWrap: "anywhere" }}>
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: sched.timezone, weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
                  }).format(new Date(at))} · {sched.timezone}
                  {" · "}
                  {o.kind === "research" ? "kuch publish nahi hoga"
                    : o.auto_publish || o.kind === "publish" ? "seedha site pe jayega" : "Approvals me aayega"}
                </div>
                {o.request && <div className="lx-11 lx-mut mt-1 italic opacity-75">&ldquo;{o.request}&rdquo;</div>}
                {o.error && <div className="lx-11 mt-1" style={{ color: "#f87171" }}>{o.error}</div>}
              </div>

              <div className="ml-auto flex flex-none items-center gap-2.5 sm:ml-auto">
                {pending ? (
                  <>
                    <div className="tabular-nums font-extrabold" style={{ fontSize: 15, color: "var(--lx-cyan)" }}>
                      {left == null ? "…" : left > 0 ? countdown(left) : "ab chalega"}
                    </div>
                    <button className="lx-ghost" disabled={cancelling === o.id} onClick={() => cancel(o.id)}>
                      {cancelling === o.id ? "…" : "Cancel"}
                    </button>
                  </>
                ) : (
                  <span className={"lx-pill " + (o.status === "done" ? "green" : o.status === "cancelled" ? "mut" : "red")}>
                    {o.status === "done" ? "Ho gaya" : o.status === "cancelled" ? "Cancel kiya" : o.status === "running" ? "Chal raha hai" : "Fail hua"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Run history ────────────────────────────────────────────────────── */}
      <div className="lx-card2 p-4">
        <div className="lx-10 lx-mut mb-2.5 font-bold uppercase tracking-wide">Pichhle automatic run</div>

        {historyError && <p className="lx-11" style={{ color: "#f87171" }}>{historyError}</p>}
        {!historyError && runs === null && <p className="lx-11 lx-mut">Loading…</p>}
        {!historyError && runs?.length === 0 && (
          <p className="lx-11 lx-mut">
            Abhi tak koi automatic run nahi hua. Jaise hi pehla run chalega, uska poora hisaab yahan aa jayega —
            kab chala, kitne article bane, kaunse, aur kuch fail hua ya nahi.
          </p>
        )}

        {runs?.map((run, i) => <RunCard key={run.id} run={run} tz={sched.timezone} first={i === 0} />)}
      </div>

      <div className="lx-card2 p-4">
        <div className="lx-12 font-bold">Social posts</div>
        <p className="lx-11 lx-mut mt-1">
          Isko schedule karne ka koi matlab nahi jab tak Social agent post karna shuru na kare — wo abhi stub hai
          (<code className="lx-mono">agent-server/src/agents/social.ts</code>). Relay endpoint aaj hi{" "}
          <Link href="/dashboard/connect" className="underline" style={cyan}>Connect</Link> me jod sakte ho; jaise hi agent live hoga,
          yahan uska apna schedule aa jayega.
        </p>
      </div>

      <p className="lx-10 lx-mut">
        Ye schedule agent-server (Railway) me chalta hai. Agar wo service band hai to schedule bhi nahi chalega —
        deploy ke baad chhoote hue run dobara nahi hote, agla scheduled time hi chalega.
      </p>
    </div>
  );
}

/** The run that is happening (or just happened) — the answer to "abhi kya ho raha hai". */
function CurrentRun({ run, tz }: { run: Run; tz: string }) {
  const titles = run.articles.map((a) => a.title);
  return (
    <div className="lx-card2 p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="lx-10 lx-mut font-bold uppercase tracking-wide">
          {run.status === "running" ? "Abhi chal raha hai" : "Pichhla run"}
        </span>
        <span className={"lx-pill " + RUN_PILL[run.status]}>{RUN_LABEL[run.status]}</span>
      </div>
      <p className="lx-11 mt-2" suppressHydrationWarning>{humanTime(new Date(run.firedAt), tz)}</p>
      <p className="lx-11 lx-mut mt-1.5">
        {run.bossError
          ? run.bossError
          : run.status === "running"
            ? `${run.topics.length || run.planned || 0} topic plan ho chuke hain, article ban rahe hain.`
            : titles.length
              ? `${titles.length} article: ${titles.join(", ")}`
              : run.reason ?? "Is run se koi article nahi bana."}
      </p>
      {run.failures.length > 0 && (
        <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>
          {run.failures.length} kaam fail hua: {run.failures[0].message}
        </p>
      )}
    </div>
  );
}

function RunCard({ run, tz, first }: { run: Run; tz: string; first: boolean }) {
  return (
    <div className="py-3" style={first ? undefined : { borderTop: "1px solid var(--lx-border)" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="lx-11 font-semibold" suppressHydrationWarning>{humanTime(new Date(run.firedAt), tz)}</span>
        <span className={"lx-pill " + RUN_PILL[run.status]}>{RUN_LABEL[run.status]}</span>
        <span className="lx-10 lx-mut">
          {run.articles.length} article{run.articles.length === 1 ? "" : "s"}
          {run.planned != null ? ` · ${run.planned} topic plan hue` : ""}
          {run.autoPublish === true ? " · auto-publish" : ""}
        </span>
      </div>

      {run.bossError && <p className="lx-11 mt-1.5" style={{ color: "#f87171" }}>{run.bossError}</p>}
      {!run.bossError && run.reason && <p className="lx-11 lx-mut mt-1.5">{run.reason}</p>}

      {run.articles.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 340 }}>
            <tbody>
              {run.articles.map((a, i) => (
                <tr key={a.id} style={i > 0 ? { borderTop: "1px solid var(--lx-border)" } : undefined}>
                  <td className="py-1.5 pr-2.5 align-top lx-11" style={{ minWidth: 150 }}>
                    {a.title}
                    {a.publishedUrl && (
                      <>
                        {" "}
                        <a href={a.publishedUrl} target="_blank" rel="noreferrer" className="underline lx-10" style={{ color: "var(--lx-cyan)" }}>
                          site pe dekho
                        </a>
                      </>
                    )}
                    {a.publishError && <span className="block lx-10 mt-0.5" style={{ color: "#f87171" }}>Publish fail: {a.publishError}</span>}
                  </td>
                  <td className="lx-10 lx-mut py-1.5 pr-2.5 align-top whitespace-nowrap">{a.words != null ? `${a.words} words` : "—"}</td>
                  <td className="py-1.5 text-right align-top whitespace-nowrap">
                    <span className={"lx-pill " + ITEM_PILL(a.status)}>{ITEM_LABEL(a.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run.failures.map((f, i) => (
        <p key={i} className="lx-11 mt-1.5" style={{ color: "#f87171" }}>
          {f.task} — {f.message}
        </p>
      ))}

      {run.linkedBy === "time" && run.articles.length > 0 && (
        <p className="lx-10 lx-mut mt-1.5">
          Ye article run ke time se jode gaye hain (purana run — uske paas run id nahi thi), isliye is window ka
          manual kaam bhi is list me aa sakta hai.
        </p>
      )}
    </div>
  );
}

const RUN_LABEL: Record<Run["status"], string> = {
  running: "Chal raha hai",
  finished: "Ho gaya",
  partial: "Aadha hua",
  failed: "Fail",
};

const RUN_PILL: Record<Run["status"], string> = {
  running: "blue",
  finished: "green",
  partial: "amber",
  failed: "red",
};

function ITEM_LABEL(status: string): string {
  if (status === "published") return "Publish ho gaya";
  if (status === "awaiting_approval") return "Approvals me";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Reject";
  if (status === "failed") return "Fail";
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
