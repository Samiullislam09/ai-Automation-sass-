"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/leads — the CRM. Mr. Lead (agent-server/agents/leads.ts) writes a row per
 *  qualified lead as `pending_approval`; this page is where a human APPROVES the good ones (the
 *  one gate the whole outreach flow hinges on), and where the pipeline is read at a glance.
 *
 *  A COMPACT TABLE, NOT CARDS (owner, 2026-09-30: "CRM jaisa table, kam space pe, bahut sare
 *  leads"). Rows are dense and scannable — company, contact, score, why, stage, added, actions —
 *  sortable by score or freshness. Sending still never happens here: an approved lead's action
 *  is a link to the WhatsApp inbox, where a human sends one message at a time. */

type Lead = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp?: string | null;
  website?: string | null;
  city?: string | null;
  source: string | null;
  icp_score: number | null;
  reason: string | null;
  channel?: string | null;
  draft?: string | null;
  stage: string;
  created_at: string;
};

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["pending_approval", "Waiting for you"],
  ["approved", "Approved"],
  ["contacted", "Messaged"],
  ["replied", "Replied"],
  ["won", "Won"],
  ["rejected", "Rejected"],
];

const STAGE_LABEL: Record<string, { label: string; tone: string }> = {
  new: { label: "NEW", tone: "blue" },
  pending_approval: { label: "WAITING", tone: "amber" },
  approved: { label: "APPROVED", tone: "green" },
  rejected: { label: "REJECTED", tone: "mut" },
  queued: { label: "QUEUED", tone: "blue" },
  contacted: { label: "MESSAGED", tone: "blue" },
  delivered: { label: "DELIVERED", tone: "blue" },
  read: { label: "READ", tone: "violet" },
  replied: { label: "REPLIED", tone: "green" },
  in_conversation: { label: "IN CHAT", tone: "cyan" },
  interested: { label: "INTERESTED", tone: "cyan" },
  won: { label: "WON", tone: "green" },
  lost: { label: "LOST", tone: "mut" },
  opted_out: { label: "OPTED OUT", tone: "red" },
  invalid: { label: "INVALID", tone: "mut" },
  failed: { label: "FAILED", tone: "red" },
};

function bandTone(score: number | null): string {
  if (score == null) return "mut";
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "mut";
}

type SortKey = "score" | "date";

