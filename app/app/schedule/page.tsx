"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { humanTime } from "@/lib/chat-context";

/** /app/schedule — "har roz X baje apne aap kaam ho jaye".
 *
 *  This is the first thing in the product that runs without a human pressing anything.
 *  The row saved here is read once a minute by agent-server/src/scheduler.ts, which starts
 *  the same chain the "Run the team" button starts: boss -> keyword -> writer -> quality
 *  gate -> Approvals.
 *
 *  Since migration 014 it can also skip Approvals: `auto_publish` says the customer approved
 *  this run in advance, so a draft that clears the quality gate goes straight to their site.
 *  A publish that fails still lands in Approvals with the error attached — see
 *  agent-server/src/agents/writer.ts.
 *
 *  THE NEXT-RUN TIME IS NOT CALCULATED HERE. This page used to carry its own copy of the
 *  timezone walk, next to the one in the scheduler that actually fires — two implementations
 *  of the same calculation are two answers waiting to disagree. GET /api/schedule now returns
 *  `nextRunAt` as an ISO instant, computed by nextRunAt() in lib/chat-context.ts (the same
 *  function Mr Lxwa reads in chat). All this page does is format it and count down. */

type Sched = {
  enabled: boolean;
  frequency: "daily" | "weekdays" | "weekly";
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  count: number;
  autoPublish: boolean;
  lastRunAt: string | null;
  /** ISO instant from the server, or null when the schedule is off. */
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

export default function Schedule() {
  const { toast } = useStore();
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
  // One-off orders booked in the chat — "30 min baad ek article publish kar do". They belong
  // on this page and not only in the conversation: a booking you can only find by scrolling
  // back through a chat is barely more checkable than the fabricated confirmation it replaced.
  const [orders, setOrders] = useState<any[] | null>(null);
  const [cancelling, setCancelling] = useState("");

  // The browser's clock can be minutes off the server's. Every instant on this page comes
  // from the server, so the countdown is measured against the server's idea of "now" —
  // otherwise a skewed laptop shows a countdown that never reaches zero, or one that sits at
  // zero for ten minutes.
  const skewRef = useRef(0);

  const loadSchedule = useCallback(async () => {
    // The browser knows the customer's timezone; the server never does. Used only as the
    // default for a brand-new schedule — a saved one keeps whatever they chose.
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
      // An empty list on failure, never a stale one. This list is the answer to "is my article
      // still going to be published?", and showing yesterday's answer to that is worse than
      // showing none.
      setOrders(d.ok ? [...(d.pending ?? []), ...(d.recent ?? [])] : []);
    } catch {
      setOrders([]);
    }
  }, []);

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      const d = await fetch(`/api/scheduled-orders?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json());
      // Re-read either way. On success it proves the row really says cancelled; on failure it
      // shows why — usually because the scheduler already picked it up.
      await loadOrders();
      toast(d.ok ? "Cancel ho gaya — ab ye nahi chalega." : d.error ?? "Cancel nahi ho paya.");
    } catch (e: any) {
      toast(e?.message ?? "Network error.");
    } finally {
      setCancelling("");
    }
  };

  useEffect(() => {
    void loadSchedule();
    void loadHistory();
    void loadOrders();

    // Publishing needs somewhere to publish TO. Without a connected WordPress or webhook the
    // auto-publish switch is a promise nothing can keep, so it is disabled and says why.
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

  // Started after mount only — new Date() during render prints one answer on the server and
  // another in the browser, which is exactly the hydration error class this app already had
  // to hunt down once.
  useEffect(() => {
    setNow(Date.now() + skewRef.current);
    const t = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  // A run in flight changes state within a minute or two; a finished one does not. Poll
  // accordingly rather than hammering the database for a page nobody is acting on.
  const anyRunning = !!runs?.some((r) => r.status === "running");
  useEffect(() => {
    const t = setInterval(() => void loadHistory(), anyRunning ? 20_000 : 120_000);
    return () => clearInterval(t);
  }, [anyRunning, loadHistory]);

  // A booked order can fire at any minute, and when it does this list has to stop saying it is
  // pending. Faster than the run history above because the countdown here is often measured in
  // minutes, not hours.
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
      // Re-read rather than guess: the next-run instant is the server's to compute, and it
      // has just changed for every field on this form.
      await loadSchedule();
      toast(body.enabled ? "Schedule chalu — team apne aap kaam karegi." : "Schedule band kar diya.");
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
    } finally {
      setSaving(false);
    }
  };

  if (!sched) return <p className="sm mut">Loading…</p>;

  const nextAt = sched.nextRunAt ? new Date(sched.nextRunAt) : null;
  const remaining = nextAt && now != null ? nextAt.getTime() - now : null;
  const autoPublishOn = sched.autoPublish && autoPublishAvailable;
  const autoPublishBlocked = !autoPublishAvailable || canPublish === false;

  return (
    <>
      <h1 style={{ fontSize: 21, margin: "0 0 6px" }}>Schedule</h1>
      <p className="sm mut" style={{ marginBottom: 20, maxWidth: 720 }}>
        Har roz / har hafte team ko apne aap kaam pe laga do. Time tumhare apne timezone ka hai.
        {autoPublishOn
          ? " Auto-publish on hai — article seedha tumhari site pe chala jayega."
          : <> Article ban kar <Link href="/app/approvals" className="acc">Approvals</Link> me aata hai aur tumhare approve karne ka intezaar karta hai.</>}
      </p>

      {migration && (
        <div className="card warn" style={{ marginBottom: 16 }}>
          <b style={{ fontSize: 13 }}>Database migration baaki hai</b>
          <p className="sm mut" style={{ margin: "6px 0 0" }}>
            Supabase SQL editor me <code>supabase/migrations/006_schedules.sql</code> chalao — tab tak yahan kuch save nahi hoga.
          </p>
        </div>
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: "18px 18px 16px", maxWidth: 720 }}>
        <div className="lbl">Agla automatic run</div>
        {!sched.enabled ? (
          <p className="sm mut" style={{ margin: "8px 0 0" }}>
            Schedule abhi band hai — kuch apne aap nahi chalega. Neeche switch on karo.
          </p>
        ) : !nextAt ? (
          <p className="sm mut" style={{ margin: "8px 0 0" }}>
            Server agla time nikal nahi paya — timezone <code>{sched.timezone}</code> check karo.
          </p>
        ) : (
          <>
            <div className="cd" suppressHydrationWarning>
              {remaining == null ? "—" : remaining <= 0 ? "abhi chal raha hoga…" : countdown(remaining)}
            </div>
            <div className="sm" style={{ marginTop: 6 }} suppressHydrationWarning>
              {humanTime(nextAt, sched.timezone)}
            </div>
            <p className="sm mut" style={{ margin: "8px 0 0", fontSize: 11 }}>
              {sched.count} article {sched.frequency === "weekly" ? `har ${DAYS[sched.dayOfWeek]}` : sched.frequency === "weekdays" ? "har weekday" : "har roz"} ·{" "}
              {autoPublishOn ? "seedha publish" : "Approvals me"}
              {sched.lastRunAt ? <> · pichhla run {humanTime(new Date(sched.lastRunAt), sched.timezone)}</> : " · abhi tak ek baar bhi nahi chala"}
            </p>
          </>
        )}
      </div>

      {/* ── Most recent run ───────────────────────────────────────────────────────────── */}
      {runs && runs.length > 0 && <CurrentRun run={runs[0]} tz={sched.timezone} />}

      {/* ── Settings ──────────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: "17px 18px", maxWidth: 720, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Automatic articles</div>
            <p className="sm mut" style={{ margin: "4px 0 0" }}>
              Mr Lxwa topic chunta hai → Mr. Keyword research karta hai → Mr. Writer likhta hai → quality gate →{" "}
              {autoPublishOn ? "tumhari site" : "Approvals"}.
            </p>
          </div>
          <button
            className={"sw" + (sched.enabled ? " on" : "")}
            disabled={saving}
            onClick={() => save({ enabled: !sched.enabled })}
            aria-label="Toggle schedule"
          >
            <i />
          </button>
        </div>

        <div className="grid2">
          <div className="field">
            <label>Kitni baar</label>
            <select value={sched.frequency} onChange={(e) => set({ frequency: e.target.value as Sched["frequency"] })}>
              <option value="daily">Har roz</option>
              <option value="weekdays">Sirf weekdays (Mon–Fri)</option>
              <option value="weekly">Hafte me ek baar</option>
            </select>
          </div>

          {sched.frequency === "weekly" && (
            <div className="field">
              <label>Kis din</label>
              <select value={sched.dayOfWeek} onChange={(e) => set({ dayOfWeek: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
          )}

          <div className="field">
            <label>Kitne baje</label>
            <input type="time" value={sched.timeOfDay} onChange={(e) => set({ timeOfDay: e.target.value })} />
          </div>

          <div className="field">
            <label>Timezone</label>
            <input value={sched.timezone} onChange={(e) => set({ timezone: e.target.value.trim() })} placeholder="Asia/Dubai" />
          </div>

          <div className="field">
            <label>Har run me kitne article</label>
            <select value={sched.count} onChange={(e) => set({ count: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* ── Auto-publish ────────────────────────────────────────────────────────────── */}
        <div className="ap">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                Scheduled articles publish straight to my site (no review)
              </div>
              <p className="sm mut" style={{ margin: "5px 0 0" }}>
                {autoPublishOn
                  ? <b style={{ color: "var(--amb)" }}>On hai: Approvals me kuch nahi rukega — article bante hi live ho jayega.</b>
                  : "Off hai: har article Approvals me rukega aur tumhare approve karne ka intezaar karega."}
              </p>
              <p className="sm mut" style={{ margin: "5px 0 0", fontSize: 11 }}>
                Quality gate phir bhi lagta hai. Gate fail hua — ya publish karte waqt error aaya — to article Approvals
                me chala jayega aur wajah wahan likhi hogi. Manual run isse nahi badalta.
              </p>
              {!autoPublishAvailable && (
                <p className="sm" style={{ margin: "7px 0 0", color: "var(--red)" }}>
                  Ye column abhi database me nahi hai — Supabase SQL editor me{" "}
                  <code>supabase/migrations/014_schedule_auto_publish.sql</code> chalao.
                </p>
              )}
              {autoPublishAvailable && canPublish === false && (
                <p className="sm" style={{ margin: "7px 0 0", color: "var(--red)" }}>
                  Publish karne ki jagah hi nahi hai — pehle <Link href="/app/connect" className="acc">Connect</Link> me
                  WordPress ya webhook jodo.
                </p>
              )}
              {autoPublishAvailable && canPublish === true && publishTarget && (
                <p className="sm mut" style={{ margin: "7px 0 0", fontSize: 11 }}>Jayega: {publishTarget}.</p>
              )}
            </div>
            <button
              className={"sw" + (autoPublishOn ? " on" : "")}
              disabled={saving || autoPublishBlocked}
              onClick={() => save({ autoPublish: !sched.autoPublish })}
              aria-label="Toggle auto-publish"
            >
              <i />
            </button>
          </div>
        </div>

        {error && <p className="sm" style={{ color: "var(--red)", margin: "4px 0 10px" }}>{error}</p>}

        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <button className="btn btn-p" disabled={saving} onClick={() => save()}>
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </div>

      {/* ── One-off orders booked in the chat ─────────────────────────────────────────────
          The recurring schedule above is a timetable. This is everything the customer asked
          for once, by name, in the conversation — and until it existed, "30 min baad publish
          kar do" had nowhere to go and got answered with a confirmation that referred to no
          row at all. Every line here is a row, and every one of them can be called off. */}
      <div className="card" style={{ padding: "17px 18px", maxWidth: 720, marginTop: 14 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>Chat me jo aapne bola</div>

        {orders === null && <p className="sm mut" style={{ margin: 0 }}>Loading…</p>}
        {orders?.length === 0 && (
          <p className="sm mut" style={{ margin: 0 }}>
            Abhi kuch book nahi hai. Chat me bolo — <b>“30 min baad ek article publish kar do”</b> ya{" "}
            <b>“kal 9 baje isko publish karna”</b> — aur wo yahan countdown ke saath dikhega.
          </p>
        )}

        {orders?.map((o) => {
          const at = new Date(o.run_at).getTime();
          const left = now != null ? at - now : null;
          const pending = o.status === "pending";
          const what =
            o.kind === "publish" ? "Publish an article that is already written"
            : o.kind === "research" ? `Research keywords${o.topic ? ` for “${o.topic}”` : ""}`
            : o.kind === "plan" ? "Pick this week's topics and write them"
            : `Write an article${o.topic ? ` about “${o.topic}”` : ""}`;

          return (
            <div key={o.id} className="ord">
              <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflowWrap: "anywhere" }}>{what}</div>
                <div className="sm mut" style={{ marginTop: 3, overflowWrap: "anywhere" }}>
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: sched.timezone, weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
                  }).format(new Date(at))} · {sched.timezone}
                  {" · "}
                  {o.kind === "research" ? "kuch publish nahi hoga"
                    : o.auto_publish || o.kind === "publish" ? "seedha site pe jayega" : "Approvals me aayega"}
                </div>
                {/* The customer's own sentence. Kept so they can see WHY a row exists — the
                    row is what fires, but the sentence is what they remember typing. */}
                {o.request && <div className="sm mut ord-q">“{o.request}”</div>}
                {o.error && <div className="sm ord-e">{o.error}</div>}
              </div>

              <div className="ord-r">
                {pending ? (
                  <>
                    {/* Same formatter as the big countdown above, so the two clocks on this
                        page never disagree about what "2h 05m" means. */}
                    <div className="ord-t">{left == null ? "…" : left > 0 ? countdown(left) : "ab chalega"}</div>
                    <button className="btn btn-g btn-sm" disabled={cancelling === o.id} onClick={() => cancel(o.id)}>
                      {cancelling === o.id ? "…" : "Cancel"}
                    </button>
                  </>
                ) : (
                  <div className={"ord-b " + (o.status === "done" ? "is-ok" : o.status === "cancelled" ? "is-off" : "is-bad")}>
                    {o.status === "done" ? "Ho gaya" : o.status === "cancelled" ? "Cancel kiya" : o.status === "running" ? "Chal raha hai" : "Fail hua"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Run history ───────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: "17px 18px", maxWidth: 720, marginTop: 14 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>Pichhle automatic run</div>

        {historyError && <p className="sm" style={{ color: "var(--red)", margin: 0 }}>{historyError}</p>}
        {!historyError && runs === null && <p className="sm mut" style={{ margin: 0 }}>Loading…</p>}
        {!historyError && runs?.length === 0 && (
          <p className="sm mut" style={{ margin: 0 }}>
            Abhi tak koi automatic run nahi hua. Jaise hi pehla run chalega, uska poora hisaab yahan aa jayega —
            kab chala, kitne article bane, kaunse, aur kuch fail hua ya nahi.
          </p>
        )}

        {runs?.map((run) => <RunCard key={run.id} run={run} tz={sched.timezone} />)}
      </div>

      <div className="card" style={{ padding: "15px 17px", maxWidth: 720, marginTop: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>Social posts</div>
        <p className="sm mut" style={{ margin: 0 }}>
          Isko schedule karne ka koi matlab nahi jab tak Social agent post karna shuru na kare — wo abhi stub hai
          (<code>agent-server/src/agents/social.ts</code>). Relay endpoint aaj hi{" "}
          <Link href="/app/connect" className="acc">Connect</Link> me jod sakte ho; jaise hi agent live hoga,
          yahan uska apna schedule aa jayega.
        </p>
      </div>

      <p className="sm mut" style={{ marginTop: 16, maxWidth: 720, fontSize: 11 }}>
        Ye schedule agent-server (Railway) me chalta hai. Agar wo service band hai to schedule bhi nahi chalega —
        deploy ke baad chhoote hue run dobara nahi hote, agla scheduled time hi chalega.
      </p>

      <style jsx>{`
        .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0 14px; }
        .lbl { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--mut); }
        .cd { font-size: clamp(26px, 8vw, 38px); font-weight: 800; letter-spacing: -.02em; line-height: 1.1;
              margin-top: 8px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .warn { padding: 13px 16px; border-color: var(--red); }

        /* Booked-in-chat rows. Wraps to a stack on a phone rather than squeezing the countdown
           and the Cancel button into a column too narrow to hit. */
        .ord { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start;
               padding: 11px 0; border-top: 1px solid var(--line); }
        .ord:first-of-type { border-top: none; padding-top: 2px; }
        .ord-r { display: flex; align-items: center; gap: 9px; margin-left: auto; flex: none; }
        .ord-t { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ac); }
        .ord-q { margin-top: 4px; font-size: 11px; font-style: italic; opacity: .75; }
        .ord-e { margin-top: 4px; color: var(--red); }
        .ord-b { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
                 border-radius: 999px; padding: 4px 10px; border: 1px solid var(--line); color: var(--mut); }
        .ord-b.is-ok { color: var(--grn); border-color: color-mix(in srgb, var(--grn) 45%, transparent); }
        .ord-b.is-bad { color: var(--red); border-color: color-mix(in srgb, var(--red) 45%, transparent); }
        .ord-b.is-off { opacity: .7; }
        @media (max-width: 520px) {
          .ord-r { margin-left: 0; width: 100%; justify-content: space-between; }
        }
        .ap { border-top: 1px solid var(--line); margin-top: 8px; padding-top: 14px; }
        .sw { width: 48px; height: 27px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel2);
              position: relative; cursor: pointer; flex: none; transition: background .2s, border-color .2s; }
        .sw i { position: absolute; top: 3px; left: 3px; width: 19px; height: 19px; border-radius: 50%;
                background: var(--mut2); transition: transform .2s, background .2s; }
        .sw.on { background: var(--ac); border-color: var(--ac); }
        .sw.on i { transform: translateX(21px); background: #fff; }
        .sw:disabled { opacity: .4; cursor: not-allowed; }
      `}</style>
    </>
  );
}

/** The run that is happening (or just happened) — the answer to "abhi kya ho raha hai". */
function CurrentRun({ run, tz }: { run: Run; tz: string }) {
  const titles = run.articles.map((a) => a.title);
  return (
    <div className="card" style={{ padding: "15px 17px", maxWidth: 720, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--mut)" }}>
          {run.status === "running" ? "Abhi chal raha hai" : "Pichhla run"}
        </span>
        <span className={"pillst " + RUN_PILL[run.status]}>{RUN_LABEL[run.status]}</span>
      </div>
      <p className="sm" style={{ margin: "8px 0 0" }} suppressHydrationWarning>{humanTime(new Date(run.firedAt), tz)}</p>
      <p className="sm mut" style={{ margin: "6px 0 0" }}>
        {run.bossError
          ? run.bossError
          : run.status === "running"
            ? `${run.topics.length || run.planned || 0} topic plan ho chuke hain, article ban rahe hain.`
            : titles.length
              ? `${titles.length} article: ${titles.join(", ")}`
              : run.reason ?? "Is run se koi article nahi bana."}
      </p>
      {run.failures.length > 0 && (
        <p className="sm" style={{ margin: "6px 0 0", color: "var(--red)" }}>
          {run.failures.length} kaam fail hua: {run.failures[0].message}
        </p>
      )}
    </div>
  );
}

function RunCard({ run, tz }: { run: Run; tz: string }) {
  return (
    <div className="run">
      <div className="rhead">
        <span className="rwhen" suppressHydrationWarning>{humanTime(new Date(run.firedAt), tz)}</span>
        <span className={"pillst " + RUN_PILL[run.status]}>{RUN_LABEL[run.status]}</span>
        <span className="sm mut" style={{ fontSize: 11 }}>
          {run.articles.length} article{run.articles.length === 1 ? "" : "s"}
          {run.planned != null ? ` · ${run.planned} topic plan hue` : ""}
          {run.autoPublish === true ? " · auto-publish" : ""}
        </span>
      </div>

      {run.bossError && <p className="sm" style={{ margin: "6px 0 0", color: "var(--red)" }}>{run.bossError}</p>}
      {!run.bossError && run.reason && <p className="sm mut" style={{ margin: "6px 0 0" }}>{run.reason}</p>}

      {run.articles.length > 0 && (
        <div className="tw">
          <table>
            <tbody>
              {run.articles.map((a) => (
                <tr key={a.id}>
                  <td className="t">
                    {a.title}
                    {a.publishedUrl && (
                      <>
                        {" "}
                        <a href={a.publishedUrl} target="_blank" rel="noreferrer" className="acc" style={{ fontSize: 11 }}>
                          site pe dekho
                        </a>
                      </>
                    )}
                    {a.publishError && <span className="err">Publish fail: {a.publishError}</span>}
                  </td>
                  <td className="w">{a.words != null ? `${a.words} words` : "—"}</td>
                  <td className="s"><span className={"pillst " + ITEM_PILL(a.status)}>{ITEM_LABEL(a.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run.failures.map((f, i) => (
        <p key={i} className="sm" style={{ margin: "6px 0 0", color: "var(--red)" }}>
          {f.task} — {f.message}
        </p>
      ))}

      {/* Said out loud rather than hidden: these rows were matched by time, not by run id, so
          a manual run in the same window could be sitting in this list. */}
      {run.linkedBy === "time" && run.articles.length > 0 && (
        <p className="sm mut" style={{ margin: "6px 0 0", fontSize: 10.5 }}>
          Ye article run ke time se jode gaye hain (purana run — uske paas run id nahi thi), isliye is window ka
          manual kaam bhi is list me aa sakta hai.
        </p>
      )}

      <style jsx>{`
        .run { border-top: 1px solid var(--line); padding: 12px 0 2px; }
        .run:first-of-type { border-top: none; padding-top: 2px; }
        .rhead { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
        .rwhen { font-size: 13px; font-weight: 600; }
        .tw { overflow-x: auto; margin-top: 8px; -webkit-overflow-scrolling: touch; }
        table { border-collapse: collapse; width: 100%; min-width: 340px; }
        td { padding: 6px 10px 6px 0; vertical-align: top; font-size: 12.5px; border-top: 1px solid var(--line); }
        tr:first-child td { border-top: none; }
        td.t { min-width: 150px; }
        td.w { color: var(--mut); white-space: nowrap; font-size: 11px; }
        td.s { text-align: right; padding-right: 0; white-space: nowrap; }
        .err { display: block; color: var(--red); font-size: 11px; margin-top: 3px; }
      `}</style>
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
  running: "st-draft",
  finished: "st-pub",
  partial: "st-wait",
  failed: "st-fail",
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
  if (status === "published") return "st-pub";
  if (status === "awaiting_approval") return "st-wait";
  if (status === "failed" || status === "rejected") return "st-fail";
  return "st-draft";
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
