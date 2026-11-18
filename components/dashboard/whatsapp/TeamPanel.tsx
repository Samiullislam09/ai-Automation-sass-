"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Mr. WhatsApp · Team — who is on the team, and exactly what each person was told.
 *
 *  Two reads: the team (GET /api/whatsapp/admins) and the alerts the assistant sent them (GET /api/whatsapp/log?kind=alert). Every alert is recorded PER PERSON with whether it
 *  reached them, and also when nobody could be told (no number set, or every number muted) — so "my boss got nothing" always has an answer on this page. */

type Admin = { id: string; name: string | null; phone: string; role: string; notify: boolean };
type Alert = { id: string; at: string; lead_id: string | null; name: string; text: string; detail?: { to?: string | null; name?: string | null; ok?: boolean; text?: string; error?: string } };

const C = { green: "#008069", ink: "#111b21", sub: "#667781", line: "#e9edef", soft: "#f5f6f6", amberSoft: "#fff8e1", amberText: "#7a5b00", red: "#b42318", redSoft: "#fdeaea", greenSoft: "#e7f6ec", greenText: "#067647" };
const digits = (s: unknown) => String(s ?? "").replace(/[^\d]/g, "");
const when = (iso: string) => {
  const d = new Date(iso), t = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === t.toDateString()) return `Today ${time}`;
  const y = new Date(t.getTime() - 86_400_000);
  return d.toDateString() === y.toDateString() ? `Yesterday ${time}` : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
};

export default function TeamPanel({ onOpenChat, onOpenSettings }: { onOpenChat: (leadId: string) => void; onOpenSettings: () => void }) {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        fetch("/api/whatsapp/admins", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/whatsapp/log?kind=alert&limit=120", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (!alive.current) return;
      if (a?.ok) setAdmins(a.admins ?? []); else setError(a?.error || "The team could not be loaded.");
      if (l?.ok) { setAlerts(l.items ?? []); if (a?.ok) setError(null); }
    } catch { if (alive.current) setError("The team could not be loaded."); }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  const forPerson = (a: Admin) => (alerts ?? []).filter((x) => x.detail?.to && digits(x.detail.to) === digits(a.phone));
  const nobody = (alerts ?? []).filter((x) => !x.detail?.to);

  return (
    <div className="wa-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-6" style={{ background: "#fff", color: C.ink }}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold">Your team</h2>
            <p className="mt-0.5 text-[12.5px]" style={{ color: C.sub }}>These people get a WhatsApp from the assistant when a lead wants a call, is ready to buy, or needs a person. Below: what each one was told.</p>
          </div>
          <button onClick={onOpenSettings} className="h-9 rounded-lg px-4 text-[13px] font-medium text-white" style={{ background: C.green }}>Add or change team numbers</button>
        </div>

        {error && <p className="rounded-lg px-3 py-2.5 text-[13px]" style={{ background: C.redSoft, color: C.red }} role="alert">{error}</p>}
        {admins === null && !error && <p className="text-[13px]" style={{ color: C.sub }}>Loading…</p>}

        {admins && admins.length === 0 && (
          <div className="rounded-xl p-4" style={{ background: C.amberSoft, color: C.amberText }}>
            <b className="text-[14px]">Nobody is on your team yet.</b>
            <p className="mt-1 text-[12.5px]">So when a customer asks for a call, nobody is told on WhatsApp. Add your own number (and your boss&apos;s) and alerts start.</p>
          </div>
        )}

        {(admins ?? []).map((a) => {
          const mine = forPerson(a);
          const failed = mine.filter((x) => x.detail?.ok === false).length;
          return (
            <section key={a.id} className="rounded-xl" style={{ border: `1px solid ${C.line}` }}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ background: C.soft, borderRadius: "12px 12px 0 0" }}>
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] font-semibold">{a.name || a.phone}{a.role === "owner" && <span className="ml-2 rounded px-1.5 py-px text-[10.5px] font-bold" style={{ background: C.greenSoft, color: C.greenText }}>Owner</span>}</div>
                  {a.name && <div className="text-[12px]" style={{ color: C.sub }}>{a.phone}</div>}
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="rounded-full px-2.5 py-0.5 font-semibold" style={{ background: a.notify ? C.greenSoft : C.line, color: a.notify ? C.greenText : C.sub }}>{a.notify ? "Alerts on" : "Muted"}</span>
                  <span style={{ color: C.sub }}>{mine.length} alert{mine.length === 1 ? "" : "s"}{failed ? `, ${failed} not delivered` : ""}</span>
                </div>
              </div>
              {alerts === null ? (
                <p className="px-4 py-3 text-[13px]" style={{ color: C.sub }}>Loading…</p>
              ) : mine.length === 0 ? (
                <p className="px-4 py-3 text-[13px]" style={{ color: C.sub }}>{a.notify ? "No alert has been sent to this number yet. They appear here the moment one is." : "Muted: this number is not sent alerts."}</p>
              ) : (
                <ul>
                  {mine.slice(0, 30).map((x) => (
                    <li key={x.id} className="flex gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${C.line}` }}>
                      <span className="w-[92px] shrink-0 pt-0.5 text-[11.5px] tabular-nums" style={{ color: C.sub }}>{when(x.at)}</span>
                      <span aria-hidden className="mt-0.5 shrink-0 text-[13px]" style={{ color: x.detail?.ok === false ? C.red : C.greenText }}>{x.detail?.ok === false ? "✗" : "✓"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed">{x.detail?.text ?? x.text}</span>
                        {x.detail?.ok === false && <span className="block text-[12px]" style={{ color: C.red }}>Not delivered{x.detail?.error ? `: ${x.detail.error}` : ""}</span>}
                        {x.lead_id && <button onClick={() => onOpenChat(x.lead_id!)} className="mt-0.5 text-[12px] font-medium underline-offset-2 hover:underline" style={{ color: C.green }}>Open {x.name || "the chat"}</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {nobody.length > 0 && (
          <section className="rounded-xl p-4" style={{ background: C.amberSoft, color: C.amberText }}>
            <b className="text-[14px]">Alerts nobody received ({nobody.length})</b>
            <ul className="mt-2 space-y-1.5 text-[12.5px]">
              {nobody.slice(0, 8).map((x) => <li key={x.id}><span className="tabular-nums opacity-80">{when(x.at)}</span> — {x.text}</li>)}
            </ul>
          </section>
        )}

        {alerts !== null && alerts.length === 0 && (admins?.length ?? 0) > 0 && (
          <p className="text-[12px]" style={{ color: C.sub }}>If a lead asked for a call recently and nothing shows here, the activity log migration (044) may not be applied yet; new alerts are recorded from then on.</p>
        )}
      </div>
    </div>
  );
}
