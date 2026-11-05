/** The article reviewer has no sidebar (it gets the whole viewport, on a light canvas), so it gets
 *  its own placeholder: a slim top bar, a white sheet with title and text lines, and the rail.
 *  It shows the moment the page is requested, while the server reads the article. */
export default function ArticleLoading() {
  return (
    <div className="als" aria-busy="true" aria-label="Opening the article">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="als-bar">
        <div className="als-b" style={{ width: 90, height: 28 }} />
        <div className="als-b" style={{ width: 160, height: 14, marginLeft: 8 }} />
        <div style={{ flex: 1 }} />
        <div className="als-b" style={{ width: 110, height: 32 }} />
      </div>
      <div className="als-wrap">
        <article className="als-sheet">
          <div className="als-b" style={{ height: 30, width: "88%" }} />
          <div className="als-b" style={{ height: 30, width: "60%", marginTop: 10 }} />
          <div className="als-b" style={{ height: 12, width: 220, marginTop: 18 }} />
          <div className="als-lines">
            {[100, 96, 99, 70, 100, 94, 98, 62].map((w, i) => (
              <div key={i} className="als-b" style={{ height: 12, width: `${w}%`, marginTop: i === 4 ? 26 : 0 }} />
            ))}
          </div>
        </article>
        <aside className="als-rail">
          <div className="als-b" style={{ height: 44 }} />
          {[0, 1, 2, 3].map((i) => <div key={i} className="als-b" style={{ height: 52 }} />)}
        </aside>
      </div>
    </div>
  );
}

const CSS = `
.als{min-height:100vh;background:#f2f4f7}
.als-bar{display:flex;align-items:center;gap:10px;height:56px;padding:0 16px;background:#fff;border-bottom:1px solid #e5e7eb}
.als-wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;max-width:1180px;margin:0 auto;padding:24px 16px}
.als-sheet{padding:36px 40px;border-radius:14px;background:#fff;border:1px solid #e5e7eb}
.als-lines{display:grid;gap:12px;margin-top:28px}
.als-rail{display:grid;gap:10px;align-content:start}
.als-b{border-radius:8px;background:linear-gradient(90deg,#eceff4 25%,#e1e5ec 50%,#eceff4 75%);background-size:200% 100%;animation:alsShim 1.3s linear infinite}
@keyframes alsShim{to{background-position:-200% 0}}
@media (max-width:900px){.als-wrap{grid-template-columns:minmax(0,1fr)}.als-rail{display:none}.als-sheet{padding:22px 18px}}
@media (prefers-reduced-motion:reduce){.als-b{animation:none}}
`;
