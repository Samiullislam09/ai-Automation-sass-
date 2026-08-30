import React from "react";

/** The "Mr. Lxwa" dark theme's CSS (every .lx-* class, color token, and keyframe) — shared by
 *  MrLxwaDashboard.tsx (the sidebar'd dashboard shell) and any full-page view that wants the
 *  same look WITHOUT that shell (e.g. components/dashboard/ArticleApprovalSection.tsx, which
 *  the owner asked to open as its own full-screen page, no sidebar — 2026-08-29).
 *
 *  Pulled out of MrLxwaDashboard.tsx rather than copied: two 300-line copies of the same CSS
 *  drifting apart over time is worse than one import. Tailwind core layout classes are used
 *  alongside these — see MrLxwaDashboard.tsx's own header comment for that split. */
export const LX_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.lx-root{
  --lx-bg:#06060b;
  --lx-panel:#08080f;
  --lx-card:#0c0c15;
  --lx-card2:#0a0a11;
  --lx-in:#101019;
  --lx-border:rgba(255,255,255,.07);
  --lx-text:#f2f2f7;
  --lx-mut:#8b8ba0;
  --lx-dim:#5c5c72;
  --lx-purple:#8b5cf6;
  --lx-violet:#a78bfa;
  --lx-blue:#3b82f6;
  --lx-cyan:#22d3ee;
  --lx-green:#22c55e;
  --lx-red:#ef4444;
  background:var(--lx-bg);
  color:var(--lx-text);
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;

  /* ---- legacy /app/** theme bridge ------------------------------------
     Some real pages (Site Brain's field editor, Workspace, Audit, Memory, Eval) are big,
     logic-heavy components still styled with the OLD app/globals.css tokens (--card, --btn,
     --pillst, --field, ...). Rewriting every one of them field-by-field risked breaking real
     behaviour for a purely cosmetic pass. Instead: every one of those old tokens is redefined
     right here to the new theme's own colours, scoped to .lx-root — so an old component dropped
     into this dashboard's children slot (unmodified) already renders in the new palette instead
     of clashing with it. New pages built directly against --lx-* are unaffected. */
  --bg:var(--lx-bg); --bg2:var(--lx-panel); --panel:var(--lx-card); --panel2:var(--lx-card2);
  --line:var(--lx-border); --line2:rgba(255,255,255,.16);
  --ink:var(--lx-text); --mut:var(--lx-mut); --mut2:var(--lx-dim);
  --ac:#7c3aed; --ac-d:#4f46e5; --amb:#fbbf24; --red:var(--lx-red); --blu:var(--lx-blue);
  --vio:var(--lx-violet); --grn:var(--lx-green); --teal:var(--lx-cyan);
  --tr:.18s ease;
}
.lx-root *{box-sizing:border-box}
.lx-root ::selection{background:rgba(139,92,246,.35)}

/* ---- surfaces -------------------------------------------------------- */
.lx-card {background:var(--lx-card);border:1px solid var(--lx-border);border-radius:16px}
.lx-card2{background:var(--lx-card2);border:1px solid var(--lx-border);border-radius:12px}
.lx-in   {background:var(--lx-in);border:1px solid rgba(255,255,255,.06);border-radius:10px}

/* chat composer — a translucent "glass" pill instead of a solid near-black slab,
   so it reads as part of the dark panel rather than a hard black box once the
   textarea grows past one line. Border brightens gently on focus instead of
   relying on the browser's default focus ring (suppressed on the textarea itself
   so only this one, deliberate outline shows). */
.lx-chat-in{background:rgba(255,255,255,.035);border:1px solid var(--lx-border);
  border-radius:20px;transition:border-color .15s,background .15s}
.lx-chat-in:focus-within{border-color:rgba(167,139,250,.55);background:rgba(255,255,255,.05)}
.lx-chat-in textarea{outline:none;box-shadow:none}
/* placeholder reads smaller/dimmer than typed text and never wraps, so an empty
   box stays a slim single line instead of growing to fit a two-line placeholder */
.lx-chat-in textarea::placeholder{font-size:11px;opacity:.5;white-space:nowrap}

