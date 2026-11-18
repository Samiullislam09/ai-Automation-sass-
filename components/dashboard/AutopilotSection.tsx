"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/** Autopilot — the lead chain as one thing: find leads, message them on WhatsApp, follow up, answer replies, book the call, remind.
 *
 *  Everything here comes from ONE object (GET /api/autopilot), the same one the chat's lookup_autopilot reads, and every change goes through POST /api/autopilot, the same
 *  code the chat's manage_autopilot tool runs. So the page, the chat and the engine always agree. Top to bottom: the master switch and a plain verdict, what is missing for the
 *  chain to run end to end (each with the page that fixes it), the six steps with their live state, where the leads are right now, and the settings.
 *
 *  Colours come from the dashboard's own theme tokens (--lx-*), so it follows light and dark like every other page. A step the server could not check is shown as "could not be
 *  checked", never as on or off. */

type Step = { step: string; on: boolean | null; detail: string };
type Shape = {
  chain: Step[];
  connected: { whatsapp: boolean | string; google_calendar: string; booking_link: boolean; team_numbers: number };
  leads_now: { total: number; waiting_for_first_message: number; messaged: number; replied: number; asked_for_a_call: number; call_booked: number; became_clients: number; need_you_now: number };
  missing_for_end_to_end: string[];
  could_not_read_right_now?: string[];
  verdict: string;
};
type Settings = {
  lead_discovery: { on: boolean; per_day: number | null; run_time: string | null; timezone: string | null };
  first_messages: boolean | null; followups: boolean | null; auto_replies: boolean | null;
  sending_hours: string | null; meeting_reminders: boolean | null; daily_summary: boolean | null;
};

