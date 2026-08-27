"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { DELIVERIES, FOLLOWUP_KINDS, INTENTS, normalizeLabel, type IntentLabel } from "@/lib/eval/intent-labels";

/** /app/eval — review the auto-labelled intent set, one message at a time.
 *
 *  The model labelled every real user message (scripts/label-intents.mjs); a person confirms
 *  or corrects each one here. Keyboard: A accept · S save edits · K skip · J/→ next · ←
 *  previous. The human label is what the next intent engine is scored against
 *  (lib/eval/README.md). */

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

const STATUS_PILL: Record<Row["status"], string> = { auto: "st-wait", reviewed: "st-pub", skipped: "st-draft" };

export default function EvalPage() {
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
  // The form starts from the human label if there is one, else the auto label.
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
    <>
      <div className="pg-head" style={{ flexWrap: "wrap", gap: 10 }}>
        <h1 className="pg-h1">Intent eval</h1>
        <span className="sm mut">{totals.reviewed}/{totals.total} reviewed · {totals.skipped} skipped</span>
      </div>

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label className="xs mut">Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ width: "auto", marginLeft: 8, padding: "6px 10px" }}>
            <option value="auto">Unreviewed</option>
            <option value="reviewed">Reviewed</option>
            <option value="skipped">Skipped</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="xs mut">Auto intent
          <select value={intentFilter} onChange={(e) => setIntentFilter(e.target.value)} style={{ width: "auto", marginLeft: 8, padding: "6px 10px" }}>
            <option value="all">All</option>
            {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <span className="xs mut" style={{ marginLeft: "auto" }}>
          {rows.length ? `${ix + 1} of ${rows.length} in this view` : ""} · keys: A accept · S save · K skip · ← → move
        </span>
      </div>

      {loading ? (
        <div className="card emptycard"><p className="mut sm">Loading…</p></div>
      ) : !row ? (
        <div className="card emptycard">
          <div className="ic">✅</div>
          <p className="mut sm">{totals.total ? "Nothing in this view. Change the filter." : "No rows yet — run node scripts/label-intents.mjs first (lib/eval/README.md)."}</p>
        </div>
      ) : (
        <div className="listgrid" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)" }}>
          <div className="card">
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span className={`pillst ${STATUS_PILL[row.status]}`}>{row.status}</span>
              <span className="xs mut">{new Date(row.created_at).toLocaleString()}{row.auto_model ? ` · ${row.auto_model}` : ""}</span>
            </div>
            {row.prior_assistant ? (
              <p className="sm mut brk" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: "0 0 10px", whiteSpace: "pre-wrap" }}>
                <span className="xs" style={{ display: "block", marginBottom: 4, fontWeight: 700 }}>Mr Lxwa (before)</span>
                {row.prior_assistant}
              </p>
            ) : <p className="xs mut" style={{ margin: "0 0 10px" }}>No assistant turn before this message.</p>}
            <p className="brk" style={{ fontSize: 15, fontWeight: 600, whiteSpace: "pre-wrap", margin: 0, padding: 12, border: "1px solid var(--ac)", borderRadius: 10 }}>{row.text}</p>
            {auto ? (
              <p className="xs mut" style={{ marginTop: 10, marginBottom: 0 }}>
                Auto: <b>{auto.intent}</b>{auto.topic ? ` · topic "${auto.topic}"` : ""}{auto.delivery ? ` · ${auto.delivery}` : ""}{auto.when ? ` · when "${auto.when}"` : ""}{auto.is_followup ? ` · follow-up${auto.followup_kind ? ` (${auto.followup_kind})` : ""}` : ""}{auto.ambiguous ? " · ambiguous" : ""}{auto.notes ? ` — ${auto.notes}` : ""}
              </p>
            ) : <p className="xs mut" style={{ marginTop: 10 }}>No auto label (the model call failed for this row).</p>}
          </div>

          <div className="card">
            <div className="field" style={{ marginTop: 0 }}>
              <label>Intent</label>
              <select value={form.intent} onChange={(e) => set("intent", e.target.value as IntentLabel["intent"])}>
                {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Topic (subject only, blank = none)</label>
              <input value={form.topic ?? ""} onChange={(e) => set("topic", e.target.value || null)} placeholder="e.g. solar panels for homes" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>Delivery</label>
                <select value={form.delivery ?? ""} onChange={(e) => set("delivery", (e.target.value || null) as IntentLabel["delivery"])}>
                  <option value="">not said</option>
                  {DELIVERIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="field">
                <label>When (as written)</label>
                <input value={form.when ?? ""} onChange={(e) => set("when", e.target.value || null)} placeholder="30 min baad" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }} className="sm">
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.is_followup} onChange={(e) => set("is_followup", e.target.checked)} /> Follow-up
              </label>
              <select value={form.followup_kind ?? ""} disabled={!form.is_followup} onChange={(e) => set("followup_kind", (e.target.value || null) as IntentLabel["followup_kind"])} style={{ width: "auto", padding: "6px 10px" }}>
                <option value="">kind…</option>
                {FOLLOWUP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.ambiguous} onChange={(e) => set("ambiguous", e.target.checked)} /> Ambiguous
              </label>
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </div>
            <div className="btnrow">
              <button className="btn btn-g btn-sm" disabled={busy || !auto} onClick={accept} title="A">✓ Accept auto</button>
              <button className="btn btn-p btn-sm" disabled={busy} onClick={save} title="S">{differs ? "Save edited" : "Save as is"}</button>
              <button className="btn btn-sm" disabled={busy} onClick={skip} title="K">Skip</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" disabled={ix === 0} onClick={() => setIx(ix - 1)}>←</button>
              <button className="btn btn-sm" disabled={ix >= rows.length - 1} onClick={() => setIx(ix + 1)}>→</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