/* "Listening…" dock — grounded in its own quiet card (matches .lx-card2) instead
   of floating loose on the panel background, kept to a single row so it never
   wraps into a multi-line block regardless of panel width. The label itself is
   hidden by default (this dock only needs to read as "mic is live", not spell it
   out) and surfaces as a small tooltip on hover/focus. */
.lx-listening{position:relative;background:var(--lx-card2);border:1px solid var(--lx-border);border-radius:12px;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;flex-wrap:nowrap;overflow:visible;cursor:default}
.lx-listening .lx-ltip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%) translateY(2px);
  background:#16161f;border:1px solid var(--lx-border);border-radius:6px;padding:3px 7px;
  font-size:10.5px;color:var(--lx-text);white-space:nowrap;opacity:0;pointer-events:none;
  transition:opacity .15s,transform .15s;z-index:5}
.lx-listening:hover .lx-ltip{opacity:1;transform:translateX(-50%) translateY(0)}
.lx-panelL{background:var(--lx-panel);border-right:1px solid var(--lx-border)}
/* width scales with viewport (%) instead of a fixed px value, so it stays
   proportionate on very large monitors without growing absurdly wide. Below
   lg it's a full overlay (doesn't share space with the center column) so a
   generous vw share is safe; at lg+ it sits statically next to the AI Agent
   Network's container-query layout (.lx-net-host switches at 440px), so the
   lower bound/slope here is kept small enough that a 1024px laptop still
   leaves that column comfortably above 440px — don't raise the 220px floor
   or the 24vw slope without re-checking the network cards at 1024–1366px. */
.lx-panelR{background:var(--lx-panel);border-left:1px solid var(--lx-border);
  width:min(92vw,380px)}
@media (min-width:1024px){.lx-panelR{width:clamp(220px,24vw,420px)}}

/* ---- type helpers ---------------------------------------------------- */
/* bumped up from the original 10/11/12/13px scale — read as too small ("bahut chota") once
   the network cards had real names/roles/status packed into them, not just icons */
.lx-10{font-size:11px}.lx-11{font-size:12.5px}.lx-12{font-size:14px}.lx-13{font-size:15px}
.lx-mut{color:var(--lx-mut)}.lx-dim{color:var(--lx-dim)}
.lx-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* ---- nav -------------------------------------------------------------- */
.lx-nav{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border-radius:12px;
  color:var(--lx-mut);font-size:13px;font-weight:500;cursor:pointer;background:transparent;
  border:1px solid transparent;transition:all .18s;text-align:left}
.lx-nav:hover{color:#e8e8f2;background:rgba(255,255,255,.04)}
.lx-nav.on{color:#fff;background:linear-gradient(90deg,rgba(37,99,235,.35),rgba(139,92,246,.12));
  border-color:rgba(99,102,241,.35);
  box-shadow:0 0 18px rgba(59,130,246,.16),inset 0 0 14px rgba(59,130,246,.08)}

/* ---- pills / chips ---------------------------------------------------- */
.lx-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;
  font-size:11px;font-weight:600;padding:4px 10px;border:1px solid;white-space:nowrap}
