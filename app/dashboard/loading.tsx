/** Shown the instant a dashboard page is requested, while the server checks the session and reads
 *  the data. It has the same silhouette as the real screen (sidebar, header, tiles, rows), so the
 *  page appears to be there at once and fills in, instead of a blank screen and a spinner. */
export default function DashboardLoading() {
  return (
    <div className="lxs" aria-busy="true" aria-label="Loading">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <aside className="lxs-side">
        <div className="lxs-b" style={{ height: 36, width: "70%" }} />
        <div className="lxs-nav">
          {Array.from({ length: 9 }, (_, i) => <div key={i} className="lxs-b" style={{ height: 30 }} />)}
        </div>
      </aside>
      <main className="lxs-main">
        <div className="lxs-b" style={{ height: 26, width: 180 }} />
        <div className="lxs-b" style={{ height: 12, width: 260, marginTop: 8 }} />
        <div className="lxs-tiles">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="lxs-b" style={{ height: 56 }} />)}
        </div>
        <div className="lxs-b" style={{ height: 36, marginTop: 14 }} />
        <div className="lxs-rows">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="lxs-b" style={{ height: 74 }} />)}
        </div>
      </main>
    </div>
  );
}

const CSS = `
.lxs{display:flex;gap:12px;min-height:100vh;padding:12px;background:#06060b}
.light .lxs{background:#f3f6fb}
.lxs-side{width:220px;flex-shrink:0;padding:14px;border-radius:16px;background:#0a0a11;border:1px solid rgba(255,255,255,.07)}
.light .lxs-side,.light .lxs-main{background:#fff;border-color:rgba(22,32,60,.12)}
.lxs-nav{display:grid;gap:8px;margin-top:18px}
.lxs-main{flex:1;min-width:0;padding:18px;border-radius:16px;background:#0a0a11;border:1px solid rgba(255,255,255,.07)}
.lxs-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px;margin-top:16px}
.lxs-rows{display:grid;gap:12px;margin-top:12px}
.lxs-b{border-radius:10px;background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.11) 50%,rgba(255,255,255,.05) 75%);
  background-size:200% 100%;animation:lxsShim 1.3s linear infinite}
.light .lxs-b{background:linear-gradient(90deg,rgba(22,32,60,.05) 25%,rgba(22,32,60,.1) 50%,rgba(22,32,60,.05) 75%);background-size:200% 100%}
@keyframes lxsShim{to{background-position:-200% 0}}
@media (max-width:1023px){.lxs-side{display:none}.lxs{padding:8px}}
@media (prefers-reduced-motion:reduce){.lxs-b{animation:none}}
`;