/** Where each kind of "missing" is fixed. Matched on the wording the server uses, so a new message with no match simply shows without a link. */
function fixLink(msg: string): { href: string; label: string } | null {
  if (/discovery is not scheduled/i.test(msg)) return { href: "/dashboard/schedule", label: "Open Schedule" };
  if (/WhatsApp is not linked/i.test(msg)) return { href: "/dashboard/connect", label: "Open Connect" };
  if (/Auto-replies are switched OFF|First messages|Follow-ups are switched off/i.test(msg)) return { href: "/dashboard/whatsapp", label: "Open WhatsApp" };
  if (/meeting link|Google Calendar|booking link/i.test(msg)) return { href: "/dashboard/connect", label: "Connect Google" };
  if (/team number/i.test(msg)) return { href: "/dashboard/connect", label: "Add a number" };
  return null;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function AutopilotSection() {
  const [shape, setShape] = useState<Shape | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/autopilot", { cache: "no-store" }).then((x) => x.json());
      if (!alive.current) return;
      if (!r?.ok) { setError(r?.error || "The autopilot could not be loaded."); return; }
      setShape(r.autopilot); setSettings(r.settings); setError(null);
    } catch { if (alive.current) setError("The autopilot could not be loaded."); }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true); setNote(null);
    try {
      const r = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then((x) => x.json());
      if (r?.autopilot) { setShape(r.autopilot); setSettings(r.settings); }
      setNote(r?.ok ? (r.result?.verdict ?? "Saved.") : r?.error ?? "That did not save.");
    } catch { setNote("That did not save. Check your connection and try again."); }
    finally { setSaving(false); }
  };

  const master = !!settings?.lead_discovery.on && settings.first_messages !== false && settings.auto_replies === true;
  const anyOn = !!settings && (settings.lead_discovery.on || settings.first_messages === true || settings.auto_replies === true);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-1 pb-10">
      <div>
        <h1 className="text-[22px] font-bold" style={{ color: "var(--lx-text)" }}>Autopilot</h1>
        <p className="lx-12 lx-mut mt-1">Find leads, message them on WhatsApp, follow up, answer replies, book the call and remind — one switch, one picture.</p>
      </div>

      {error && <div className="lx-card2 p-4 lx-12" style={{ color: "#f87171" }} role="alert">{error}</div>}
      {!shape && !error && <div className="lx-card p-6 lx-12 lx-mut">Loading…</div>}

      {shape && settings && (
        <>
          {/* the master switch and the plain verdict */}
          <section className="lx-card p-4 sm:p-5" aria-label="Autopilot switch">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1 basis-[260px]">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: master ? "#22c55e" : anyOn ? "#f59e0b" : "#64748b" }} />
                  <b className="text-[16px]" style={{ color: "var(--lx-text)" }}>{master ? "Autopilot is ON" : anyOn ? "Autopilot is partly on" : "Autopilot is OFF"}</b>
                </div>
                <p className="lx-12 lx-mut mt-1.5">{shape.verdict}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button disabled={saving || master} onClick={() => void save({ on: true })} className="lx-grad lx-12 px-4 py-2 disabled:opacity-50">Turn everything on</button>
                <button disabled={saving || !anyOn} onClick={() => void save({ on: false })} className="lx-ghost lx-12 px-4 py-2 disabled:opacity-50">Pause everything</button>
              </div>
            </div>
            {note && <p className="lx-11 mt-3" role="status" style={{ color: "var(--lx-text)" }}>{note}</p>}
            <p className="lx-10 lx-mut mt-3">Pausing stops finding leads, first messages, follow-ups and auto-replies together. Nothing is deleted; turn it back on any time.</p>
          </section>

          {/* what is missing */}
          {shape.missing_for_end_to_end.length > 0 && (
            <section className="lx-card p-4 sm:p-5" aria-label="What is missing">
              <b className="text-[14px]" style={{ color: "var(--lx-text)" }}>{shape.missing_for_end_to_end.length} thing{shape.missing_for_end_to_end.length === 1 ? "" : "s"} to finish for it to run end to end</b>
              <ul className="mt-3 space-y-2">
                {shape.missing_for_end_to_end.map((m) => {
                  const fix = fixLink(m);
                  return (
                    <li key={m} className="lx-card2 flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <span className="lx-12" style={{ color: "var(--lx-text)" }}>{m}</span>
                      {fix && <Link href={fix.href} className="lx-grad lx-11 px-3 py-1.5">{fix.label}</Link>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {shape.could_not_read_right_now && shape.could_not_read_right_now.length > 0 && (
            <p className="lx-11 lx-mut">Could not check just now: {shape.could_not_read_right_now.join("; ")}. This page tries again by itself.</p>
          )}

          {/* the six steps */}
          <section aria-label="The chain">
            <h2 className="mb-2 text-[14px] font-semibold" style={{ color: "var(--lx-text)" }}>The chain</h2>
            <ol className="grid gap-2 sm:grid-cols-2">
              {shape.chain.map((c) => (
                <li key={c.step} className="lx-card2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <b className="lx-12" style={{ color: "var(--lx-text)" }}>{c.step}</b>
                    <span className={`lx-pill ${c.on === null ? "mut" : c.on ? "green" : "amber"}`}>{c.on === null ? "could not check" : c.on ? "on" : "off"}</span>
                  </div>
                  <p className="lx-11 lx-mut mt-1.5">{c.detail}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* where the leads are */}
          <section className="lx-card p-4 sm:p-5" aria-label="Where the leads are">
            <h2 className="mb-3 text-[14px] font-semibold" style={{ color: "var(--lx-text)" }}>Where your leads are right now</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["Leads in total", shape.leads_now.total],
                ["Waiting for a first message", shape.leads_now.waiting_for_first_message],
                ["Messaged", shape.leads_now.messaged],
                ["Replied", shape.leads_now.replied],
                ["Asked for a call", shape.leads_now.asked_for_a_call],
                ["Call booked", shape.leads_now.call_booked],
                ["Became clients", shape.leads_now.became_clients],
                ["Need you now", shape.leads_now.need_you_now],
              ] as [string, number][]).map(([label, n]) => (
                <div key={label} className="lx-card2 p-3">
                  <div className="text-[22px] font-bold tabular-nums" style={{ color: label === "Need you now" && n > 0 ? "#fbbf24" : "var(--lx-text)" }}>{n}</div>
                  <div className="lx-10 lx-mut mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/dashboard/leads" className="lx-ghost lx-11 px-3 py-1.5">Open Leads</Link>
              <Link href="/dashboard/whatsapp" className="lx-ghost lx-11 px-3 py-1.5">Open WhatsApp</Link>
            </div>
          </section>

          {/* settings */}
          <section className="lx-card p-4 sm:p-5" aria-label="Settings">
            <h2 className="mb-3 text-[14px] font-semibold" style={{ color: "var(--lx-text)" }}>Settings</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="lx-card2 block p-3">
                <span className="lx-12 font-semibold" style={{ color: "var(--lx-text)" }}>New leads found per day</span>
                <span className="lx-10 lx-mut block mt-0.5">1 to 50. Found by the daily discovery.</span>
                <input type="number" min={1} max={50} defaultValue={settings.lead_discovery.per_day ?? 10} key={`pd-${settings.lead_discovery.per_day}`}
                  onBlur={(e) => { const n = Number(e.target.value); if (n !== settings.lead_discovery.per_day) void save({ leads_per_day: n }); }}
                  className="lx-12 mt-2 w-24 rounded-lg px-2.5 py-1.5" style={{ background: "var(--lx-in)", color: "var(--lx-text)", border: "1px solid var(--lx-border)" }} />
              </label>
              <label className="lx-card2 block p-3">
                <span className="lx-12 font-semibold" style={{ color: "var(--lx-text)" }}>Daily discovery runs at</span>
                <span className="lx-10 lx-mut block mt-0.5">Your local time{settings.lead_discovery.timezone ? ` (${settings.lead_discovery.timezone})` : ""}.</span>
                <input type="time" defaultValue={settings.lead_discovery.run_time ?? "09:00"} key={`rt-${settings.lead_discovery.run_time}`}
                  onBlur={(e) => { if (e.target.value && e.target.value !== settings.lead_discovery.run_time) void save({ run_time: e.target.value }); }}
                  className="lx-12 mt-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--lx-in)", color: "var(--lx-text)", border: "1px solid var(--lx-border)" }} />
              </label>
              <div className="lx-card2 p-3 sm:col-span-2">
                <span className="lx-12 font-semibold" style={{ color: "var(--lx-text)" }}>Messages may be sent between</span>
                <span className="lx-10 lx-mut block mt-0.5">First messages and follow-ups only go out in these hours. A customer who writes to you is always answered.</span>
                <div className="mt-2 flex items-center gap-2">
                  {(["send_start", "send_end"] as const).map((k, idx) => {
                    const [a, b] = (settings.sending_hours ?? "9:00 to 21:00").split(" to ").map((x) => parseInt(x, 10));
                    const val = idx === 0 ? a : b;
                    return (
                      <span key={k} className="flex items-center gap-2">
                        {idx === 1 && <span className="lx-11 lx-mut">to</span>}
                        <select value={val} disabled={saving} onChange={(e) => void save({ [k]: Number(e.target.value) })} aria-label={idx === 0 ? "From hour" : "To hour"}
                          className="lx-12 rounded-lg px-2.5 py-1.5" style={{ background: "var(--lx-in)", color: "var(--lx-text)", border: "1px solid var(--lx-border)" }}>
                          {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                        </select>
                      </span>
                    );
                  })}
                </div>
              </div>
              {([
                ["followups", "Follow-ups", "After 48 hours, 5 days and 7 days of silence, then it stops.", settings.followups],
                ["auto_replies", "Answer replies by itself", "Replies to customers in their own language; hands the rest to you.", settings.auto_replies],
                ["reminders", "Meeting reminders", "24 hours and 1 hour before a booked call.", settings.meeting_reminders],
                ["daily_summary", "Daily summary to your team", "One WhatsApp every evening. Nothing on a quiet day.", settings.daily_summary],
              ] as [string, string, string, boolean | null][]).map(([key, label, hint, on]) => (
                <button key={key} type="button" disabled={saving || on === null} onClick={() => void save({ [key]: !on })} role="switch" aria-checked={on === true}
                  className="lx-card2 flex items-start justify-between gap-3 p-3 text-left disabled:opacity-60">
                  <span className="min-w-0">
                    <span className="lx-12 block font-semibold" style={{ color: "var(--lx-text)" }}>{label}</span>
                    <span className="lx-10 lx-mut block mt-0.5">{on === null ? "Could not be checked just now." : hint}</span>
                  </span>
                  <span aria-hidden className="mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5" style={{ background: on ? "#22c55e" : "#475569", justifyContent: on ? "flex-end" : "flex-start" }}>
                    <span className="h-5 w-5 rounded-full bg-white" />
                  </span>
                </button>
              ))}
            </div>
            <p className="lx-10 lx-mut mt-3">Who you want to find (your ideal buyer) is set in Leads. You can also just tell MenCra in the chat: &ldquo;find 20 leads a day&rdquo; or &ldquo;pause the autopilot&rdquo;.</p>
          </section>
        </>
      )}
    </div>
  );
}
