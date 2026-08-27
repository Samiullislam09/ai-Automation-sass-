"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";

/** The Site audit report and its trend (MASTER_PLAN §7.4).
 *
 *  §7.4 asks for two things a customer can act on: "top-5 issues plain language me, aur score
 *  trend (pichhle audit se +/-)". Both are here, in that order, because the score is only
 *  interesting as a direction — 68 means nothing on its own, 68 after 61 means the work is
 *  landing.
 *
 *  Two rules the page keeps, both of them the same rule really:
 *
 *   · IT NEVER SHOWS A NUMBER NOBODY MEASURED. The report's `skipped` list is rendered, not
 *     hidden — today it says Core Web Vitals were not measured because there is no browser to
 *     measure them with. A gap the customer can see is a promise kept; a gap filled with an
 *     estimate is the thing this product cannot afford to do once.
 *   · IT NEVER FIXES ANYTHING. Every row is a finding and a fix in words. Acting on one is a
 *     separate decision a person makes.
 */

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

export default function AuditPage() {
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
    <div className="pg-head au-head">
      <div>
        <h1 className="pg-h1">Site audit</h1>
        <p className="xs mut" style={{ margin: "4px 0 0", maxWidth: 560 }}>
          What&apos;s broken, hidden from Google, or costing you traffic across the whole site. Runs itself every week.
        </p>
      </div>
      <div className="btnrow">
        <button className="btn btn-g btn-sm" disabled={starting} onClick={runAudit}>{starting ? "Starting…" : "Check my site now"}</button>
        <Link href="/app/workspace" className="btn btn-sm">Watch it work →</Link>
      </div>
    </div>
  );

  if (loading && !state) return <>{head}<div className="card emptycard"><p className="mut sm">Loading…</p></div><Styles /></>;

  if (state && !state.schemaReady) {
    return (
      <>
        {head}
        <div className="card emptycard">
          <div className="ic">🧩</div>
          <b style={{ display: "block", marginBottom: 6 }}>Not set up on this database yet</b>
          <p className="mut sm">Migration 020 hasn&apos;t been applied here, so there&apos;s nowhere to file a report.</p>
        </div>
        <Styles />
      </>
    );
  }

  const r = state?.latest ?? null;

  if (!r) {
    return (
      <>
        {head}
        <div className="card emptycard">
          <div className="ic">🩺</div>
          <b style={{ display: "block", marginBottom: 6 }}>No audit yet</b>
          <p className="mut sm" style={{ maxWidth: 460, margin: "0 auto" }}>
            Run one now, or leave it — we check every week on our own and tell you when something changes.
          </p>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-p btn-sm" disabled={starting} onClick={runAudit}>{starting ? "Starting…" : "Check my site now"}</button>
          </div>
        </div>
        <Styles />
      </>
    );
  }

  const diff = r.previousScore === null ? null : r.score - r.previousScore;
  const issues = [...r.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);

  return (
    <>
      {head}

      <div className="card au-top">
        <div className="au-score">
          <b className={"au-n " + tone(r.score)}>{r.score}</b>
          <span className="xs mut">out of 100</span>
        </div>
        <div className="au-facts">
          <p className="au-trend">
            {diff === null
              ? "First audit — there's nothing to compare it to yet."
              : diff === 0
                ? `No change since the last audit (${r.previousScore}).`
                : diff > 0
                  ? `Up ${diff} since the last audit (was ${r.previousScore}).`
                  : `Down ${Math.abs(diff)} since the last audit (was ${r.previousScore}).`}
          </p>
          <p className="xs mut" style={{ margin: "6px 0 0" }}>
            {r.pagesChecked} pages checked · {r.blocks} serious · {r.warns} worth improving · {new Date(r.createdAt).toLocaleString()}
          </p>
          {state!.history.length > 1 && <Trend points={state!.history} />}
        </div>
      </div>

      <div className="listgrid">
        {issues.length ? (
          issues.map((i) => (
            <div key={i.id} className="card">
              <div className="au-row">
                <span className={"au-sev " + i.severity}>{i.severity === "block" ? "Fix first" : i.severity === "warn" ? "Improve" : "Note"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b className="brk" style={{ fontSize: 14, display: "block" }}>{i.what}</b>
                  <p className="sm mut" style={{ margin: "6px 0 0" }}>{i.fix}</p>
                </div>
              </div>
              {i.pages?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button className="au-link" onClick={() => setOpen(open === i.id ? null : i.id)}>
                    {open === i.id ? "hide" : "show"} {i.count > i.pages.length ? `${i.pages.length} of ${i.count}` : `${i.count}`} {i.count === 1 ? "page" : "pages"}
                  </button>
                  {open === i.id && (
                    <ul className="au-pages">
                      {i.pages.map((p) => (
                        <li key={p}>
                          <a href={p} target="_blank" rel="noreferrer noopener">{p}</a>
                        </li>
                      ))}
                      {i.count > i.pages.length && <li className="xs mut">…and {i.count - i.pages.length} more</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="card emptycard">
            <div className="ic">✨</div>
            <p className="mut sm">Nothing to fix — every check passed.</p>
          </div>
        )}
      </div>

      {r.skipped.length > 0 && (
        <div className="card au-skipped">
          <b style={{ fontSize: 13 }}>What this audit did not measure</b>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {r.skipped.map((s, n) => (
              <li key={n} className="xs mut" style={{ marginBottom: 4 }}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <Styles />
    </>
  );
}

/** The trend, as bars. Deliberately not a charting library: twenty numbers between 0 and 100
 *  are a row of divs, and a dependency for that would be the tail wagging the dog. */
function Trend({ points }: { points: { id: string; score: number; createdAt: string }[] }) {
  return (
    <div className="au-trendbars" aria-label="Audit score over time">
      {points.map((p) => (
        <span key={p.id} className={"au-bar " + tone(p.score)} style={{ height: `${Math.max(4, p.score)}%` }} title={`${p.score}/100 · ${new Date(p.createdAt).toLocaleDateString()}`} />
      ))}
    </div>
  );
}

function tone(score: number): string {
  return score >= 85 ? "good" : score >= 60 ? "ok" : "bad";
}

function Styles() {
  return (
    <style jsx global>{`
      .au-head { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
      .au-top { display: flex; gap: 22px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
      .au-score { text-align: center; min-width: 92px; }
      .au-n { font-size: 40px; display: block; line-height: 1; }
      .au-n.good { color: #34d399; } .au-n.ok { color: #fbbf24; } .au-n.bad { color: #f87171; }
      .au-facts { flex: 1; min-width: 220px; }
      .au-trend { margin: 0; font-size: 14px; }
      .au-trendbars { display: flex; align-items: flex-end; gap: 3px; height: 44px; margin-top: 12px; }
      .au-bar { width: 8px; border-radius: 2px 2px 0 0; background: var(--line2); }
      .au-bar.good { background: #34d399; } .au-bar.ok { background: #fbbf24; } .au-bar.bad { background: #f87171; }
      .au-row { display: flex; gap: 12px; align-items: flex-start; }
      .au-sev { font-size: 11px; border-radius: 999px; padding: 3px 9px; white-space: nowrap; border: 1px solid var(--line); }
      .au-sev.block { color: #f87171; border-color: #f87171; }
      .au-sev.warn { color: #fbbf24; border-color: #fbbf24; }
      .au-link { background: none; border: 0; padding: 0; color: var(--acc); cursor: pointer; font: inherit; font-size: 12px; text-decoration: underline; }
      .au-pages { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
      .au-pages a { font-size: 12px; word-break: break-all; }
      .au-skipped { margin-top: 20px; }
    `}</style>
  );
}
