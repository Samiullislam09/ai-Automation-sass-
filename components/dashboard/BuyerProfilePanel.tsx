"use client";

import { useCallback, useEffect, useState } from "react";

/** The Buyer Profile screen (high-quality-leads plan, Phase 1).
 *
 *  Site Brain says what the business IS. This screen is where the client confirms who BUYS from
 *  them — the segments Mr. Lead will actually go looking for — and, just as important, who merely
 *  looks like them (competitors) so those get screened out. Mr. Lxwa drafts it from the Site
 *  Brain; the client edits and CONFIRMS; only then will an Auto lead run search. Nothing here is
 *  hardcoded to any industry — every word comes from the tenant's own profile via the drafter.
 *
 *  Matches the Leads page's light surface (off-theme from the dark dashboard) so the two read as
 *  one product. All writes go through /api/leads/buyer-profile. */

const C = {
  bg: "#f6f7f9", panel: "#ffffff", ink: "#0f172a", sub: "#64748b", line: "#e9edf2",
  brand: "#4f46e5", brandSoft: "#eef2ff", green: "#16a34a", greenSoft: "#e7f6ec",
  amber: "#d97706", amberSoft: "#fdf2e3", red: "#dc2626", redSoft: "#fdeaea", graySoft: "#f1f5f9",
};

const LEAD_GOALS = ["customer", "sponsor", "partner", "distributor", "other"] as const;

type Evidence = { from: string; quote: string | null };
type BuyerSegment = { name: string; why_buy: string; search_terms: string[]; evidence: Evidence };
type CompetitorSegment = { name: string; cues: string[]; evidence: Evidence };
type BuyingSignal = { name: string; look_for: string; weight: number; evidence: Evidence | null };
type BuyerProfile = {
  offer: string | null;
  lead_goal: (typeof LEAD_GOALS)[number] | null;
  buyer_segments: BuyerSegment[];
  competitor_segments: CompetitorSegment[];
  buying_signals: BuyingSignal[];
  geo_scope: string[];
  confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  drafted_by: string | null;
  drafted_at: string | null;
};

type LoadState = {
  hasSiteBrain: boolean;
  buyerProfile: BuyerProfile | null;
  ready: boolean;
};

function emptyProfile(): BuyerProfile {
  return { offer: "", lead_goal: null, buyer_segments: [], competitor_segments: [], buying_signals: [], geo_scope: [], confirmed: false, confirmed_by: null, confirmed_at: null, drafted_by: null, drafted_at: null };
}

