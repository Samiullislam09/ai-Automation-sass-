"use client";
import { useCallback, useEffect, useState } from "react";

/** Team alerts — the WhatsApp numbers that hear about a lead the moment it matters.
 *
 *  One component, two places: the WhatsApp page's settings panel (light WhatsApp palette) and the Connect page
 *  (the dashboard's dark palette), so the owner can set it up where they connect things and change it where they
 *  work, and both always show the same list (/api/whatsapp/admins). Colours come in as a palette; nothing here
 *  assumes either theme.
 *
 *  What a number on this list receives (agent-server/src/lib/whatsapp/*): a meeting request and a booked meeting,
 *  a lead that is ready to buy, a customer the assistant has handed to a person, and a customer left waiting. */

export type AdminRow = { id: string; name: string | null; phone: string; role: string; notify: boolean };

export type TeamAlertsPalette = {
  rowBg: string; text: string; sub: string; line: string; accent: string;
  inputBg: string; inputText: string; onBg: string; onText: string; danger: string;
};

/** The numbers, and whether any of them is switched on. Shared so the Connect tile can show a true status. */
export function useAdmins() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/admins").then((x) => x.json());
      if (r?.ok) setAdmins(r.admins ?? []);
      else setAdmins((a) => a ?? []);
    } catch { setAdmins((a) => a ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { admins, setAdmins, reload: load };
}

export const TEAM_ALERTS_CAPTION =
  "Get a WhatsApp message on your phone the moment a lead asks for a meeting, is ready to buy, or needs a decision from you — and when the assistant hands a conversation over to you.";

export default function TeamAlerts({
  toast, palette: P, onChange, compact = false,
}: {
  toast: (m: string, t?: "error") => void;
  palette: TeamAlertsPalette;
  /** Called after any change, so a parent showing a status can refresh it. */
  onChange?: () => void;
  /** Hide the heading block (the host already shows one). */
  compact?: boolean;
}) {
  const { admins, setAdmins, reload } = useAdmins();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const changed = () => { onChange?.(); };

  const add = async () => {
    const digits = phone.replace(/[^0-9]/g, "");
    if (/[a-z]/i.test(phone)) { setErr("A phone number has digits only — put the person's name in the Name field."); return; }
    if (digits.length < 8) { setErr("Enter the full number with the country code, e.g. +91 98765 43210."); return; }
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() || null, phone }) }).then((x) => x.json());
      if (!r.ok) setErr(r.error ?? "Could not add this number.");
      else { setName(""); setPhone(""); await reload(); changed(); toast("Added. This number now gets the alerts."); }
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); } finally { setBusy(false); }
  };

  const toggleNotify = async (a: AdminRow) => {
    setAdmins((xs) => (xs ?? []).map((x) => (x.id === a.id ? { ...x, notify: !x.notify } : x)));
    try {
      await fetch("/api/whatsapp/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id, name: a.name, phone: a.phone, role: a.role, notify: !a.notify }) });
      changed();
    } catch { void reload(); }
  };

  const remove = async (id: string) => {
    setAdmins((xs) => (xs ?? []).filter((x) => x.id !== id));
    try { await fetch(`/api/whatsapp/admins?id=${encodeURIComponent(id)}`, { method: "DELETE" }); changed(); } catch { void reload(); }
  };

  const none = admins && admins.length === 0;

  return (
    <div>
      {!compact && (
        <>
          <b className="text-[13.5px]" style={{ color: P.text }}>Team alerts</b>
          <div className="mb-2 mt-0.5 text-[11.5px] leading-relaxed" style={{ color: P.sub }}>{TEAM_ALERTS_CAPTION}</div>
        </>
      )}

      <div className="mb-2 space-y-1.5">
        {admins === null && <div className="text-[12px]" style={{ color: P.sub }}>Loading…</div>}
        {(admins ?? []).map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: P.rowBg }}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium" style={{ color: P.text }}>
                {a.name || a.phone}
                {a.role === "owner" && <span className="ml-1.5 rounded px-1 text-[9.5px] font-bold" style={{ color: P.onText, background: P.onBg }}>Owner</span>}
              </div>
              {a.name && <div className="text-[11.5px]" style={{ color: P.sub }}>{a.phone}</div>}
            </div>
            <button onClick={() => toggleNotify(a)} title={a.notify ? "Alerts on — click to mute" : "Muted — click to turn alerts on"} className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ color: a.notify ? P.onText : P.sub, background: a.notify ? P.onBg : P.line }}>
              {a.notify ? "Alerts on" : "Muted"}
            </button>
            <button onClick={() => remove(a.id)} className="shrink-0 rounded-full p-1" style={{ color: P.danger }} aria-label={`Remove ${a.name || a.phone}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        ))}
        {none && <div className="rounded-lg px-3 py-2.5 text-[12px] leading-relaxed" style={{ background: P.rowBg, color: P.sub }}>No numbers yet. Add your own WhatsApp number below to start receiving alerts.</div>}
      </div>

      {/* Add a person: two labelled, full-width fields, stacked — a narrow panel can never squeeze one of them to nothing. */}
      <div className="rounded-xl p-3" style={{ background: P.rowBg }}>
        <div className="mb-2 text-[12.5px] font-semibold" style={{ color: P.text }}>Add a team member</div>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium" style={{ color: P.sub }}>Name <span style={{ opacity: 0.8 }}>(optional, e.g. Boss)</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Boss" autoComplete="off" className="block w-full rounded-lg px-3 py-2 text-[13px] outline-none" style={{ background: P.inputBg, color: P.inputText, border: `1px solid ${P.line}`, width: "100%" }} />
        </label>
        <label className="mt-2.5 block">
          <span className="mb-1 block text-[11.5px] font-medium" style={{ color: P.sub }}>WhatsApp number, with country code</span>
          <input value={phone} onChange={(e) => { setPhone(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="+91 98765 43210" autoComplete="off" inputMode="tel" aria-invalid={!!err}
            className="block w-full rounded-lg px-3 py-2 text-[13px] outline-none" style={{ background: P.inputBg, color: P.inputText, border: `1px solid ${err ? P.danger : P.line}`, width: "100%" }} />
        </label>
        {err && <div className="mt-1.5 text-[12px]" role="alert" style={{ color: P.danger }}>{err}</div>}
        <button onClick={add} disabled={busy || !phone.trim()} className="mt-3 block w-full rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: P.accent, width: "100%" }}>{busy ? "Adding…" : "Add number"}</button>
      </div>

      <ul className="mt-2.5 space-y-1 text-[11.5px] leading-relaxed" style={{ color: P.sub, listStyle: "disc", paddingLeft: 16 }}>
        <li>Alerts are sent from your linked WhatsApp number. Add a <b>different</b> number from the one you linked — a message to yourself will not reach your phone.</li>
        <li>Always include the country code. Mute a number any time without removing it.</li>
        <li>During a rush, &ldquo;needs attention&rdquo; alerts are grouped into one message every few minutes, so your phone is not flooded. Every one is still listed on the dashboard.</li>
      </ul>
    </div>
  );
}