export default function LeadsSection() {
  const { toast } = useStore();
  const [items, setItems] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [addOpen, setAddOpen] = useState(false);

  const load = () => {
    setItems(null);
    fetch(`/api/leads?stage=${filter}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setItems(d.items); else setErr(d.error ?? "Could not load your leads."); })
      .catch((e) => setErr(e?.message ?? "Network error."));
  };
  useEffect(load, [filter]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(k); setDir("desc"); }
  };

  const sorted = useMemo(() => {
    if (!items) return [];
    const copy = [...items];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort === "score") cmp = (a.icp_score ?? -1) - (b.icp_score ?? -1);
      else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [items, sort, dir]);

  const copyDraft = async (l: Lead) => {
    try {
      await navigator.clipboard.writeText(l.draft ?? "");
      toast("Copied — paste it wherever you like.");
    } catch {
      toast("Couldn't copy — select the text manually.", "error");
    }
  };

  const setStage = async (l: Lead, stage: string) => {
    setBusy(l.id);
    try {
      const res = await fetch(`/api/leads/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const d = await res.json();
      if (!d.ok) { toast(d.error ?? "Couldn't update.", "error"); return; }
      setItems((prev) => prev?.map((x) => (x.id === l.id ? { ...x, stage } : x)) ?? prev);
      toast("Updated.");
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setBusy(null);
    }
  };

  const rowActions = (l: Lead) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {l.stage === "pending_approval" && (
        <>
          <button className="lx-grad lx-10 rounded-full px-3 py-1.5 font-semibold" disabled={busy === l.id} onClick={() => setStage(l, "approved")}>Approve</button>
          <button className="lx-10 rounded-full px-2.5 py-1.5" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "#f87171" }} disabled={busy === l.id} onClick={() => setStage(l, "rejected")}>Reject</button>
        </>
      )}
      {l.stage === "approved" && (
        <a className="lx-grad lx-10 rounded-full px-3 py-1.5 font-semibold" href="/dashboard/whatsapp" style={{ textDecoration: "none" }}>Message</a>
      )}
      {["contacted", "delivered", "read", "replied", "in_conversation", "interested"].includes(l.stage) && (
        <a className="lx-10 rounded-full px-3 py-1.5" href="/dashboard/whatsapp" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)", textDecoration: "none" }}>Open chat</a>
      )}
      {l.draft && (l.stage === "pending_approval" || l.stage === "approved") && (
        <button className="lx-10 rounded-full px-2.5 py-1.5" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }} onClick={() => copyDraft(l)} title="Copy the drafted message">Copy</button>
      )}
      {!["opted_out", "rejected", "won", "lost"].includes(l.stage) && (
        <button className="lx-10 rounded-full px-2 py-1.5" style={{ background: "transparent", color: "var(--lx-mut)" }} disabled={busy === l.id} onClick={() => setStage(l, "opted_out")} title="Do not contact — ever">✕</button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Leads</h1>
          <p className="lx-11 lx-mut mt-1">
            Mr. Lead finds and scores these. <b>You approve the good ones</b> — only approved leads can be messaged,
            and messaging happens on WhatsApp, one at a time, by you.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {items && (
            <span className="lx-10 lx-mut rounded-full px-2.5 py-1" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}>
              {items.length}
            </span>
          )}
          <button className="lx-grad lx-11 rounded-full px-3.5 py-1.5 font-semibold" onClick={() => setAddOpen(true)}>+ Add lead</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            className="lx-11 rounded-full px-3.5 py-1.5 font-semibold transition"
            style={
              filter === k
                ? { background: "var(--lx-cyan)", color: "#04101a" }
                : { background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }
            }
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {err && <p className="lx-11" style={{ color: "#f87171" }}>{err}</p>}

      {items === null ? (
        <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>
      ) : items.length === 0 ? (
        <div className="lx-card2 flex flex-col items-center gap-2 p-10 text-center">
          <div className="text-2xl">🧭</div>
          <p className="lx-11 lx-mut">
            {filter === "all"
              ? 'No leads yet — ask in chat "find me leads for restaurants in Dubai", or set a daily leads schedule, and Mr. Lead starts filling this.'
              : "Nothing in this state."}
          </p>
        </div>
      ) : (
        <>
        {/* desktop: dense CRM table */}
        <div className="lx-card2 hidden overflow-hidden md:block" style={{ padding: 0 }}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 760 }}>
              <thead>
                <tr className="lx-10 lx-mut" style={{ textAlign: "left", borderBottom: "1px solid var(--lx-border)" }}>
                  <Th>Company</Th>
                  <Th>Contact</Th>
                  <Th sortable onClick={() => toggleSort("score")} active={sort === "score"} dir={dir}>Score</Th>
                  <Th>Why</Th>
                  <Th>Stage</Th>
                  <Th sortable onClick={() => toggleSort("date")} active={sort === "date"} dir={dir}>Added</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((l) => {
                  const st = STAGE_LABEL[l.stage] ?? { label: l.stage.toUpperCase(), tone: "mut" };
                  const num = l.whatsapp || l.phone || "";
                  return (
                    <tr key={l.id} className="align-top" style={{ borderBottom: "1px solid var(--lx-border)" }}>
                      <td className="px-3 py-2.5">
                        <b className="lx-12 block max-w-[180px] truncate">{l.company || l.name || "Untitled"}</b>
                        <span className="lx-10 lx-mut block max-w-[180px] truncate">{l.source ?? "—"}{l.city ? ` · ${l.city}` : ""}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="lx-11 block max-w-[150px] truncate">{num || <span className="lx-mut">no number</span>}</span>
                        {l.website && (
                          <a className="lx-10 block max-w-[150px] truncate" style={{ color: "var(--lx-cyan)" }} href={l.website} target="_blank" rel="noreferrer">
                            {l.website.replace(/^https?:\/\//, "")}
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={"lx-pill " + bandTone(l.icp_score)}>{l.icp_score ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="lx-11 lx-mut block max-w-[240px]" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {l.reason || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5"><span className={"lx-pill " + st.tone}>{st.label}</span></td>
                      <td className="px-3 py-2.5"><span className="lx-10 lx-mut" style={{ whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleDateString()}</span></td>
                      <td className="px-3 py-2.5">{rowActions(l)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* mobile: one card per lead */}
        <div className="space-y-2.5 md:hidden">
          {sorted.map((l) => {
            const st = STAGE_LABEL[l.stage] ?? { label: l.stage.toUpperCase(), tone: "mut" };
            const num = l.whatsapp || l.phone || "";
            return (
              <div key={l.id} className="lx-card2 p-3.5">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <b className="lx-13 min-w-0 flex-1 truncate">{l.company || l.name || "Untitled"}</b>
                  <span className={"lx-pill shrink-0 " + bandTone(l.icp_score)}>{l.icp_score ?? "—"}</span>
                </div>
                <div className="lx-10 lx-mut mb-1.5">{l.source ?? "—"}{l.city ? ` · ${l.city}` : ""}{num ? ` · ${num}` : ""}</div>
                {l.reason && <p className="lx-11 lx-mut mb-2" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{l.reason}</p>}
                <div className="mb-2.5"><span className={"lx-pill " + st.tone}>{st.label}</span></div>
                {rowActions(l)}
              </div>
            );
          })}
        </div>
        </>
      )}

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} toast={toast} />
    </div>
  );
}

/** A header cell, optionally a sort toggle. */
function Th({ children, sortable, onClick, active, dir }: { children: React.ReactNode; sortable?: boolean; onClick?: () => void; active?: boolean; dir?: "asc" | "desc" }) {
  return (
    <th
      className="px-3 py-2.5 font-semibold"
      style={{ whiteSpace: "nowrap", cursor: sortable ? "pointer" : "default", color: active ? "var(--lx-text)" : undefined, userSelect: "none" }}
      onClick={onClick}
    >
      {children}
      {sortable && <span className="ml-1" style={{ opacity: active ? 1 : 0.35 }}>{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>}
    </th>
  );
}

/** Manually add a lead — a company/person + number you want in the pipeline. It lands as
 *  `approved` (you added it, that IS the approval), so it can be messaged straight away. */
function AddLeadModal({ open, onClose, onAdded, toast }: { open: boolean; onClose: () => void; onAdded: () => void; toast: (m: string, t?: "error") => void }) {
  const [f, setF] = useState({ company: "", phone: "", city: "", website: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setF({ company: "", phone: "", city: "", website: "" });
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
      const r = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: f.company.trim(), phone: f.phone.replace(/[^0-9+]/g, ""), city: f.city.trim(), website: f.website.trim() }),
      }).then((x) => x.json());
      if (!r.ok) { toast(r.error ?? "Could not add the lead.", "error"); return; }
      toast("Lead added — approved and ready to message.");
      onAdded();
    } catch (e: any) {
      toast(e?.message ?? "Network error.", "error");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof f, label: string, ph: string, required = false) => (
    <div className="mb-3">
      <label className="lx-11 lx-mut mb-1 block">{label}{required && " *"}</label>
      <input
        className="lx-12 w-full rounded-xl px-3.5 py-2.5 outline-none"
        style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)" }}
        placeholder={ph}
        value={f[key]}
        onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="lx-card w-full max-w-sm rounded-3xl p-6" style={{ border: "1px solid var(--lx-border)" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold">Add a lead</h2>
        <p className="lx-11 lx-mut mt-1 mb-4">It goes straight to Approved, so you can message it right away.</p>
        {field("company", "Company or name", "Gulf Steel LLC", true)}
        {field("phone", "Phone (with country code)", "+971 50 123 4567", true)}
        {field("city", "City", "Dubai")}
        {field("website", "Website", "gulfsteel.ae")}
        <div className="flex justify-end gap-2">
          <button className="lx-11 rounded-full px-4 py-2" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-mut)" }} onClick={onClose}>Cancel</button>
          <button className="lx-grad lx-12 rounded-full px-5 py-2 font-semibold disabled:opacity-60" onClick={save} disabled={busy}>{busy ? "Adding…" : "Add lead"}</button>
        </div>
      </div>
    </div>
  );
}