export default function BuyerProfilePanel({ open, onClose, toast, onConfirmedChange }: {
  open: boolean;
  onClose: () => void;
  toast: (m: string, t?: "error") => void;
  onConfirmedChange?: (ready: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "draft" | "save" | "confirm">(null);
  const [state, setState] = useState<LoadState | null>(null);
  const [bp, setBp] = useState<BuyerProfile>(emptyProfile());
  const [dirty, setDirty] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/leads/buyer-profile").then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Could not load your ideal customers.", "error"); setLoading(false); return; }
      const st: LoadState = { hasSiteBrain: !!d.hasSiteBrain, buyerProfile: d.buyerProfile ?? null, ready: !!d.ready };
      setState(st);
      setBp(st.buyerProfile ? { ...emptyProfile(), ...st.buyerProfile } : emptyProfile());
      setDirty(false);
      setWarnings([]);
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const edit = (patch: Partial<BuyerProfile>) => { setBp((p) => ({ ...p, ...patch })); setDirty(true); };

  const draft = async () => {
    if (bp.buyer_segments.length && !confirm("Re-draft from your website? This replaces the current segments with a fresh suggestion you can then edit.")) return;
    setBusy("draft");
    try {
      const d = await fetch("/api/leads/buyer-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft" }) }).then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Could not draft your ideal customers.", "error"); return; }
      setBp({ ...emptyProfile(), ...d.buyerProfile });
      setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      setDirty(false);
      setState((s) => (s ? { ...s, buyerProfile: d.buyerProfile, ready: false } : s));
      onConfirmedChange?.(false);
      toast("Drafted from your site — review the buyer vs competitor segments, then Confirm.");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setBusy("save");
    try {
      const d = await fetch("/api/leads/buyer-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", buyerProfile: bp }) }).then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Could not save.", "error"); return; }
      setBp({ ...emptyProfile(), ...d.buyerProfile });
      setDirty(false);
      setState((s) => (s ? { ...s, buyerProfile: d.buyerProfile, ready: false } : s));
      onConfirmedChange?.(false);
      toast("Saved — Mr. Lead will use this. (Confirm is optional, just marks it as reviewed.)");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(null); }
  };

  const confirmProfile = async () => {
    if (!bp.buyer_segments.length) { toast("Add at least one buyer segment first.", "error"); return; }
    setBusy("confirm");
    try {
      const d = await fetch("/api/leads/buyer-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", buyerProfile: bp }) }).then((r) => r.json());
      if (!d.ok) { toast(d.error ?? "Could not confirm.", "error"); return; }
      setBp({ ...emptyProfile(), ...d.buyerProfile });
      setDirty(false);
      setState((s) => (s ? { ...s, buyerProfile: d.buyerProfile, ready: !!d.ready } : s));
      onConfirmedChange?.(!!d.ready);
      toast("Confirmed. Mr. Lead will now look for these buyers.");
    } catch (e: any) { toast(e?.message ?? "Network error.", "error"); }
    finally { setBusy(null); }
  };

  const confirmed = !!state?.buyerProfile?.confirmed && !dirty;

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" style={{ background: "rgba(15,23,42,.35)", colorScheme: "light" }} onClick={onClose}>
      <style>{`
        .lx-bp-input{background:#fff !important;color:#0f172a !important;color-scheme:light}
        .lx-bp-input::placeholder{color:#94a3b8}
        .lx-bp-input:-webkit-autofill,.lx-bp-input:-webkit-autofill:hover,.lx-bp-input:-webkit-autofill:focus{
          -webkit-box-shadow:0 0 0 1000px #fff inset !important;-webkit-text-fill-color:#0f172a !important;caret-color:#0f172a;transition:background-color 9999s}
        .lx-bp-input:focus{outline:none !important;box-shadow:none !important}
      `}</style>
      <div className="flex h-full w-full max-w-[560px] flex-col" style={{ background: C.bg, color: C.ink }} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold" style={{ color: C.ink }}>Ideal Customers</h2>
            <p className="truncate text-[12px]" style={{ color: C.sub }}>Who buys from you — so Mr. Lead finds buyers, not competitors.</p>
          </div>
          <div className="flex items-center gap-2">
            {confirmed ? (
              <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ background: C.greenSoft, color: C.green }}>Confirmed ✓</span>
            ) : state?.buyerProfile ? (
              <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ background: C.brandSoft, color: C.brand }}>Draft · in use</span>
            ) : null}
            <button onClick={onClose} className="rounded-full p-1.5" style={{ background: C.graySoft, color: C.sub }} aria-label="Close">✕</button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="py-20 text-center text-[13px]" style={{ color: C.sub }}>Loading…</div>
          ) : !state?.hasSiteBrain ? (
            <EmptyNote title="No Site Brain yet" body="Run the website analysis first (Settings → Site Brain, or the crawler). Once Mr. Analyst has read your site, I can draft who buys from you." />
          ) : !state.buyerProfile ? (
            <div className="space-y-4">
              <EmptyNote title="No ideal customers set yet" body="I'll read your Site Brain and suggest the kinds of organisations that would BUY what you offer, plus the peers to screen out. You can edit everything — no need to confirm." />
              <button onClick={draft} disabled={busy !== null} className="w-full rounded-xl py-2.5 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: C.brand }}>
                {busy === "draft" ? "Drafting from your site…" : "Draft from my site"}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {warnings.length > 0 && (
                <div className="rounded-xl p-3 text-[12px]" style={{ background: C.amberSoft, color: C.amber }}>
                  {warnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {/* offer + goal + geo */}
              <Field label="What you offer">
                <textarea value={bp.offer ?? ""} onChange={(e) => edit({ offer: e.target.value })} rows={2} autoComplete="off" className="lx-bp-input w-full resize-none rounded-lg px-3 py-2 text-[13px] outline-none" style={{ border: `1px solid ${C.line}` }} placeholder="What this business sells or provides" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="A “lead” means">
                  <select value={bp.lead_goal ?? ""} onChange={(e) => edit({ lead_goal: (e.target.value || null) as BuyerProfile["lead_goal"] })} className="lx-bp-input w-full rounded-lg px-3 py-2 text-[13px] outline-none" style={{ border: `1px solid ${C.line}` }}>
                    <option value="">—</option>
                    {LEAD_GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </Field>
                <Field label="Where to target">
                  <ChipInput values={bp.geo_scope} onChange={(v) => edit({ geo_scope: v })} placeholder="city / country" />
                </Field>
              </div>

              {/* buyer segments */}
              <SectionHeader title="Buyer segments" hint="Organisations that BUY your offer. Mr. Lead searches for these." count={bp.buyer_segments.length}
                onAdd={() => edit({ buyer_segments: [...bp.buyer_segments, { name: "", why_buy: "", search_terms: [], evidence: { from: "user", quote: null } }] })} />
              {bp.buyer_segments.length === 0 && <EmptyRow text="No buyer segments — add one, or draft from your site." />}
              {bp.buyer_segments.map((s, i) => (
                <Card key={i} onDelete={() => edit({ buyer_segments: bp.buyer_segments.filter((_, j) => j !== i) })} from={s.evidence?.from}>
                  <Line value={s.name} onChange={(v) => edit({ buyer_segments: patch(bp.buyer_segments, i, { name: v }) })} placeholder="Segment name (e.g. Manufacturers)" bold />
                  <Line value={s.why_buy} onChange={(v) => edit({ buyer_segments: patch(bp.buyer_segments, i, { why_buy: v }) })} placeholder="Why they buy" />
                  <label className="mt-1 block text-[11px]" style={{ color: C.sub }}>Search terms</label>
                  <ChipInput values={s.search_terms} onChange={(v) => edit({ buyer_segments: patch(bp.buyer_segments, i, { search_terms: v }) })} placeholder="generic category to search" />
                </Card>
              ))}

              {/* competitor segments */}
              <SectionHeader title="Competitors to screen out" hint="Peers that SELL the same thing. Matched by the cues below and dropped." count={bp.competitor_segments.length}
                onAdd={() => edit({ competitor_segments: [...bp.competitor_segments, { name: "", cues: [], evidence: { from: "user", quote: null } }] })} />
              {bp.competitor_segments.length === 0 && <EmptyRow text="No competitor cues yet." />}
              {bp.competitor_segments.map((s, i) => (
                <Card key={i} onDelete={() => edit({ competitor_segments: bp.competitor_segments.filter((_, j) => j !== i) })} from={s.evidence?.from}>
                  <Line value={s.name} onChange={(v) => edit({ competitor_segments: patch(bp.competitor_segments, i, { name: v }) })} placeholder="Competitor type" bold />
                  <label className="mt-1 block text-[11px]" style={{ color: C.sub }}>Name / website cues</label>
                  <ChipInput values={s.cues} onChange={(v) => edit({ competitor_segments: patch(bp.competitor_segments, i, { cues: v }) })} placeholder="word found in their name/site" />
                </Card>
              ))}

              {/* buying signals */}
              <SectionHeader title="Buying signals" hint="Things on a prospect's site that suggest they need you." count={bp.buying_signals.length}
                onAdd={() => edit({ buying_signals: [...bp.buying_signals, { name: "", look_for: "", weight: 5, evidence: { from: "user", quote: null } }] })} />
              {bp.buying_signals.length === 0 && <EmptyRow text="No signals yet." />}
              {bp.buying_signals.map((s, i) => (
                <Card key={i} onDelete={() => edit({ buying_signals: bp.buying_signals.filter((_, j) => j !== i) })} from={s.evidence?.from}>
                  <Line value={s.name} onChange={(v) => edit({ buying_signals: patch(bp.buying_signals, i, { name: v }) })} placeholder="Signal name" bold />
                  <Line value={s.look_for} onChange={(v) => edit({ buying_signals: patch(bp.buying_signals, i, { look_for: v }) })} placeholder="What to look for on their site" />
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: C.sub }}>Weight</span>
                    <input type="range" min={1} max={10} value={s.weight} onChange={(e) => edit({ buying_signals: patch(bp.buying_signals, i, { weight: Number(e.target.value) }) })} className="flex-1" />
                    <span className="w-6 text-right text-[12px] font-semibold" style={{ color: C.ink }}>{s.weight}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* footer actions */}
        {!loading && state?.hasSiteBrain && state.buyerProfile && (
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: C.panel, borderTop: `1px solid ${C.line}` }}>
            <button onClick={draft} disabled={busy !== null} className="rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:opacity-60" style={{ background: C.graySoft, color: C.sub }}>
              {busy === "draft" ? "Drafting…" : "Re-draft"}
            </button>
            <div className="flex-1" />
            <button onClick={save} disabled={busy !== null || !dirty} className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-50" style={{ background: C.brandSoft, color: C.brand, border: `1px solid ${C.brand}` }}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button onClick={confirmProfile} disabled={busy !== null || !bp.buyer_segments.length} className="rounded-xl px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: C.green }}>
              {busy === "confirm" ? "Confirming…" : confirmed ? "Re-confirm" : "Confirm"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function patch<T>(arr: T[], i: number, p: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...p } : x));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold" style={{ color: C.sub }}>{label}</label>
      {children}
    </div>
  );
}

