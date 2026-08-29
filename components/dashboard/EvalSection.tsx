"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { DELIVERIES, FOLLOWUP_KINDS, INTENTS, normalizeLabel, type IntentLabel } from "@/lib/eval/intent-labels";
import { LxInput, LxSelect } from "./ui";

/** /dashboard/eval — same real logic and API calls as the old app/app/eval/page.tsx: reviewing
 *  the model's auto-labelled intent set against /api/eval, one message at a time. Keyboard
 *  shortcuts (A accept · S save · K skip · J/→ next · ← previous) kept verbatim. Restyled to
 *  the new dashboard theme per the owner's standing instruction (2026-08-29). Rendered inside
 *  <MrLxwaDashboard> as its `children` — see app/dashboard/eval/page.tsx. */

type Row = {
  id: string;
  text: string;
  prior_assistant: string | null;
  auto_label: IntentLabel | null;
  auto_model: string | null;
  human_label: IntentLabel | null;
  status: "auto" | "reviewed" | "skipped";
  reviewed_at: string | null;
  created_at: string;
};

const EMPTY: IntentLabel = { intent: "other", topic: null, delivery: null, when: null, is_followup: false, followup_kind: null, ambiguous: false, notes: "" };

const STATUS_TONE: Record<Row["status"], string> = { auto: "amber", reviewed: "green", skipped: "mut" };

