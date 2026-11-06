"use client";
import { useEffect, useState } from "react";
import { C, D, STAGE, SOURCE_LABEL, SORT_LABEL, REJECT_REASONS, ago, scoreColor, isToday, fmtDay, siteLabel, initials, cityOf, countryOf, phoneDisplay, StageChip, Tag, WaGlyph, RejectMenu, type Lead, type Gen } from "./shared";

export default function AddLeadModal({ open, onClose, onAdded, toast }: { open: boolean; onClose: () => void; onAdded: () => void; toast: (m: string, t?: "error") => void }) {
  const [f, setF] = useState({ company: "", name: "", phone: "", email: "", city: "", website: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setF({ company: "", name: "", phone: "", email: "", city: "", website: "" });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const save = async () => {
    if (!f.company.trim()) { toast("Enter a company or contact name.", "error"); return; }
    if (f.phone.replace(/[^0-9]/g, "").length < 8) { toast("Enter a full phone number with country code.", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: f.company.trim(), name: f.name.trim(), phone: f.phone.replace(/[^0-9+]/g, ""), email: f.email.trim(), city: f.city.trim(), website: f.website.trim() }) }).then((x) => x.json());
      if (!r.ok) { toast(r.error ?? "Could not add.", "error"); return; }
      toast("Lead added — approved and ready to message.");
      onAdded();
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(false); }
  };
  const field = (key: keyof typeof f, label: string, ph: string) => (
    <div className="mb-3">
      <label className="mb-1 block text-[12px] font-medium" style={{ color: C.sub }}>{label}</label>
      <input className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.ink }} placeholder={ph} value={f[key]} onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))} />
    </div>
  );
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.45)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.panel }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold" style={{ color: C.ink }}>Add a lead</h2>
        <p className="mb-4 mt-1 text-[12.5px]" style={{ color: C.sub }}>It goes straight to Approved, so you can message it right away.</p>
        {field("company", "Company", "Gulf Steel LLC")}
        {field("name", "Contact name", "Ahmed Khan")}
        {field("phone", "Phone (with country code)", "+971 50 123 4567")}
        {field("email", "Email", "ahmed@gulfsteel.ae")}
        {field("city", "City", "Dubai")}
        {field("website", "Website", "gulfsteel.ae")}
        <div className="flex justify-end gap-2">
          <button className="rounded-xl px-4 py-2 text-[13px] font-semibold" style={{ background: C.graySoft, color: C.sub }} onClick={onClose}>Cancel</button>
          <button className="rounded-xl px-5 py-2 text-[13px] font-semibold text-white" style={{ background: C.brand }} onClick={save} disabled={busy}>{busy ? "Adding…" : "Add lead"}</button>
        </div>
      </div>
    </div>
  );
}

