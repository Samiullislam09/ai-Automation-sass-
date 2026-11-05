/** Shown inside the shell's content area while a page's data is read. The sidebar and chat stay
 *  exactly where they are, so moving between pages never blanks the screen. */
export default function PageLoading() {
  return (
    <div className="pgs" aria-busy="true" aria-label="Loading">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="pgs-b" style={{ height: 26, width: 180 }} />
      <div className="pgs-b" style={{ height: 12, width: 260, marginTop: 8 }} />
      <div className="pgs-tiles">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="pgs-b" style={{ height: 60 }} />)}
      </div>
      <div className="pgs-rows">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="pgs-b" style={{ height: 76 }} />)}
      </div>
    </div>
  );
}

const CSS = `
.pgs{padding:16px}
.pgs-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:16px}
.pgs-rows{display:grid;gap:12px;margin-top:14px}
.pgs-b{border-radius:12px;background:linear-gradient(90deg,var(--lx-border) 25%,rgba(139,92,246,.12) 50%,var(--lx-border) 75%);background-size:200% 100%;animation:pgsShim 1.3s linear infinite}
@keyframes pgsShim{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.pgs-b{animation:none}}
`;
