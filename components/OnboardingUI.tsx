"use client";
import type { ElementType } from "react";
import { BarChart3, PenLine, Search, Send, ShieldCheck } from "lucide-react";

/** Shared pieces between OnboardingWizard.tsx and OnboardingUnderstanding.tsx — kept in their
 *  own file (rather than exported from the wizard) because the wizard already imports FROM
 *  OnboardingUnderstanding.tsx (GoalsStep, UnderstandingStep); the reverse import would make
 *  the two files circular.
 *
 *  Visual language 2026-09-08: a faithful copy of the owner's reference mockup — a two-column
 *  page (brand + feature list on the left, the step card on the right), a numbered step badge
 *  on a dotted track, icon-badged rows and tiles with a radio dot, a green-check note box,
 *  pill Back/Next buttons. Only the chrome and layout are copied; the fields and steps are
 *  ours, and so is the colour (indigo/violet — the dashboard's family). */

export const PALETTE = [
  { bg: "#eef2ff", fg: "#4f46e5" }, // indigo
  { bg: "#f5f0ff", fg: "#7c3aed" }, // violet
  { bg: "#ecfdf5", fg: "#059669" }, // emerald
  { bg: "#eff6ff", fg: "#2563eb" }, // blue
  { bg: "#fffbeb", fg: "#d97706" }, // amber
  { bg: "#fff1f2", fg: "#e11d48" }, // rose
];