function SectionHeader({ title, hint, count, onAdd }: { title: string; hint: string; count: number; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <div className="min-w-0">
        <div className="text-[13px] font-bold" style={{ color: C.ink }}>{title} <span className="font-normal" style={{ color: C.sub }}>· {count}</span></div>
        <div className="text-[11.5px]" style={{ color: C.sub }}>{hint}</div>
      </div>
      <button onClick={onAdd} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: C.brandSoft, color: C.brand }}>+ Add</button>
    </div>
  );
}

function Card({ children, onDelete, from }: { children: React.ReactNode; onDelete: () => void; from?: string }) {
  return (
    <div className="relative rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
        <button onClick={onDelete} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold" style={{ background: C.redSoft, color: C.red }} aria-label="Delete">Delete</button>
      </div>
      {from && <div className="mt-2 text-[10.5px]" style={{ color: C.sub }}>from: {from}</div>}
    </div>
  );
}

function Line({ value, onChange, placeholder, bold }: { value: string; onChange: (v: string) => void; placeholder?: string; bold?: boolean }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off"
      className="lx-bp-input w-full rounded-lg px-2.5 py-1.5 text-[13px] outline-none" style={{ border: `1px solid ${C.line}`, fontWeight: bold ? 600 : 400 }} />
  );
}

/** A comma/Enter chip editor over a string[] — stored as the array, edited as tokens. */
function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setText("");
  };
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px]" style={{ background: C.brandSoft, color: C.brand }}>
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="font-bold" aria-label={`Remove ${v}`}>×</button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={values.length ? "" : placeholder}
          autoComplete="off"
          className="lx-bp-input min-w-[80px] flex-1 text-[12.5px] outline-none"
          style={{ border: "none" }}
        />
      </div>
    </div>
  );
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl p-4 text-center" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="text-[14px] font-bold" style={{ color: C.ink }}>{title}</div>
      <div className="mt-1 text-[12.5px]" style={{ color: C.sub }}>{body}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: C.panel, border: `1px dashed ${C.line}`, color: C.sub }}>{text}</div>;
}
