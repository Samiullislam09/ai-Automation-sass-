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

  const changed = () => { onChange?.(); };

  const add = async () => {
    if (phone.replace(/[^0-9]/g, "").length < 8) { toast("Enter the full number with country code, e.g. +971 50 123 4567.", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() || null, phone }) }).then((x) => x.json());
      if (!r.ok) toast(r.error ?? "Could not add this number.", "error");
      else { setName(""); setPhone(""); await reload(); changed(); }
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

      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" autoComplete="off" aria-label="Name" className="w-28 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none" style={{ background: P.inputBg, color: P.inputText, border: `1px solid ${P.line}` }} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="+971 50 123 4567" autoComplete="off" inputMode="tel" aria-label="WhatsApp number with country code" className="flex-1 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none" style={{ background: P.inputBg, color: P.inputText, border: `1px solid ${P.line}` }} />
        <button onClick={add} disabled={busy} className="shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: P.accent }}>{busy ? "Adding…" : "Add"}</button>
      </div>

      <ul className="mt-2.5 space-y-1 text-[11.5px] leading-relaxed" style={{ color: P.sub, listStyle: "disc", paddingLeft: 16 }}>
        <li>Alerts are sent from your linked WhatsApp number. Add a <b>different</b> number from the one you linked — a message to yourself will not reach your phone.</li>
        <li>Always include the country code. Mute a number any time without removing it.</li>
        <li>During a rush, &ldquo;needs attention&rdquo; alerts are grouped into one message every few minutes, so your phone is not flooded. Every one is still listed on the dashboard.</li>
      </ul>
    </div>
  );
}
