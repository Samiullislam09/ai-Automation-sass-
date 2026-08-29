"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** /dashboard/audit ("SEO & Insights") — same real logic and API calls as the old
 *  app/app/audit/page.tsx (kept verbatim: /api/site-audit, /api/agents/trigger for a manual
 *  run, and the two rules noted there — never show a number nobody measured, never auto-fix
 *  anything). Restyled to the new dashboard theme per the owner's standing instruction
 *  (2026-08-29). Rendered inside <MrLxwaDashboard> as its `children` — see
 *  app/dashboard/audit/page.tsx. */

type Issue = { id: string; severity: "block" | "warn" | "info"; what: string; fix: string; pages: string[]; count: number };

type Report = {
  id: string;
  score: number;
  previousScore: number | null;
  pagesChecked: number;
  blocks: number;
  warns: number;
  issues: Issue[];
  skipped: string[];
  seconds: number | null;
  summary: string | null;
  createdAt: string;
};

type Payload = { ok: boolean; schemaReady: boolean; latest: Report | null; history: { id: string; score: number; createdAt: string }[] };

const RANK = { block: 0, warn: 1, info: 2 } as const;

function tone(score: number): "good" | "ok" | "bad" {
  return score >= 85 ? "good" : score >= 60 ? "ok" : "bad";
}
const TONE_COLOR: Record<string, string> = { good: "#34d399", ok: "#fbbf24", bad: "#f87171" };
const SEV_LABEL: Record<Issue["severity"], string> = { block: "Fix first", warn: "Improve", info: "Note" };
const SEV_COLOR: Record<Issue["severity"], string> = { block: "#f87171", warn: "#fbbf24", info: "var(--lx-mut)" };

