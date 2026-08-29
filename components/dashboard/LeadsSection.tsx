"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/leads — the page agent-server's Mr. Lead (agents/leads.ts) has been writing rows
 *  for since it shipped (DONE 2026-08-27, MASTER_PLAN §7.6) but that never had a screen: every
 *  qualified lead lands in the real `leads` table via /api/leads, researched, scored and with a
 *  draft outreach message written — nothing sent. §7.6's compliance rule is why there is no
 *  Send button here: outreach only ever goes out in Phase 3+, and always after a human sends it
 *  themselves. This page is read + copy + a CRM-style status note, same shape as Approvals'
 *  copy-only social drafts. */

type Lead = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website?: string | null;
  domain?: string | null;
  source: string | null;
  icp_score: number | null;
  reason: string | null;
  channel?: string | null;
  draft?: string | null;
  observation?: string | null;
  stage: string;
  created_at: string;
};

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["draft", "New drafts"],
  ["contacted", "Contacted"],
  ["do_not_contact", "Do not contact"],
  ["skipped", "Skipped"],
];

const STAGE_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: "DRAFT — NOT SENT", tone: "amber" },
  contacted: { label: "CONTACTED", tone: "green" },
  do_not_contact: { label: "DO NOT CONTACT", tone: "red" },
  skipped: { label: "SKIPPED", tone: "mut" },
  new: { label: "NEW", tone: "blue" },
};

function bandTone(score: number | null): string {
  if (score == null) return "mut";
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "mut";
}

export default function LeadsSection() {
  const { toast } = useStore();
  const [items, setItems] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    setItems(null);
    fetch(`/api/leads?stage=${filter}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setItems(d.items); else setErr(d.error ?? "Could not load your leads."); })
      .catch((e) => setErr(e?.message ?? "Network error."));
  };
  useEffect(load, [filter]);

  const copyDraft = async (l: Lead) => {
    try {
      await navigator.clipboard.writeText(l.draft ?? "");
      toast("Copied — paste it into your email or DM.");
    } catch {
      toast("Couldn't copy — select and copy the text manually.", "error");
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
      <div>
        <h1 className="text-lg font-bold">Leads</h1>
        <p className="lx-11 lx-mut mt-1">
          Researched, scored and a message drafted — nothing sent. Copy a draft and send it yourself, or mark what you already did.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            className="lx-11 rounded-full px-3.5 py-2 font-semibold transition"
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items === null ? (
          <div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div>
        ) : items.length ? items.map((l) => {
          const st = STAGE_LABEL[l.stage] ?? { label: l.stage.toUpperCase(), tone: "mut" };
          return (
            <div key={l.id} className="lx-card2 flex flex-col p-4">
              <div className="mb-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <b className="lx-12 block truncate">{l.company || l.name || "Untitled lead"}</b>
                  <div className="lx-10 lx-mut mt-0.5 truncate">
                    {l.name && l.company ? `${l.name} · ` : ""}{l.source ?? "unknown source"} · {new Date(l.created_at).toLocaleDateString()}
                  </div>
                </div>
                {l.icp_score != null && (
                  <span className={"lx-pill " + bandTone(l.icp_score)}>{l.icp_score}/100</span>
                )}
              </div>

              <span className={"lx-pill mb-2.5 self-start " + st.tone}>{st.label}</span>

              {l.reason && <p className="lx-11 lx-mut mb-2">{l.reason}</p>}

              <div className="lx-11 mb-2 space-y-0.5">
                {l.email && <div className="truncate">✉️ {l.email}</div>}
                {l.phone && <div className="truncate">📞 {l.phone}</div>}
                {(l.website || l.domain) && (
                  <a href={l.website ?? `https://${l.domain}`} target="_blank" rel="noreferrer" className="block truncate underline" style={{ color: "var(--lx-cyan)" }}>
                    🔗 {l.website ?? l.domain}
                  </a>
                )}
              </div>

              {l.observation && <p className="lx-10 lx-mut mb-2 italic">&ldquo;{l.observation}&rdquo;</p>}

              {l.draft && (
                <p className="lx-in lx-11 mb-2 p-3" style={{ whiteSpace: "pre-wrap" }}>
                  {l.channel && <span className="lx-10 mb-1 block font-bold uppercase tracking-wide" style={{ color: "var(--lx-cyan)" }}>{l.channel}</span>}
                  {l.draft}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                {l.draft && <button className="lx-grad lx-11 px-3.5 py-2" onClick={() => copyDraft(l)}>Copy draft</button>}
                {l.stage !== "contacted" && (
                  <button className="lx-ghost" disabled={busy === l.id} onClick={() => setStage(l, "contacted")}>I contacted them</button>
                )}
                {l.stage !== "do_not_contact" && (
                  <button className="lx-ghost" style={{ color: "#f87171" }} disabled={busy === l.id} onClick={() => setStage(l, "do_not_contact")}>Do not contact</button>
                )}
                {l.stage !== "skipped" && l.stage !== "do_not_contact" && (
                  <button className="lx-ghost" disabled={busy === l.id} onClick={() => setStage(l, "skipped")}>Skip</button>
                )}
              </div>
            </div>
          );
        }) : (
          <div className="lx-card2 col-span-full flex flex-col items-center gap-2 p-8 text-center">
            <div className="text-2xl">🧭</div>
            <p className="lx-11 lx-mut">
              {filter === "all"
                ? "No leads yet — ask in chat, e.g. \"find me leads for restaurants in Dubai\", and the team starts researching."
                : "Nothing in this state."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
