"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /app/schedule — "har roz X baje apne aap kaam ho jaye".
 *
 *  This is the first thing in the product that runs without a human pressing anything.
 *  The row saved here is read once a minute by agent-server/src/scheduler.ts, which starts
 *  the same chain the "Run the team" button starts: boss -> keyword -> writer -> quality
 *  gate -> Approvals. It still never publishes on its own — the article lands in Approvals
 *  and waits for you, exactly like a manual run. */

type Sched = {
  enabled: boolean;
  frequency: "daily" | "weekdays" | "weekly";
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  count: number;
  lastRunAt: string | null;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULTS: Sched = {
  enabled: false,
  frequency: "daily",
  dayOfWeek: 1,
  timeOfDay: "09:00",
  timezone: "UTC",
  count: 2,
  lastRunAt: null,
};

export default function Schedule() {
  const { toast } = useStore();
  const [sched, setSched] = useState<Sched | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [migration, setMigration] = useState(false);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    // The browser knows the customer's timezone; the server never does. Used only as the
    // default for a brand-new schedule — a saved one keeps whatever they chose.
    const browserTz = (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
    })();

    fetch("/api/schedule")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setError(d.error ?? "Schedule load nahi ho paya.");
          setMigration(!!d.needsMigration);
          setSched({ ...DEFAULTS, timezone: browserTz });
          return;
        }
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
                lastRunAt: row.last_run_at,
              }
            : { ...DEFAULTS, timezone: browserTz }
        );
      })
      .catch((e) => {
        setError(e?.message ?? "Network error.");
        setSched({ ...DEFAULTS, timezone: browserTz });
      });
  }, []);

  // Computed after mount only — new Date() during render would print a different answer on
  // the server than in the browser, which is exactly the hydration error class this app
  // already had to hunt down once.
  useEffect(() => {
    if (!sched) return;
    setNext(sched.enabled ? describeNextRun(sched) : null);
  }, [sched]);

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
      toast(body.enabled ? "Schedule chalu — team apne aap kaam karegi." : "Schedule band kar diya.");
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
    } finally {
      setSaving(false);
    }
  };

  if (!sched) return <p className="sm mut">Loading…</p>;

  return (
    <>
      <h1 style={{ fontSize: 21, margin: "0 0 6px" }}>Schedule</h1>
      <p className="sm mut" style={{ marginBottom: 20, maxWidth: 660 }}>
        Har roz / har hafte team ko apne aap kaam pe laga do. Time tumhare apne timezone ka hai.
        Publish phir bhi apne aap nahi hota — article ban kar <Link href="/app/approvals" className="acc">Approvals</Link> me
        aata hai aur tumhare approve karne ka intezaar karta hai.
      </p>

      {migration && (
        <div className="card" style={{ padding: "13px 16px", marginBottom: 16, borderColor: "#c23052" }}>
          <b style={{ fontSize: 13 }}>Database migration baaki hai</b>
          <p className="sm mut" style={{ margin: "6px 0 0" }}>
            Supabase SQL editor me <code>supabase/migrations/006_schedules.sql</code> chalao — tab tak yahan kuch save nahi hoga.
          </p>
        </div>
      )}

      <div className="card" style={{ padding: "17px 18px", maxWidth: 660 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Automatic articles</div>
            <p className="sm mut" style={{ margin: "4px 0 0" }}>
              Mr Lxwa topic chunta hai → Mr. Keyword research karta hai → Mr. Writer likhta hai → quality gate → Approvals.
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

        {error && <p className="sm" style={{ color: "#ff6b6b", margin: "4px 0 10px" }}>{error}</p>}

        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <button className="btn btn-p" disabled={saving} onClick={() => save()}>
            {saving ? "Saving…" : "Save schedule"}
          </button>
          <span className="sm mut">
            {sched.enabled
              ? next ? `Agla run: ${next}` : "…"
              : "Abhi band hai — kuch apne aap nahi chalega."}
          </span>
        </div>

        {sched.lastRunAt && (
          <p className="sm mut" style={{ marginTop: 12, fontSize: 11 }}>
            Pichhla automatic run: {new Date(sched.lastRunAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="card" style={{ padding: "15px 17px", maxWidth: 660, marginTop: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>Social posts</div>
        <p className="sm mut" style={{ margin: 0 }}>
          Isko schedule karne ka koi matlab nahi jab tak Social agent post karna shuru na kare — wo abhi stub hai
          (<code>agent-server/src/agents/social.ts</code>). Relay endpoint aaj hi{" "}
          <Link href="/app/connect" className="acc">Connect</Link> me jod sakte ho; jaise hi agent live hoga,
          yahan uska apna schedule aa jayega.
        </p>
      </div>

      <p className="sm mut" style={{ marginTop: 16, maxWidth: 660, fontSize: 11 }}>
        Ye schedule agent-server (Railway) me chalta hai. Agar wo service band hai to schedule bhi nahi chalega —
        deploy ke baad chhoote hue run dobara nahi hote, agla scheduled time hi chalega.
      </p>

      <style jsx>{`
        .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0 14px; }
        .sw { width: 48px; height: 27px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel2);
              position: relative; cursor: pointer; flex: none; transition: background .2s, border-color .2s; }
        .sw i { position: absolute; top: 3px; left: 3px; width: 19px; height: 19px; border-radius: 50%;
                background: var(--mut2); transition: transform .2s, background .2s; }
        .sw.on { background: var(--ac); border-color: var(--ac); }
        .sw.on i { transform: translateX(21px); background: #fff; }
      `}</style>
    </>
  );
}

/** Mirrors the matching logic in agent-server/src/scheduler.ts. Kept deliberately simple:
 *  walk forward a day at a time in the tenant's own timezone and return the first slot that
 *  qualifies, so weekly/weekday rules and "aaj ka time nikal chuka hai" all fall out of it. */
function describeNextRun(s: Sched): string {
  const [hh, mm] = s.timeOfDay.split(":").map(Number);
  let parts: { y: number; m: number; d: number; hour: number; minute: number };
  try {
    parts = localParts(new Date(), s.timezone);
  } catch {
    return `timezone "${s.timezone}" invalid hai`;
  }

  const nowMinutes = parts.hour * 60 + parts.minute;
  const target = hh * 60 + mm;

  for (let offset = 0; offset < 14; offset++) {
    // UTC arithmetic on the LOCAL calendar date — no timezone shifting, just day counting.
    const day = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + offset));
    const dow = day.getUTCDay();
    if (offset === 0 && target <= nowMinutes) continue;
    if (s.frequency === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (s.frequency === "weekly" && dow !== s.dayOfWeek) continue;

    const when = offset === 0 ? "aaj" : offset === 1 ? "kal" : `${DAYS[dow]} ${day.getUTCDate()}/${day.getUTCMonth() + 1}`;
    return `${when} ${s.timeOfDay} (${s.timezone})`;
  }
  return "koi matching din nahi mila";
}

function localParts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), hour: get("hour"), minute: get("minute") };
}