export default function AuditSection() {
  const { toast } = useStore();
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/site-audit")
      .then((r) => r.json())
      .then((d: Payload) => {
        if (d.ok) setState(d);
        else toast("Couldn't load your audit.", "error");
      })
      .catch(() => toast("Couldn't load your audit — try refreshing.", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const runAudit = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "audit" }),
      });
      const d = await res.json();
      if (d.ok) toast("Checking your site — this takes a few minutes. Watch it in the Workspace.");
      else toast(d.error || "Couldn't start the audit.", "error");
    } catch {
      toast("Couldn't start the audit — network error.", "error");
    } finally {
      setStarting(false);
    }
  };

  const head = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-bold">Site audit</h1>
        <p className="lx-11 lx-mut mt-1" style={{ maxWidth: 560 }}>
          What&apos;s broken, hidden from Google, or costing you traffic across the whole site. Runs itself every week.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="lx-ghost" disabled={starting} onClick={runAudit}>{starting ? "Starting…" : "Check my site now"}</button>
        <Link href="/dashboard/workspace" className="lx-ghost">Watch it work →</Link>
      </div>
    </div>
  );

  if (loading && !state) {
    return <div className="space-y-4">{head}<div className="lx-card2 p-6"><p className="lx-11 lx-mut">Loading…</p></div></div>;
  }

  if (state && !state.schemaReady) {
    return (
      <div className="space-y-4">
        {head}
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-2xl">🧩</div>
          <b className="lx-12">Not set up on this database yet</b>
          <p className="lx-11 lx-mut">Migration 020 hasn&apos;t been applied here, so there&apos;s nowhere to file a report.</p>
        </div>
      </div>
    );
  }

  const r = state?.latest ?? null;

  if (!r) {
    return (
      <div className="space-y-4">
        {head}
        <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-2xl">🩺</div>
          <b className="lx-12">No audit yet</b>
          <p className="lx-11 lx-mut" style={{ maxWidth: 460 }}>
            Run one now, or leave it — we check every week on our own and tell you when something changes.
          </p>
          <button className="lx-grad lx-11 mt-2 px-3.5 py-2" disabled={starting} onClick={runAudit}>
            {starting ? "Starting…" : "Check my site now"}
          </button>
        </div>
      </div>
    );
  }

  const diff = r.previousScore === null ? null : r.score - r.previousScore;
  const issues = [...r.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
  const scoreTone = tone(r.score);

  return (
    <div className="space-y-4">
      {head}

      <div className="lx-card2 flex flex-wrap items-center gap-6 p-4">
        <div className="text-center" style={{ minWidth: 92 }}>
          <b className="block font-extrabold leading-none" style={{ fontSize: 40, color: TONE_COLOR[scoreTone] }}>{r.score}</b>
          <span className="lx-10 lx-mut">out of 100</span>
        </div>
        <div className="min-w-56 flex-1">
          <p className="lx-12">
            {diff === null
              ? "First audit — there's nothing to compare it to yet."
              : diff === 0
                ? `No change since the last audit (${r.previousScore}).`
                : diff > 0
                  ? `Up ${diff} since the last audit (was ${r.previousScore}).`
                  : `Down ${Math.abs(diff)} since the last audit (was ${r.previousScore}).`}
          </p>
          <p className="lx-10 lx-mut mt-1.5">
            {r.pagesChecked} pages checked · {r.blocks} serious · {r.warns} worth improving · {new Date(r.createdAt).toLocaleString()}
          </p>
          {state!.history.length > 1 && <Trend points={state!.history} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        {issues.length ? (
          issues.map((i) => (
            <div key={i.id} className="lx-card2 p-4">
              <div className="flex items-start gap-3">
                <span
                  className="lx-10 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold"
                  style={{ color: SEV_COLOR[i.severity], border: `1px solid ${SEV_COLOR[i.severity]}` }}
                >
                  {SEV_LABEL[i.severity]}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="lx-12 block">{i.what}</b>
                  <p className="lx-11 lx-mut mt-1.5">{i.fix}</p>
                </div>
              </div>
              {i.pages?.length > 0 && (
                <div className="mt-2.5">
                  <button
                    className="lx-11 underline"
                    style={{ color: "var(--lx-cyan)" }}
                    onClick={() => setOpen(open === i.id ? null : i.id)}
                  >
                    {open === i.id ? "hide" : "show"} {i.count > i.pages.length ? `${i.pages.length} of ${i.count}` : `${i.count}`} {i.count === 1 ? "page" : "pages"}
                  </button>
                  {open === i.id && (
                    <ul className="mt-2 space-y-1">
                      {i.pages.map((p) => (
                        <li key={p} className="lx-11" style={{ wordBreak: "break-all" }}>
                          <a href={p} target="_blank" rel="noreferrer noopener" className="underline" style={{ color: "var(--lx-cyan)" }}>{p}</a>
                        </li>
                      ))}
                      {i.count > i.pages.length && <li className="lx-10 lx-mut">…and {i.count - i.pages.length} more</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="lx-card2 flex flex-col items-center gap-2 p-8 text-center">
            <div className="text-2xl">✨</div>
            <p className="lx-11 lx-mut">Nothing to fix — every check passed.</p>
          </div>
        )}
      </div>

      {r.skipped.length > 0 && (
        <div className="lx-card2 p-4">
          <b className="lx-12">What this audit did not measure</b>
          <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: "disc" }}>
            {r.skipped.map((s, n) => (
              <li key={n} className="lx-10 lx-mut">{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The trend, as bars. Deliberately not a charting library: twenty numbers between 0 and 100
 *  are a row of divs, and a dependency for that would be the tail wagging the dog. */
function Trend({ points }: { points: { id: string; score: number; createdAt: string }[] }) {
  return (
    <div className="mt-3 flex items-end gap-1" style={{ height: 44 }} aria-label="Audit score over time">
      {points.map((p) => (
        <span
          key={p.id}
          className="w-2 rounded-t-sm"
          style={{ height: `${Math.max(4, p.score)}%`, background: TONE_COLOR[tone(p.score)] }}
          title={`${p.score}/100 · ${new Date(p.createdAt).toLocaleDateString()}`}
        />
      ))}
    </div>
  );
}
