"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AGENTS, useStore } from "@/lib/store";

/** The "it's done" takeover.
 *
 *  When an agent finishes, the office slides away and the result fills the screen: what was
 *  produced, and — for research — which queries were chosen and on what evidence.
 *
 *  EVERY WORD HERE IS A REAL jobs_log ROW. `summary` and `items` are built by describeJob()
 *  in lib/dashboard-data.ts from what the agent actually returned, so a keyword card lists
 *  the queries that were really used and says which source they came from. There is no
 *  placeholder copy and no example data: if a job produced no items, the card shows none. */

const NAME = Object.fromEntries(AGENTS.map((a) => [a.id, a.name]));

// What the agent produced, in the words the result deserves. Only agents that can actually
// finish a job are listed — anything else falls back to a neutral heading.
const HEADLINE: Record<string, { done: string; failed: string }> = {
  writer: { done: "Article written", failed: "Article failed" },
  kw: { done: "Keyword research done", failed: "Keyword research failed" },
  boss: { done: "Topics planned", failed: "Planning failed" },
  qa: { done: "Quality check done", failed: "Quality check failed" },
  publish: { done: "Published", failed: "Publishing failed" },
};

const AUTO_DISMISS_MS = 9000;

export default function Celebration() {
  const store = useStore();
  const c = store?.s?.celebration ?? null;
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!c) return;
    setLeaving(false);
    // It gets out of the way on its own — this sits on top of the office, and a card you
    // must dismiss to see your own dashboard is worse than no card.
    const t = setTimeout(() => setLeaving(true), AUTO_DISMISS_MS);
    const gone = setTimeout(() => store?.patch?.({ celebration: null }), AUTO_DISMISS_MS + 420);
    return () => { clearTimeout(t); clearTimeout(gone); };
  }, [c?.id]); // eslint-disable-line

  if (!c) return null;

  const failed = c.status === "error";
  const head = HEADLINE[c.agentId]?.[failed ? "failed" : "done"] ?? (failed ? "Job failed" : "Job done");
  const who = NAME[c.agentId] ?? "Your team";

  return (
    <div className={"celeb" + (leaving ? " is-leaving" : "") + (failed ? " is-fail" : "")}>
      <button className="celeb-x" onClick={() => store?.patch?.({ celebration: null })} aria-label="Close">✕</button>

      <div className="celeb-mark">{failed ? "!" : "✓"}</div>
      <div className="celeb-who">{who}</div>
      <h2 className="celeb-head">{head}</h2>

      {/* The one-line result, straight from the job's own return value. */}
      <p className="celeb-sum">{c.summary}</p>

      {c.items?.length > 0 && (
        <ul className="celeb-items">
          {c.items.slice(0, 8).map((it: string, i: number) => <li key={i}>{it}</li>)}
        </ul>
      )}

      <div className="celeb-actions">
        {c.agentId === "writer" && !failed && <Link href="/app/approvals" className="celeb-go">Review it →</Link>}
        {failed && <Link href="/app" className="celeb-go" onClick={() => store?.patch?.({ celebration: null })}>Back to the office</Link>}
        <button className="celeb-dismiss" onClick={() => store?.patch?.({ celebration: null })}>Dismiss</button>
      </div>

      <style jsx>{`
        .celeb { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
                 align-items: center; justify-content: center; text-align: center; gap: 5px;
                 padding: 26px clamp(18px, 5vw, 54px);
                 background: color-mix(in srgb, var(--bg2) 94%, transparent);
                 backdrop-filter: blur(3px);
                 animation: celeb-in .42s cubic-bezier(.2,.8,.3,1); }
        .celeb.is-leaving { animation: celeb-out .4s ease forwards; }
        @keyframes celeb-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes celeb-out { to { opacity: 0; transform: scale(1.02); } }

        .celeb-x { position: absolute; top: 14px; right: 16px; background: none; border: none;
                   color: var(--mut2); font-size: 15px; cursor: pointer; }
        .celeb-x:hover { color: var(--ink); }

        .celeb-mark { width: 62px; height: 62px; border-radius: 50%; display: grid; place-items: center;
                      font-size: 30px; font-weight: 800; color: #fff; margin-bottom: 6px;
                      background: var(--grn); box-shadow: 0 0 0 0 color-mix(in srgb, var(--grn) 55%, transparent);
                      animation: celeb-pulse 1.6s ease-out 2; }
        .celeb.is-fail .celeb-mark { background: var(--red);
                                     box-shadow: 0 0 0 0 color-mix(in srgb, var(--red) 55%, transparent); }
        @keyframes celeb-pulse { to { box-shadow: 0 0 0 26px transparent; } }

        .celeb-who { font-size: 11.5px; font-weight: 700; letter-spacing: .5px; color: var(--mut2);
                     text-transform: uppercase; }
        .celeb-head { font-size: clamp(22px, 4vw, 34px); font-weight: 800; color: var(--ink); margin: 0; }
        .celeb-sum { font-size: 13.5px; color: var(--mut); margin: 6px 0 0; max-width: 620px; line-height: 1.6; }

        .celeb-items { list-style: none; margin: 14px 0 0; padding: 0; max-width: 620px;
                       display: flex; flex-direction: column; gap: 5px; width: 100%; }
        .celeb-items li { font-size: 12px; color: var(--ink); background: var(--panel);
                          border: 1px solid var(--line); border-radius: 9px; padding: 7px 11px;
                          text-align: left; }

        .celeb-actions { display: flex; gap: 9px; align-items: center; margin-top: 18px; flex-wrap: wrap;
                         justify-content: center; }
        .celeb-go { background: var(--ac); color: #fff; font-size: 12px; font-weight: 700;
                    padding: 9px 16px; border-radius: 9px; }
        .celeb-dismiss { background: none; border: 1px solid var(--line2); color: var(--mut);
                         font-size: 12px; font-weight: 600; padding: 8px 15px; border-radius: 9px;
                         cursor: pointer; }
        .celeb-dismiss:hover { color: var(--ink); border-color: var(--mut2); }

        @media (max-height: 520px) {
          .celeb-mark { width: 46px; height: 46px; font-size: 22px; }
          .celeb-items { display: none; }
        }
      `}</style>
    </div>
  );
}
