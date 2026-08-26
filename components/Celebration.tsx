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
      <button className="iconbtn celeb-x" onClick={() => store?.patch?.({ celebration: null })} aria-label="Close">✕</button>

      {/* One scrolling column. It used to be a centred stack with no scroll and a media query
          that DELETED the items list below 520px tall — which is a landscape phone, and the
          items are the only place the word count, the sections and the gate's reasons appear.
          Losing real results to make a card fit is not a layout fix. */}
      <div className="celeb-body">
        <div className="celeb-mark">{failed ? "!" : "✓"}</div>
        <div className="celeb-who">{who}</div>
        <h2 className="celeb-head">{head}</h2>

        {/* The one-line result, straight from the job's own return value. */}
        <p className="celeb-sum brk">{c.summary}</p>

        {c.items?.length > 0 && (
          <ul className="celeb-items">
            {c.items.slice(0, 8).map((it: string, i: number) => <li key={i} className="brk">{it}</li>)}
          </ul>
        )}

        <div className="celeb-actions btnrow">
          {c.agentId === "writer" && !failed && <Link href="/app/approvals" className="btn btn-p btn-sm">Review it →</Link>}
          {failed && <Link href="/app" className="btn btn-p btn-sm" onClick={() => store?.patch?.({ celebration: null })}>Back to the office</Link>}
          <button className="btn btn-g btn-sm" onClick={() => store?.patch?.({ celebration: null })}>Dismiss</button>
        </div>
      </div>

      <style jsx>{`
        .celeb { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
                 align-items: center; justify-content: center;
                 background: color-mix(in srgb, var(--bg2) 94%, transparent);
                 backdrop-filter: blur(3px);
                 animation: celeb-in .42s cubic-bezier(.2,.8,.3,1); }
        /* The card scrolls; the backdrop does not. Eight items plus a long article title on a
           short screen used to be clipped by the office frame with no way to reach it. */
        .celeb-body { display: flex; flex-direction: column; align-items: center; text-align: center;
                      gap: 5px; width: 100%; max-height: 100%; overflow-y: auto;
                      padding: 30px clamp(16px, 5vw, 54px) 26px; }
        .celeb.is-leaving { animation: celeb-out .4s ease forwards; }
        @keyframes celeb-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes celeb-out { to { opacity: 0; transform: scale(1.02); } }

        /* Was a bare 15px glyph — a ~15px tap target on the one control that dismisses a
           full-screen takeover. .iconbtn is the shared 34px one. */
        .celeb-x { position: absolute; top: 12px; right: 12px; z-index: 1; }

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
        /* Article titles and a failure's "Technical: ..." line are the two longest unbroken
           strings this card ever shows, and neither could wrap. */

        .celeb-items { list-style: none; margin: 14px 0 0; padding: 0; max-width: 620px;
                       display: flex; flex-direction: column; gap: 5px; width: 100%; }
        .celeb-items li { font-size: 12px; color: var(--ink); background: var(--panel);
                          border: 1px solid var(--line); border-radius: 9px; padding: 7px 11px;
                          text-align: left; }

        /* .btn/.btn-sm now, so these follow the app's 38px floor instead of being 31px and
           33px tall and a different shape from every other button in the product. */
        .celeb-actions { margin-top: 18px; justify-content: center; }

        @media (max-height: 520px) {
          .celeb-body { padding-top: 22px; gap: 3px; }
          .celeb-mark { width: 44px; height: 44px; font-size: 21px; margin-bottom: 2px; }
          .celeb-head { font-size: 20px; }
          .celeb-items { margin-top: 10px; }
        }
      `}</style>
    </div>
  );
}