/** The brand mark used in both columns — the mockup's three rising bars. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span className="ob-logo" style={{ width: size, height: size }}>
      <BarChart3 size={Math.round(size * 0.58)} />
    </span>
  );
}

/** The left column: the same on every step, straight from the mockup's first screen. */
export function LeftPanel({ step, total }: { step: number; total: number }) {
  const features = [
    { icon: Search, c: PALETTE[0], t: "AI-Powered Strategy", d: "Reads your site, finds opportunities, and plans what to publish next." },
    { icon: PenLine, c: PALETTE[1], t: "Smart Content Creation", d: "Researches keywords, writes high-quality articles, optimized for search engines." },
    { icon: ShieldCheck, c: PALETTE[2], t: "Quality & Safety", d: "Runs a quality gate and gets your approval before anything goes live." },
    { icon: Send, c: PALETTE[3], t: "Auto Publish", d: "Posts directly to WordPress or your webhook — with full transparency and control." },
  ];
  return (
    <aside className="ob-left">
      <div className="ob-brand">
        <BrandMark size={44} />
        <div>
          <b className="ob-brand-t">MrLxwa</b>
          <small className="ob-brand-s">GrowthTeam AI</small>
        </div>
      </div>

      <span className="ob-pillbadge">Welcome to MrLxwa 👋</span>
      <h1 className="ob-hero">
        Your AI Marketing<br />Team for <span className="ob-grad">Real Growth</span>
      </h1>
      <p className="ob-herosub">
        We analyze your website, find the best keywords, write SEO-friendly articles, and publish them — all with human approval at every step.
      </p>

      <ul className="ob-features">
        {features.map((f) => (
          <li key={f.t}>
            <span className="ob-fico" style={{ background: f.c.bg, color: f.c.fg }}><f.icon size={20} /></span>
            <div>
              <b>{f.t}</b>
              <p>{f.d}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="ob-foot">Built for small businesses. Powered by AI. Focused on your growth.</p>

      <div className="ob-leftdots">
        {Array.from({ length: total }).map((_, i) => <i key={i} className={i === step ? "on" : i < step ? "done" : ""} />)}
        <span>{String(step + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
      </div>
    </aside>
  );
}

/** The numbered step badge on a dotted track — the mockup's "1 ─●─●─●" header. */
export function StepTrack({ step, total }: { step: number; total: number }) {
  return (
    <div className="ob-track">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className="ob-track-item">
          {i === step ? <span className="ob-stepnum">{i + 1}</span> : <span className={`ob-tdot${i < step ? " done" : ""}`} />}
          {i < total - 1 && <i className={`ob-seg${i < step ? " done" : ""}`} />}
        </span>
      ))}
    </div>
  );
}

/** One selectable row: icon badge, title + optional subtitle, a radio dot on the right. */
export function OptRow({
  icon: Icon,
  title,
  subtitle,
  active,
  colorIndex = 0,
  onClick,
}: {
  icon?: ElementType;
  title: string;
  subtitle?: string;
  active: boolean;
  colorIndex?: number;
  onClick: () => void;
}) {
  const c = PALETTE[colorIndex % PALETTE.length];
  return (
    <button type="button" className={`ob-optrow${active ? " active" : ""}`} onClick={onClick}>
      {Icon && (
        <span className="ob-opticon" style={{ background: c.bg, color: c.fg }}>
          <Icon size={17} />
        </span>
      )}
      <span className="ob-optbody">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </span>
      <span className="ob-radio" />
    </button>
  );
}

/** One selectable tile: icon above a label, in a grid — the mockup's niche picker. */
export function OptTile({
  icon: Icon,
  title,
  active,
  colorIndex = 0,
  onClick,
}: {
  icon: ElementType;
  title: string;
  active: boolean;
  colorIndex?: number;
  onClick: () => void;
}) {
  const c = PALETTE[colorIndex % PALETTE.length];
  return (
    <button type="button" className={`ob-tile${active ? " active" : ""}`} onClick={onClick}>
      <span className="ob-opticon" style={{ background: c.bg, color: c.fg }}><Icon size={18} /></span>
      <b>{title}</b>
    </button>
  );
}

/* Shared between the onboarding and the auth pages (BrandMark). The blurred colour blobs that
   used to live here were removed 2026-09-08 — the owner didn't like them; the background is
   the mockup's quiet off-white with one soft blue sweep on the right, nothing more. */
export const SHARED_CSS = `
.ob-logo{display:inline-flex;align-items:center;justify-content:center;border-radius:10px;
  background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;flex-shrink:0}
/* Chrome paints autofilled inputs a grey-blue of its own; keep ours white with our text colour. */
input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus{
  -webkit-box-shadow:0 0 0 1000px #fff inset;-webkit-text-fill-color:#0f172a;caret-color:#0f172a;
  transition:background-color 9999s ease-out 0s}
/* The page ground: off-white with a faint dot grid and a soft indigo wash at the top — texture,
   not colour blobs. */
.ob-ground{background-color:#f7f8fc;
  background-image:radial-gradient(circle at 1px 1px,rgba(99,102,241,.13) 1px,transparent 0),
    linear-gradient(180deg,rgba(232,236,255,.95) 0%,rgba(247,248,252,0) 42%);
  background-size:24px 24px,100% 100%}
`;

/* Light theme, two columns. Injected with dangerouslySetInnerHTML — React escapes ">" inside a
   <style> text child, which turns every child selector into a hydration mismatch. */
export const ONBOARDING_CSS = SHARED_CSS + `
.ob-page{position:relative;min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#0f172a}
.ob-page::before{content:"";position:absolute;right:0;top:0;width:52%;height:100%;pointer-events:none;
  background:linear-gradient(160deg,rgba(219,234,254,.45),rgba(237,233,254,.25));clip-path:ellipse(72% 82% at 100% 42%)}
.ob-left,.ob-right{position:relative;z-index:1;min-height:0}
.ob-left{display:flex;flex-direction:column;padding:28px 32px 24px 48px;max-width:600px;overflow:hidden}
.ob-right{display:flex;align-items:center;justify-content:center;padding:20px 36px}
.ob-brand{display:flex;align-items:center;gap:10px}
.ob-brand-t{display:block;font-size:22px;font-weight:800;line-height:1.1;letter-spacing:-.01em}
.ob-brand-s{display:block;font-size:13px;color:#64748b;line-height:1.3}
.ob-card .ob-brand-t{font-size:14px}
.ob-card .ob-brand-s{font-size:10.5px}
.ob-pillbadge{align-self:flex-start;margin-top:28px;padding:6px 13px;border-radius:999px;background:#eef2ff;color:#4f46e5;
  font-size:12.5px;font-weight:600}
.ob-hero{margin:14px 0 0;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:-.02em}
.ob-grad{background:linear-gradient(90deg,#4f46e5,#a855f7);-webkit-background-clip:text;background-clip:text;color:transparent}
.ob-herosub{margin:14px 0 0;font-size:14.5px;line-height:1.6;color:#475569;max-width:440px}
.ob-features{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:13px}
.ob-features li{display:flex;gap:14px;align-items:flex-start}
.ob-fico{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;flex-shrink:0}
.ob-features b{display:block;font-size:14px;font-weight:700}
.ob-features p{margin:2px 0 0;font-size:12.5px;line-height:1.5;color:#64748b;max-width:380px}
.ob-foot{margin:auto 0 0;padding-top:18px;font-size:12.5px;color:#64748b}
.ob-leftdots{display:flex;align-items:center;gap:8px;margin-top:14px}
.ob-leftdots i{display:block;width:8px;height:8px;border-radius:999px;background:#cfd4e6}
.ob-leftdots i.on{background:#4f46e5;width:14px}
.ob-leftdots i.done{background:#c7d2fe}
.ob-leftdots span{margin-left:16px;font-size:13px;color:#64748b;font-variant-numeric:tabular-nums}
.ob-card{width:100%;max-width:520px;padding:20px 26px 18px;border-radius:22px;background:#fff;
  border:1px solid #eceef6;box-shadow:0 30px 70px -20px rgba(30,41,63,.18),0 8px 24px -8px rgba(30,41,63,.08);box-sizing:border-box}
.ob-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
.ob-topskip{display:inline-flex;align-items:center;gap:5px;background:none;border:none;color:#64748b;
  font-size:13px;font-weight:600;cursor:pointer;padding:4px;font-family:inherit}
.ob-topskip:hover{color:#0f172a}
.ob-track{display:flex;align-items:center;margin-bottom:16px}
.ob-track-item{display:flex;align-items:center;flex:1;min-width:0}
.ob-track-item:last-child{flex:0 0 auto}
.ob-stepnum{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;flex-shrink:0;
  background:#4f46e5;color:#fff;font-size:11.5px;font-weight:700;box-shadow:0 0 0 4px #eef2ff}
.ob-tdot{display:block;width:8px;height:8px;border-radius:999px;background:#d8dbea;flex-shrink:0}
.ob-tdot.done{background:#4f46e5}
.ob-seg{display:block;flex:1;height:2px;background:#e6e8f2;margin:0 4px}
.ob-seg.done{background:#4f46e5}
.ob-h1{font-size:21px;font-weight:800;letter-spacing:-.015em;color:#0f172a;line-height:1.25;margin:0}
.ob-sub{margin:6px 0 14px;font-size:12.5px;color:#64748b;line-height:1.55}
.ob-field{margin-bottom:14px}
.ob-label{display:block;margin-bottom:6px;font-size:12px;font-weight:600;color:#475569}
.ob-browser{padding:10px 12px 12px;border-radius:14px;background:#f3f4fa;border:1px solid #e6e8f2;margin-bottom:12px}
.ob-browser-bar{display:flex;gap:5px;margin:0 0 9px 2px}
.ob-browser-bar i{display:block;width:7px;height:7px;border-radius:999px;background:#cfd4e6}
.ob-inputwrap{position:relative}
.ob-inputwrap .ob-ic{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:7px;background:#4f46e5;color:#fff;pointer-events:none}
.ob-inputwrap .ob-input{padding-left:44px}
.ob-input{width:100%;height:42px;padding:0 13px;border-radius:11px;background:#fff;border:1.5px solid #e2e5f2;
  color:#0f172a;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;transition:.15s}
.ob-input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.ob-input::placeholder{color:#a3a9c2}
.ob-textarea{height:auto;padding:9px 12px;line-height:1.6;resize:vertical}
.ob-plats{display:flex;gap:10px;margin-top:12px}
.ob-plat{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 8px;border-radius:12px;background:#fff;border:1px solid #e6e8f2;
  font-size:11px;font-weight:600;color:#475569}
.ob-plat span{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:#eef2ff;color:#4f46e5}
.ob-error{margin-top:8px;font-size:12px;color:#dc2626}
.ob-hint{margin:0;font-size:11.5px;color:#7c8093;line-height:1.6}
.ob-skip{text-align:center;margin-top:14px;font-size:12px;color:#8b8fa8}
.ob-skip a{color:#4f46e5;cursor:pointer;font-weight:600}
.ob-skip a:hover{text-decoration:underline}
.ob-optlist2{display:flex;flex-direction:column;gap:9px}
.ob-optrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 14px;border-radius:14px;
  border:1.5px solid #e9ebf4;background:#fff;cursor:pointer;transition:.15s;font-family:inherit}
.ob-optrow:hover{border-color:#c7d2fe;background:#fafaff}
.ob-optrow.active{border-color:#4f46e5;background:#eef2ff}
.ob-opticon{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;flex-shrink:0}
.ob-optbody{flex:1;min-width:0}
.ob-optbody b{display:block;font-size:13.5px;font-weight:650;color:#0f172a}
.ob-optbody span{display:block;margin-top:1px;font-size:11px;color:#7c8093;line-height:1.4}
.ob-radio{width:18px;height:18px;border-radius:999px;border:2px solid #d8dbea;flex-shrink:0;position:relative;background:#fff}
.ob-optrow.active .ob-radio{border-color:#4f46e5;background:#4f46e5}
.ob-optrow.active .ob-radio::after{content:"";position:absolute;inset:4px;border-radius:999px;background:#fff}
.ob-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.ob-tile{display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 8px 10px;border-radius:14px;border:1.5px solid #e9ebf4;
  background:#fff;cursor:pointer;transition:.15s;font-family:inherit}
.ob-tile:hover{border-color:#c7d2fe}
.ob-tile.active{border-color:#4f46e5;background:#eef2ff}
.ob-tile b{font-size:11.5px;font-weight:650;color:#0f172a;text-align:center;line-height:1.3}
.ob-tags{display:flex;flex-wrap:wrap;gap:8px}
.ob-tag{padding:8px 14px;border-radius:999px;cursor:pointer;user-select:none;font-size:12.5px;font-weight:600;
  border:1.5px solid #e2e5f2;background:#fff;color:#475569;transition:.15s}
.ob-tag:hover{border-color:#c7d2fe}
.ob-tag.active{border-color:#4f46e5;background:#eef2ff;color:#4f46e5}
.ob-review{display:flex;flex-direction:column;border:1.5px solid #e9ebf4;border-radius:14px;overflow:hidden;margin-bottom:6px}
.ob-rrow{display:flex;align-items:center;gap:12px;padding:12px 14px}
.ob-rrow+.ob-rrow{border-top:1px solid #eef0f6}
.ob-rrow-b{flex:1;min-width:0}
.ob-rrow-b small{display:block;font-size:11px;color:#7c8093}
.ob-rrow-b b{display:block;font-size:13px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ob-rrow-b b.empty{color:#a3a9c2;font-weight:500}
.ob-change{background:none;border:none;color:#4f46e5;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;padding:4px}
.ob-change:hover{text-decoration:underline}
.ob-redit{padding:0 14px 14px 64px;border-top:0}
.ob-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px}
.ob-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 16px;border-radius:999px;white-space:nowrap;
  background:#fff;border:1.5px solid #e2e5f2;color:#475569;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;font-family:inherit}
.ob-btn:hover:not(:disabled){border-color:#c7cbe0;color:#0f172a}
.ob-btn:disabled{opacity:.5;cursor:not-allowed}
.ob-btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:42px;padding:0 22px;border-radius:12px;white-space:nowrap;
  background:#4f46e5;border:none;color:#fff;font-size:13.5px;font-weight:650;cursor:pointer;transition:.15s;
  box-shadow:0 8px 20px -6px rgba(79,70,229,.5);font-family:inherit}
.ob-btn-primary:hover:not(:disabled){background:#4338ca}
.ob-btn-primary:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
.ob-dots{display:flex;justify-content:center;gap:6px;margin-top:14px}
.ob-dots i{display:block;width:6px;height:6px;border-radius:999px;background:#e2e5f2}
.ob-dots i.on{background:#4f46e5;width:16px}
.ob-dots i.done{background:#c7d2fe}
.ob-rowlist{display:flex;flex-direction:column;gap:7px}
.ob-row{display:flex;gap:7px}
.ob-row .ob-input{flex:1;min-width:0}
.ob-row .ob-btn{flex-shrink:0;height:42px;padding:0 12px}
.ob-list{margin:0;padding-left:18px;font-size:12.5px;color:#334155;line-height:1.7}
.ob-note{display:flex;flex-direction:column;gap:7px;padding:11px 14px;border-radius:13px;background:#f6f8fd;
  border:1px solid #e6ebfd;margin-bottom:12px}
.ob-check{display:flex;align-items:center;gap:9px;font-size:12.5px;color:#475569;line-height:1.5}
.ob-check::before{content:"✓";display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:999px;
  background:#dcfce7;color:#16a34a;font-size:10px;font-weight:800;flex-shrink:0}
.ob-result{margin-top:10px;font-size:12px;line-height:1.5}
.ob-result.ok{color:#16a34a}
.ob-result.err{color:#dc2626}
.ob-link{color:#4f46e5;text-decoration:none;font-weight:600}
.ob-link:hover{text-decoration:underline}
.ob-secret{display:flex;gap:8px;align-items:center;padding:11px 13px;border-radius:11px;background:#f8f9fd;border:1.5px solid #e2e5f2;
  font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#0f172a;word-break:break-all}
.ob-secret span{flex:1}
.ob-code{margin-top:8px;padding:12px 14px;border-radius:11px;background:#0f172a;border:1px solid #1e293b;font-size:10.5px;line-height:1.6;
  overflow-x:auto;color:#cbd5e1}
.ob-prog{margin-top:16px;padding:15px;border-radius:14px;background:#f6f8fd;border:1.5px solid #e6ebfd}
.ob-prog-h{display:flex;flex-wrap:wrap;align-items:center;gap:9px}
.ob-prog-l{flex:1;min-width:140px;font-size:12.5px;color:#1e293b;font-weight:650}
.ob-prog-p{font-size:12.5px;color:#4f46e5;font-variant-numeric:tabular-nums;font-weight:700}
.ob-dot{width:8px;height:8px;border-radius:999px;background:#4f46e5;flex-shrink:0;animation:obPulse 1.4s ease-in-out infinite}
@keyframes obPulse{0%,100%{opacity:1}50%{opacity:.25}}
.ob-prog-bar{margin-top:10px;height:7px;border-radius:999px;background:#e6ebfd;overflow:hidden}
.ob-prog-bar>i{display:block;height:100%;border-radius:999px;transition:width .6s ease;background:linear-gradient(90deg,#4f46e5,#7c3aed,#8b5cf6)}
.ob-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-top:12px;list-style:none;padding:0}
.ob-step{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#334155}
.ob-step-next{color:#94a3b8}
.ob-step-now{font-weight:700;color:#0f172a}
.ob-step-n{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;border-radius:999px;
  font-size:8.5px;border:1px solid #818cf8;color:#4f46e5}
.ob-step-next .ob-step-n{border-color:#dbe0f5;color:#94a3b8}
.ob-step-done .ob-step-n{background:#4f46e5;border-color:#4f46e5;color:#fff}
.ob-done{display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 0 4px}
.ob-done-ic{font-size:56px;line-height:1;margin-bottom:12px}
.ob-done-ok{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:999px;background:#22c55e;color:#fff;
  margin:-26px 0 10px 54px;box-shadow:0 6px 14px -4px rgba(34,197,94,.6)}
.ob-done .ob-h1{font-size:24px}
.ob-done .ob-sub{text-align:center}
.ob-donelist{width:100%;display:flex;flex-direction:column;gap:9px;margin:14px 0 8px;padding:14px;border-radius:14px;background:#f0fdf4;border:1px solid #dcfce7;text-align:left}
.ob-donerow{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#166534}
.ob-donerow span{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:#22c55e;color:#fff;flex-shrink:0}
@media (max-width:980px){
  .ob-page{grid-template-columns:1fr}
  .ob-page::before{display:none}
  .ob-left{display:none}
  .ob-right{padding:18px 14px;align-items:flex-start}
}
@media (max-width:480px){
  .ob-card{padding:18px 16px 16px;border-radius:16px}
  .ob-h1{font-size:19px}
  .ob-sub{font-size:12.5px}
  .ob-card .ob-brand-s{display:none}
  .ob-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ob-row{gap:5px}
  .ob-row .ob-btn{padding:0 8px;font-size:10.5px}
  .ob-secret{flex-wrap:wrap}
  .ob-secret button{width:100%;justify-content:center}
  .ob-redit{padding-left:14px}
}
`;
