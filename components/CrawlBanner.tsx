"use client";
import { useStore } from "@/lib/store";

/** "Reading your site — 24 of 300 pages."
 *
 *  The crawl is the longest thing this product does. It walks up to ~300 pages, embeds each
 *  one, and is paced under NVIDIA's per-minute limit, so ten minutes is a normal run — and it
 *  has no room in the office, so until now there was nothing on screen saying it was
 *  happening. The only symptom was that nothing appeared to be happening.
 *
 *  Every number here is the crawler's own count, written to its jobs_log row as it goes
 *  (see AgentContext in agent-server/src/agents/base.ts). There is no fake ticking: if the
 *  crawler hasn't reported a page yet, the bar hasn't moved either. It sits in the app shell
 *  so it's visible from every page, and disappears the moment the job stops running. */
export default function CrawlBanner() {
  const store = useStore();
  const c = store?.s?.crawl ?? null;
  if (!c) return null;

  const pct = c.total > 0 ? Math.min(100, Math.round((c.done / c.total) * 100)) : null;

  const line =
    c.total > 0
      ? `Reading your site — ${c.done} of ${c.total} pages`
      : c.label ?? "Reading your site…";

  return (
    <div className="crawlbar" role="status" aria-live="polite">
      <span className="cb-spin" />
      <div className="cb-text">
        <b>{line}</b>
        {/* The URL currently being fetched. Host stripped — the path is the useful part and
            the full URL pushes everything else off a narrow screen. */}
        {c.current && <span className="cb-url">{String(c.current).replace(/^https?:\/\//, "")}</span>}
        {!c.current && c.label && c.total > 0 && <span className="cb-url">{c.label}</span>}
      </div>

      {pct !== null && (
        <div className="cb-track" aria-label={`${pct}% complete`}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {pct !== null && <span className="cb-pct">{pct}%</span>}

      <style jsx>{`
        .crawlbar { display: flex; align-items: center; gap: 11px; flex: none;
                    padding: 8px clamp(12px, 2.2vw, 24px);
                    background: color-mix(in srgb, var(--ac) 10%, var(--bg2));
                    border-bottom: 1px solid var(--line); min-width: 0; }
        .cb-spin { width: 13px; height: 13px; flex: none; border-radius: 50%;
                   border: 2px solid color-mix(in srgb, var(--ac) 35%, transparent);
                   border-top-color: var(--ac); animation: cb-turn .8s linear infinite; }
        @keyframes cb-turn { to { transform: rotate(360deg); } }
        .cb-text { display: flex; align-items: baseline; gap: 9px; min-width: 0; flex: 1; }
        .cb-text b { font-size: 12px; color: var(--ink); font-weight: 700; flex: none; }
        .cb-url { font-size: 10.5px; color: var(--mut2); min-width: 0;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cb-track { flex: none; width: clamp(80px, 18vw, 200px); height: 5px; border-radius: 3px;
                    background: var(--line2); overflow: hidden; }
        .cb-track i { display: block; height: 100%; border-radius: 3px; background: var(--ac);
                      transition: width .6s ease; }
        .cb-pct { font-size: 11px; font-weight: 700; color: var(--ac); flex: none;
                  font-variant-numeric: tabular-nums; }
        @media (max-width: 640px) { .cb-url, .cb-track { display: none; } }
      `}</style>
    </div>
  );
}
