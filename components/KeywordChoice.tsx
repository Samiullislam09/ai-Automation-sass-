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

  // Reset per choice, and post the options into the chat once — the chat is where people
  // look afterwards to work out what happened and why.
  useEffect(() => {
    if (!choice || announced.current === choice.id) return;
    announced.current = choice.id;
    setPicked(choice.chosen ?? null);
    setErr("");

    const rows = (choice.candidates ?? []).slice(0, 5).map((c: Candidate, i: number) => {
      const parts = [`${i + 1}. ${c.keyword}`];
      if (c.searchVolume != null) parts.push(`${c.searchVolume}/mo`);
      if (c.competitionLevel) parts.push(`${c.competitionLevel.toLowerCase()} competition`);
      if (c.impressions != null) parts.push(`${c.impressions} impressions on your site`);
      if (c.recommended) parts.push("← recommended");
      return parts.join(" · ");
    });
    store?.pushChatNotice?.(
      [`Mr. Keyword's options for "${choice.topic}":`, ...rows, "", "Pick one on the dashboard, or the recommended one starts automatically."].join("\n"),
      "done"
    );
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
        <div>
          <b>Which keyword should Mr. Writer use?</b>
          <div className="kc-sub">Researched for “{choice.topic}”</div>
        </div>
        <div className={"kc-count" + (secs <= 3 ? " is-low" : "")}>
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
              <tr
                key={c.keyword}
                className={(active === c.keyword ? "is-on " : "") + (sending === c.keyword ? "is-busy" : "")}
                onClick={() => pick(c.keyword)}
              >
                <td>
                  <span className="kc-kw">{c.keyword}</span>
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
        .kc { position: fixed; left: 50%; transform: translateX(-50%); bottom: 18px; z-index: 160;
              width: min(680px, calc(100vw - 32px)); background: var(--panel);
              border: 1px solid var(--ac); border-radius: 14px; padding: 14px 16px;
              box-shadow: 0 20px 50px #0007; animation: kc-in .3s cubic-bezier(.2,.8,.3,1); }
        @keyframes kc-in { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .kc-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
        .kc-head b { font-size: 14px; color: var(--ink); }
        .kc-sub { font-size: 11px; color: var(--mut2); margin-top: 2px; }
        .kc-count { margin-left: auto; flex: none; font-size: 11.5px; color: var(--mut);
                    background: var(--panel2); border-radius: 999px; padding: 5px 11px; }
        .kc-count b { color: var(--ac); font-variant-numeric: tabular-nums; }
        .kc-count.is-low b { color: var(--amb); }

        /* The table scrolls inside its own box — four columns on a phone must not push the
           whole card sideways. */
        .kc-scroll { overflow-x: auto; }
        .kc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .kc-table th { text-align: left; font-size: 9.5px; letter-spacing: .5px; color: var(--mut2);
                       font-weight: 700; padding: 0 8px 6px; white-space: nowrap; }
        .kc-table td { padding: 8px; border-top: 1px solid var(--line); color: var(--mut);
                       white-space: nowrap; }
        .kc-table tbody tr { cursor: pointer; }
        .kc-table tbody tr:hover td { background: var(--panel2); }
        .kc-table tr.is-on td { background: color-mix(in srgb, var(--ac) 12%, transparent); color: var(--ink); }
        .kc-table tr.is-busy { opacity: .5; }
        .kc-kw { color: var(--ink); font-weight: 600; white-space: normal; }
        .kc-badge { display: inline-block; margin-left: 8px; font-size: 9px; font-weight: 800;
                    letter-spacing: .3px; color: #fff; background: var(--ac);
                    border-radius: 999px; padding: 2px 7px; vertical-align: middle; }
        .kc-tick { margin-left: 7px; color: var(--ac); font-weight: 800; }
        .kc-why { font-size: 11px; color: var(--mut2); margin: 9px 0 0; line-height: 1.5; }
        .kc-err { font-size: 11.5px; color: #ff6b6b; margin: 8px 0 0; }
        .kc-foot { font-size: 11px; color: var(--mut); margin: 8px 0 0; }

        @media (max-width: 720px) { .kc { bottom: 84px; } }
      `}</style>
    </div>
  );
}