.lx-pill.purple{color:#b9a5ff;border-color:rgba(139,92,246,.45);background:rgba(139,92,246,.12)}
.lx-pill.red   {color:#f87171;border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.12)}
.lx-pill.green {color:#4ade80;border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.1)}
.lx-pill.amber {color:#fbbf24;border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.1)}
.lx-pill.blue  {color:#60a5fa;border-color:rgba(59,130,246,.4);background:rgba(59,130,246,.12)}
.lx-pill.mut   {color:var(--lx-mut);border-color:var(--lx-border);background:rgba(255,255,255,.03)}

/* ---- toggle switch — used anywhere a page has an on/off setting ------- */
.lx-switch{width:44px;height:25px;border-radius:14px;border:1px solid var(--lx-border);background:var(--lx-in);
  position:relative;cursor:pointer;flex-shrink:0;transition:background .18s,border-color .18s;padding:0}
.lx-switch i{position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;
  background:#8b8ba0;transition:transform .18s,background .18s;display:block}
.lx-switch.on{background:var(--lx-cyan);border-color:var(--lx-cyan)}
.lx-switch.on i{transform:translateX(19px);background:#04101a}
.lx-switch:disabled{opacity:.4;cursor:not-allowed}

/* ---- buttons ---------------------------------------------------------- */
.lx-ghost{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;
  border:1px solid var(--lx-border);background:rgba(255,255,255,.03);color:#cfcfdd;
  font-size:12px;font-weight:500;cursor:pointer;transition:.18s;white-space:nowrap}
.lx-ghost:hover{border-color:rgba(139,92,246,.55);color:#fff}
.lx-icobtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:9px;border:1px solid var(--lx-border);background:rgba(255,255,255,.03);
  color:#9a9ab2;cursor:pointer;transition:.18s;flex-shrink:0}
.lx-icobtn:hover{color:#fff;border-color:rgba(139,92,246,.55)}
.lx-grad{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;
  background:linear-gradient(135deg,#4f46e5,#7c3aed 55%,#8b5cf6);color:#fff;font-weight:600;
  border:1px solid rgba(139,92,246,.6);border-radius:12px;
  box-shadow:0 6px 22px rgba(124,58,237,.35);transition:.18s}
.lx-grad:hover{filter:brightness(1.1)}

/* ---- tabs -------------------------------------------------------------- */
.lx-tab{position:relative;padding:10px 2px;font-size:12.5px;font-weight:500;color:var(--lx-mut);
  background:none;border:none;cursor:pointer;white-space:nowrap}
.lx-tab:hover{color:#d6d6e4}
.lx-tab.on{color:#fff}
.lx-tab.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,#3b82f6,#22d3ee);box-shadow:0 0 8px rgba(59,130,246,.85)}

/* ---- progress ---------------------------------------------------------- */
.lx-track{height:6px;border-radius:999px;background:#191926;overflow:hidden}
.lx-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#2563eb,#3b82f6 45%,#22d3ee);
  box-shadow:0 0 10px rgba(59,130,246,.8),0 0 18px rgba(34,211,238,.4);
  transition:width .6s ease}

/* ---- workflow ---------------------------------------------------------- */
.lx-agent{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 30% 25%,#171726,#0b0b13);border:1.5px solid var(--ac);color:var(--ac);
  flex-shrink:0}
.lx-agent.glow{box-shadow:0 0 16px color-mix(in srgb,var(--ac) 60%,transparent),
  inset 0 0 10px color-mix(in srgb,var(--ac) 25%,transparent)}

/* [ASSET] brain emoji — used only in the compact single-line row (panel open); the resting
   "AI Agent Network" state uses the lucide Brain icon inside .lx-hex instead. */
.lx-brain{font-size:56px;line-height:1;user-select:none;
  filter:hue-rotate(255deg) saturate(2.4) brightness(1.12)
         drop-shadow(0 0 16px rgba(168,85,247,.9)) drop-shadow(0 0 44px rgba(124,58,237,.55));
  animation:lxFloat 3.6s ease-in-out infinite}
@keyframes lxFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}

/* ---- AI Agent Network (resting-state layout, matches the reference mockup) ------------ */
/* breakpoint is on the CONTAINER (the center column), not the viewport — the column is
   ~480px wide even on a 1024px screen once the sidebar and assistant take their share, and
   the JS that measures wire endpoints uses the same 440px container threshold. */
.lx-net-host{container-type:inline-size}
.lx-net{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.lx-net-brain{order:-1;grid-column:1 / -1}
@container (min-width:440px){
  .lx-net{grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(4,auto);
    grid-template-areas:
      "t1 t1 t1 t2 t2 t2 t3 t3 t3 t4 t4 t4"
      "l1 l1 l1 l1 b  b  b  b  r1 r1 r1 r1"
      "o1 o1 o1 o2 o2 o2 o3 o3 o3 o4 o4 o4"}
  /* side cards sit centred on the brain, single-card height; the brain card itself does
     not stretch to fill the row — it keeps the reference's compact size */
  [data-net='l1'],[data-net='r1'],[data-net='b']{align-self:center}
  .lx-net-brain{order:0;grid-column:auto}
}

.lx-net-card{position:relative;z-index:1;background:#0b0b14;border:1px solid rgba(255,255,255,.08);
  border-radius:14px;padding:15px;text-align:left;display:flex;flex-direction:column;width:100%;
  min-height:126px;transition:.18s;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.lx-net-card:not(:disabled):hover{border-color:rgba(56,189,248,.45);background:#0e0e19}
.lx-net-icon{width:46px;height:46px;border-radius:11px;display:flex;align-items:center;
  justify-content:center;flex-shrink:0}

/* smooth open/close of blocks of unknown height — see the Collapse component. A gentle
   decelerate-only curve (no fast front-load) so a large height swing (compact strip ↔ full
   network, ~700px) reads as one settled glide instead of a lurch. */
.lx-collapse{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;
  transition:grid-template-rows .5s cubic-bezier(.16,1,.3,1),opacity .35s ease,visibility 0s linear .5s}
.lx-collapse.open{grid-template-rows:1fr;opacity:1;visibility:visible;
  transition:grid-template-rows .5s cubic-bezier(.16,1,.3,1),opacity .35s ease .1s,visibility 0s}
.lx-collapse>div{min-height:0;overflow:hidden}

/* brain "command center" card — TRANSPARENT fill (the workflow card shows through), a 1px
   purple→cyan gradient ring as the border, the same quiet shadow every other agent card has.
   The ring is a ::before layer masked down to its 1px edge (mask-composite) — NOT the
   two-layer-background trick, which can't do a transparent fill: with a transparent top
   layer the gradient underneath filled the whole box (that was the solid purple/cyan card). */
.lx-hex{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:13px 11px;text-align:center;border-radius:16px;background:transparent;
  box-shadow:0 4px 18px rgba(0,0,0,.35)}
.lx-hex::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;
  background:linear-gradient(160deg,#a855f7,#6366f1 45%,#22d3ee);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude}
/* the render is a rectangular crop of the reference: a radial mask fades its edges, and
   screen blending makes its dark #060a18 background vanish against the card while the bright
   brain stays — so only the brain is visible, no crop box, on a transparent card */
.lx-hex img{width:84px;height:auto;display:block;mix-blend-mode:screen;
  -webkit-mask:radial-gradient(ellipse 46% 46% at 50% 50%,#000 52%,transparent 100%);
  mask:radial-gradient(ellipse 46% 46% at 50% 50%,#000 52%,transparent 100%);
  filter:drop-shadow(0 0 8px rgba(129,140,248,.35))}

/* ---- robot avatar (pure CSS — [ASSET] swap point) ---------------------- */
.lx-robo{position:relative;border-radius:26%;flex-shrink:0;
  background:linear-gradient(180deg,#1c2233,#0c0f17);border:1px solid rgba(255,255,255,.12);
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 16px rgba(34,211,238,.28),inset 0 0 12px rgba(34,211,238,.12)}
.lx-robo b{display:block;width:60%;height:36%;border-radius:22%;background:#04101a;
  border:1px solid rgba(34,211,238,.55);position:relative;
  box-shadow:inset 0 0 8px rgba(34,211,238,.35)}
.lx-robo b::before,.lx-robo b::after{content:"";position:absolute;top:50%;transform:translateY(-50%);
  width:18%;height:38%;border-radius:50%;background:var(--lx-cyan);
  box-shadow:0 0 7px var(--lx-cyan)}
.lx-robo b::before{left:20%}
.lx-robo b::after{right:20%}
.lx-robo i{position:absolute;top:-8%;left:50%;transform:translateX(-50%);width:2px;height:10%;
  background:rgba(34,211,238,.8)}
.lx-robo i::after{content:"";position:absolute;top:-4px;left:50%;transform:translateX(-50%);
  width:4px;height:4px;border-radius:50%;background:var(--lx-cyan);box-shadow:0 0 6px var(--lx-cyan)}

/* ---- timeline ---------------------------------------------------------- */
.lx-tl{position:relative}
.lx-tl::before{content:"";position:absolute;left:59px;top:10px;bottom:10px;width:1px;
  background:linear-gradient(180deg,rgba(34,197,94,.55),rgba(59,130,246,.45),rgba(255,255,255,.08))}
.lx-row{display:grid;grid-template-columns:44px 14px 1fr auto auto;gap:9px;align-items:center;padding:7px 0}
.lx-dot{width:9px;height:9px;border-radius:50%;position:relative;z-index:1;justify-self:center}

/* ---- misc bits --------------------------------------------------------- */
.lx-num{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:#fff;flex-shrink:0;
  background:linear-gradient(135deg,#2563eb,#7c3aed)}
.lx-bar{height:4px;border-radius:2px}
.lx-pulse{animation:lxPulse 1.4s ease-in-out infinite}
@keyframes lxPulse{0%,100%{opacity:1}50%{opacity:.3}}
.lx-shimmer{background:linear-gradient(90deg,#8b8ba0 0%,#eeeefc 50%,#8b8ba0 100%);
  background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:lxShimmer 1.6s linear infinite}
@keyframes lxShimmer{from{background-position:200% 0}to{background-position:-200% 0}}

/* Live Visual's mode crossfade — plain CSS keyed to React's own key-remount (see
   components/MrLxwaDashboard.tsx), not framer-motion: a nested AnimatePresence here got
   stuck with opacity permanently at 0 in dev (confirmed via computed style), most likely a
   React-18-strict-mode double-invoke interaction. A CSS animation restarts reliably on every
   real DOM mount, which a key change always causes, so there is no state to get stuck in. */
.lx-live-anim{animation:lxLiveFade .4s ease-out both}
@keyframes lxLiveFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* waveform */
.lx-wv{display:flex;align-items:center;height:18px}
.lx-wv i{display:inline-block;width:2px;margin-right:2px;border-radius:2px;background:var(--wc)}
.lx-wv.anim i{animation:lxWav 1.05s ease-in-out infinite}
@keyframes lxWav{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}

/* mic ping */
.lx-mic{position:relative;width:26px;height:26px;border-radius:50%;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  background:radial-gradient(circle at 35% 30%,#12202c,#070d13);
  border:1.5px solid rgba(34,211,238,.8);box-shadow:0 0 8px rgba(34,211,238,.5)}
.lx-mic::before,.lx-mic::after{content:"";position:absolute;inset:-2px;border-radius:50%;
  border:1.5px solid rgba(34,211,238,.45);animation:lxPing 1.9s ease-out infinite}
.lx-mic::after{animation-delay:.95s}
@keyframes lxPing{from{transform:scale(1);opacity:.75}to{transform:scale(1.65);opacity:0}}

/* scrollbars */
.lx-scroll{scrollbar-width:thin;scrollbar-color:#20202e transparent}
.lx-scroll::-webkit-scrollbar{width:6px;height:6px}
.lx-scroll::-webkit-scrollbar-thumb{background:#20202e;border-radius:99px}
.lx-scroll::-webkit-scrollbar-track{background:transparent}

/* chat bubbles */
.lx-me{background:linear-gradient(135deg,#5b4bd6,#7c3aed 60%,#8b5cf6);color:#fff;
  border:1px solid rgba(167,139,250,.5);border-radius:14px 14px 4px 14px;
  box-shadow:0 4px 18px rgba(124,58,237,.3)}
.lx-ai{background:rgba(255,255,255,.03);border:1px solid var(--lx-border);
  border-radius:4px 14px 14px 14px}

@media (prefers-reduced-motion:reduce){
  .lx-root *,.lx-root *::before,.lx-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`;

/** Memoized so it never re-renders after mount, regardless of how often its parent re-renders
 *  — see MrLxwaDashboard.tsx's own comment for the page-wide-blink bug this pattern fixes. */
export const LxGlobalStyle = React.memo(function LxGlobalStyle() {
  return <style dangerouslySetInnerHTML={{ __html: LX_CSS }} />;
});
