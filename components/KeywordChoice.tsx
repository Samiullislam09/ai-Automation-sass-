"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** Pick the keyword before the article gets written.
 *
 *  "Write an article" used to go straight through — Mr. Keyword researched, something was
 *  picked for you, and Mr. Writer started. You never saw the options.
 *
 *  Every number in this table is measured. DataForSEO's figure is a 12-month AVERAGE of
 *  monthly searches, which is what the column says; Search Console gives impressions for this
 *  site with its current position, which is a different thing and is labelled as one; the AI
 *  fallback has no numbers at all, so its rows show none rather than a plausible-looking
 *  invention. A missing value is a dash.
 *
 *  The countdown is the server's, read from expires_at — not a timer started when this
 *  component happened to mount. The poll can be a few seconds late and the number still tells
 *  the truth about when the writer actually starts. */

type Candidate = {
  keyword: string;
  searchVolume: number | null;
  competitionLevel?: string | null;
  impressions?: number;
  position?: number;
  recommended?: boolean;
  why?: string | null;
};

export default function KeywordChoice() {
  const store = useStore();
  const choice = store?.s?.keywordChoice ?? null;

  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const announced = useRef<string | null>(null);

  // Ticks only while a choice is on screen.
  useEffect(() => {
    if (!choice) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [choice?.id]); // eslint-disable-line

  // Reset per choice. The chat announcement is made by components/LiveAgents.tsx, which is
  // mounted on every page — this panel only exists on the dashboard, and someone reading
  // Reports when the countdown starts still needs to see what they were offered.
  useEffect(() => {
    if (!choice || announced.current === choice.id) return;
    announced.current = choice.id;
    setPicked(choice.chosen ?? null);
    setErr("");
  }, [choice?.id]); // eslint-disable-line

  if (!choice) return null;

  const msLeft = Math.max(0, new Date(choice.expires_at).getTime() - now);
  const secs = Math.ceil(msLeft / 1000);
  const candidates: Candidate[] = Array.isArray(choice.candidates) ? choice.candidates : [];
  const active = picked ?? choice.recommended;

  const pick = async (keyword: string) => {
    if (sending) return;
    setSending(keyword);
    setErr("");
    try {
      const res = await fetch("/api/keyword-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: choice.id, keyword }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? "Could not set that keyword."); return; }
      setPicked(keyword);
      store?.pushChatNotice?.(`You picked "${keyword}" — Mr. Writer will write that one.`, "done");
    } catch (e: any) {
      setErr(e?.message ?? "Network error.");
    } finally {
      setSending("");
    }
  };

  return (
    <div className="kc">
      <div className="kc-head">
        <div className="kc-title">
          <b>Which keyword should Mr. Writer use?</b>
          <div className="kc-sub brk">Researched for “{choice.topic}”</div>
        </div>
        {/* Announced, not just shown. A countdown that decides what gets written is the one
            thing on this panel a screen reader must not miss. */}
        <div className={"kc-count" + (secs <= 3 ? " is-low" : "")} role="status" aria-live="polite">
          {secs > 0 ? <>starts in <b>{secs}s</b></> : <>starting…</>}
        </div>
      </div>

      <div className="kc-scroll">
        <table className="kc-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Avg. searches/mo</th>
              <th>Competition</th>
              <th>On your site</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              // A row here IS a control — it decides what gets written. It was a bare
              // <tr onClick>: no keyboard, no focus ring, and nothing telling anyone it
              // could be pressed at all.
              <tr
                key={c.keyword}
                className={(active === c.keyword ? "is-on " : "") + (sending === c.keyword ? "is-busy" : "")}
                onClick={() => pick(c.keyword)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(c.keyword); } }}
                role="button"
                tabIndex={0}
                aria-pressed={active === c.keyword}
                aria-label={`Use the keyword ${c.keyword}`}
              >
                <td>
                  <span className="kc-kw brk">{c.keyword}</span>
                  {c.recommended && <span className="kc-badge" title={c.why ?? undefined}>Recommended</span>}
                  {active === c.keyword && <span className="kc-tick">✓</span>}
                </td>
                {/* A dash is the honest answer for a source that doesn't measure this. */}
                <td>{c.searchVolume != null ? c.searchVolume.toLocaleString() : "—"}</td>
                <td>{c.competitionLevel ? c.competitionLevel.toLowerCase() : "—"}</td>
                <td>
                  {c.impressions != null
                    ? `${c.impressions} impr.${c.position != null ? ` · pos ${c.position.toFixed(1)}` : ""}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Why this one — a number, not a vibe. */}
      {candidates.find((c) => c.recommended)?.why && (
        <p className="kc-why">Recommended: {candidates.find((c) => c.recommended)?.why}</p>
      )}
      {err && <p className="kc-err">{err}</p>}
      <p className="kc-foot">
        {picked
          ? `“${picked}” it is — Mr. Writer starts on it when the countdown ends.`
          : "Click a row to choose. Do nothing and the recommended one starts by itself."}
      </p>

      <style jsx>{`
        /* Sits inside the office frame (app/app/page.tsx), which fades back behind it — the
           same treatment a finished job gets. It was a floating card over the whole viewport
           before, which covered the team instead of replacing it. */
        .kc { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
              padding: clamp(14px, 3vw, 30px); overflow-y: auto;
              background: color-mix(in srgb, var(--bg2) 94%, transparent);
              backdrop-filter: blur(3px);
              animation: kc-in .38s cubic-bezier(.2,.8,.3,1); }
        @keyframes kc-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }

        .kc-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px;
                   flex-wrap: wrap; }
        /* The title needs a floor before it is allowed to wrap. Without one the countdown chip
           squeezed it to two words a line on a phone and then dropped below it anyway. */
        .kc-title { flex: 1 1 220px; min-width: 0; }
        .kc-head b { font-size: clamp(15px, 2.2vw, 19px); color: var(--ink); }
        .kc-sub { font-size: 11.5px; color: var(--mut2); margin-top: 3px; }
        .kc-count { margin-left: auto; flex: none; font-size: 12px; color: var(--mut);
                    background: var(--panel); border: 1px solid var(--line);
                    border-radius: 999px; padding: 6px 13px; }
        .kc-count b { color: var(--ac); font-variant-numeric: tabular-nums; }
        .kc-count.is-low b { color: var(--amb); }

        /* The table scrolls inside its own box — four columns on a phone must not push the
           panel sideways. */
        .kc-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px;
                     background: var(--panel); }
        .kc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 460px; }
        .kc-table th { text-align: left; font-size: 9.5px; letter-spacing: .5px; color: var(--mut2);
                       font-weight: 700; padding: 10px 12px 8px; white-space: nowrap;
                       border-bottom: 1px solid var(--line); }
        .kc-table td { padding: 11px 12px; border-top: 1px solid var(--line); color: var(--mut);
                       white-space: nowrap; }
        .kc-table tbody tr { cursor: pointer; transition: background .15s; }
        .kc-table tbody tr:hover td { background: var(--panel2); }
        .kc-table tbody tr:focus-visible { outline: 2px solid var(--ac); outline-offset: -2px; }
        .kc-table tr.is-on td { background: color-mix(in srgb, var(--ac) 12%, transparent); color: var(--ink); }
        .kc-table tr.is-busy { opacity: .5; }
        .kc-kw { color: var(--ink); font-weight: 600; white-space: normal; }
        .kc-badge { display: inline-block; margin-left: 8px; font-size: 9px; font-weight: 800;
                    letter-spacing: .3px; color: #fff; background: var(--ac);
                    border-radius: 999px; padding: 2px 7px; vertical-align: middle; }
        .kc-tick { margin-left: 7px; color: var(--ac); font-weight: 800; }
        .kc-why { font-size: 11.5px; color: var(--mut2); margin: 11px 0 0; line-height: 1.55; }
        .kc-err { font-size: 12px; color: #ff6b6b; margin: 9px 0 0; }
        .kc-foot { font-size: 11.5px; color: var(--mut); margin: 9px 0 0; }

        /* These two lines used to be DELETED below 480px tall. One of them is the evidence for
           the recommendation, the other is the only place it says that doing nothing still
           picks one — so on a landscape phone you got a table of keywords and no explanation
           of what was about to happen to your site. The panel already scrolls; it can carry
           them. Tighten the spacing instead. */
        @media (max-height: 480px) {
          .kc { padding-top: 12px; padding-bottom: 12px; }
          .kc-head { margin-bottom: 10px; }
          .kc-table th { padding: 8px 10px 6px; }
          .kc-table td { padding: 9px 10px; }
        }
      `}</style>
    </div>
  );
}
