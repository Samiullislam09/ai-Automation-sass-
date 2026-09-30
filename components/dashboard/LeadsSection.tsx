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
        {items && (
          <span className="lx-10 lx-mut shrink-0 rounded-full px-2.5 py-1" style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)" }}>
            {items.length} lead{items.length === 1 ? "" : "s"}
          </span>
        )}
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
        <div className="lx-card2 overflow-hidden" style={{ padding: 0 }}>
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
                      <td className="px-3 py-2.5">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