export default function EvalSection() {
  const { toast } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ total: 0, reviewed: 0, skipped: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | Row["status"]>("auto");
  const [intentFilter, setIntentFilter] = useState<string>("all");
  const [ix, setIx] = useState(0);
  const [form, setForm] = useState<IntentLabel>(EMPTY);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/eval?status=${statusFilter}&intent=${intentFilter}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error);
        setRows(d.rows);
        setTotals({ total: d.total, reviewed: d.reviewed, skipped: d.skipped });
        setIx(0);
      })
      .catch((e) => toast(`Couldn't load the eval set: ${e.message}`, "error"))
      .finally(() => setLoading(false));
  }, [statusFilter, intentFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  const row = rows[ix] ?? null;
  useEffect(() => {
    setForm(normalizeLabel(row?.human_label ?? row?.auto_label) ?? EMPTY);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (status: Row["status"], label?: IntentLabel) => {
    if (!row || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/eval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, status, human_label: label }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status, human_label: d.row.human_label, reviewed_at: d.row.reviewed_at } : r)));
      setTotals((t) => {
        const was = row.status, now = status;
        return {
          total: t.total,
          reviewed: t.reviewed + (now === "reviewed" ? 1 : 0) - (was === "reviewed" ? 1 : 0),
          skipped: t.skipped + (now === "skipped" ? 1 : 0) - (was === "skipped" ? 1 : 0),
        };
      });
      if (ix < rows.length - 1) setIx(ix + 1);
    } catch (e: any) {
      toast(`Save failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const accept = () => row?.auto_label && patch("reviewed", normalizeLabel(row.auto_label) ?? undefined);
  const save = () => patch("reviewed", form);
  const skip = () => patch("skipped");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        return;
      }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); accept(); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); save(); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); skip(); }
      else if (e.key === "j" || e.key === "ArrowRight") { e.preventDefault(); setIx((i) => Math.min(i + 1, rows.length - 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setIx((i) => Math.max(i - 1, 0)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const set = <K extends keyof IntentLabel>(k: K, v: IntentLabel[K]) => setForm((f) => ({ ...f, [k]: v }));
  const auto = row?.auto_label ?? null;
  const differs = useMemo(() => auto && JSON.stringify(normalizeLabel(auto)) !== JSON.stringify(form), [auto, form]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-lg font-bold">Intent eval</h1>
        <span className="lx-11 lx-mut">{totals.reviewed}/{totals.total} reviewed · {totals.skipped} skipped</span>
      </div>

      <div className="lx-card2 flex flex-wrap items-center gap-3 p-3.5">
        <label className="lx-10 lx-mut flex items-center gap-2">
          Status
          <LxSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="!w-auto">
            <option value="auto">Unreviewed</option>
            <option value="reviewed">Reviewed</option>
            <option value="skipped">Skipped</option>
            <option value="all">All</option>
          </LxSelect>
        </label>
        <label className="lx-10 lx-mut flex items-center gap-2">
          Auto intent
          <LxSelect value={intentFilter} onChange={(e) => setIntentFilter(e.target.value)} className="!w-auto">
            <option value="all">All</option>
            {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </LxSelect>
        </label>
        <span className="lx-10 lx-mut ml-auto">
          {rows.length ? `${ix + 1} of ${rows.length} in this view` : ""} · keys: A accept · S save · K skip · ← → move
        </span>
      </div>

      {loading ? (
        <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>
      ) : !row ? (
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-2xl">✅</div>
          <p className="lx-11 lx-mut">{totals.total ? "Nothing in this view. Change the filter." : "No rows yet — run node scripts/label-intents.mjs first (lib/eval/README.md)."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="lx-card2 p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <span className={"lx-pill " + STATUS_TONE[row.status]}>{row.status}</span>
              <span className="lx-10 lx-mut">{new Date(row.created_at).toLocaleString()}{row.auto_model ? ` · ${row.auto_model}` : ""}</span>
            </div>
            {row.prior_assistant ? (
              <p className="lx-in lx-11 lx-mut mb-2.5 p-3" style={{ whiteSpace: "pre-wrap" }}>
                <span className="lx-10 mb-1 block font-bold">Mr Lxwa (before)</span>
                {row.prior_assistant}
              </p>
            ) : <p className="lx-10 lx-mut mb-2.5">No assistant turn before this message.</p>}
            <p className="lx-12 rounded-lg p-3 font-semibold" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--lx-cyan)" }}>{row.text}</p>
            {auto ? (
              <p className="lx-10 lx-mut mt-2.5">
                Auto: <b>{auto.intent}</b>{auto.topic ? ` · topic "${auto.topic}"` : ""}{auto.delivery ? ` · ${auto.delivery}` : ""}{auto.when ? ` · when "${auto.when}"` : ""}{auto.is_followup ? ` · follow-up${auto.followup_kind ? ` (${auto.followup_kind})` : ""}` : ""}{auto.ambiguous ? " · ambiguous" : ""}{auto.notes ? ` — ${auto.notes}` : ""}
              </p>
            ) : <p className="lx-10 lx-mut mt-2.5">No auto label (the model call failed for this row).</p>}
          </div>

          <div className="lx-card2 p-4">
            <div className="mb-2.5">
              <label className="lx-10 lx-mut mb-1 block">Intent</label>
              <LxSelect value={form.intent} onChange={(e) => set("intent", e.target.value as IntentLabel["intent"])}>
                {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
              </LxSelect>
            </div>
            <div className="mb-2.5">
              <label className="lx-10 lx-mut mb-1 block">Topic (subject only, blank = none)</label>
              <LxInput value={form.topic ?? ""} onChange={(e) => set("topic", e.target.value || null)} placeholder="e.g. solar panels for homes" />
            </div>
            <div className="mb-2.5 grid grid-cols-2 gap-2.5">
              <div>
                <label className="lx-10 lx-mut mb-1 block">Delivery</label>
                <LxSelect value={form.delivery ?? ""} onChange={(e) => set("delivery", (e.target.value || null) as IntentLabel["delivery"])}>
                  <option value="">not said</option>
                  {DELIVERIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </LxSelect>
              </div>
              <div>
                <label className="lx-10 lx-mut mb-1 block">When (as written)</label>
                <LxInput value={form.when ?? ""} onChange={(e) => set("when", e.target.value || null)} placeholder="30 min baad" />
              </div>
            </div>
            <div className="lx-11 mb-2.5 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="!w-auto" checked={form.is_followup} onChange={(e) => set("is_followup", e.target.checked)} /> Follow-up
              </label>
              <LxSelect
                value={form.followup_kind ?? ""}
                disabled={!form.is_followup}
                onChange={(e) => set("followup_kind", (e.target.value || null) as IntentLabel["followup_kind"])}
                className="!w-auto"
              >
                <option value="">kind…</option>
                {FOLLOWUP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </LxSelect>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="!w-auto" checked={form.ambiguous} onChange={(e) => set("ambiguous", e.target.checked)} /> Ambiguous
              </label>
            </div>
            <div className="mb-3">
              <label className="lx-10 lx-mut mb-1 block">Notes</label>
              <textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                className="lx-12 w-full rounded-lg px-3 py-2"
                style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="lx-ghost" disabled={busy || !auto} onClick={accept} title="A">✓ Accept auto</button>
              <button className="lx-grad lx-11 px-3.5 py-2" disabled={busy} onClick={save} title="S">{differs ? "Save edited" : "Save as is"}</button>
              <button className="lx-ghost" disabled={busy} onClick={skip} title="K">Skip</button>
              <span className="flex-1" />
              <button className="lx-icobtn" disabled={ix === 0} onClick={() => setIx(ix - 1)}>←</button>
              <button className="lx-icobtn" disabled={ix >= rows.length - 1} onClick={() => setIx(ix + 1)}>→</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
