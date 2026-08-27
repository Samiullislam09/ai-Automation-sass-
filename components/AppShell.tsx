"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore, PLANS } from "@/lib/store";
import { BossChat } from "@/components/kit";
import LiveAgents from "@/components/LiveAgents";
import CrawlBanner from "@/components/CrawlBanner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon } from "@/components/app-icons";

/** Shell chrome for every /app/** page. Restyled to match the AI Command Center reference
 *  build (components/dashboard/AICommandCenter.tsx): same palette (see .dark in globals.css),
 *  same Inter type, same 72px collapsed icon rail that expands on toggle, same topbar with
 *  greeting + status dot + bell/chat/avatar, same SVG icon set (components/app-icons.tsx).
 *  Only the chrome changed — routing, auth guard and every page's behaviour are untouched. */

const ITEMS: [string, keyof typeof Icon, string][] = [
  ["Dashboard", "dashboard", "/app"],
  // The Agent Workspace (MASTER_PLAN §24.4b) — where you watch the team work. Second in the
  // rail on purpose: it is the screen a customer opens after giving an order, and the first
  // five entries are the ones the phone's bottom bar shows.
  ["Workspace", "activity", "/app/workspace"],
  ["Content", "content", "/app/content"],
  ["Approvals", "approvals", "/app/approvals"],
  ["Connect", "connect", "/app/connect"],
  ["Schedule", "schedule", "/app/schedule"],
  ["Reports", "reports", "/app/reports"],
  ["Memory", "memory", "/app/memory"],
  // What the team understood about the business, with the evidence behind every field
  // (MASTER_PLAN §25.7). Next to Memory because both answer "what does it know about me?".
  ["Site Brain", "memory", "/app/site-brain"],
  // Mr. Audit's report and its score trend (MASTER_PLAN §7.4).
  ["Site audit", "reports", "/app/audit"],
  ["Billing", "billing", "/app/billing"],
  // Review screen for the intent evaluation set (lib/eval/README.md). Reuses the activity icon.
  ["Eval", "activity", "/app/eval"],
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { s, signOut } = useStore();
  const path = usePathname();
  // Rail is collapsed by default, exactly like the reference build's sidebar.
  const [navOpen, setNavOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const unread = s.reports.filter((r: any) => r.unread).length;
  const wait = s.content.filter((c: any) => c.status === "awaiting").length;
  const badge = (href: string) => (href === "/app/reports" && unread) ? unread : (href === "/app/approvals" && wait) ? wait : 0;
  const on = (href: string) => href === "/app" ? path === "/app" : path.startsWith(href);
  const isDashboard = path === "/app";
  const plan = PLANS[s.plan] ?? PLANS.free;
  const initial = (s.user?.name || s.user?.email || "?").trim().charAt(0).toUpperCase();
  // Time of day is CLIENT knowledge. Computing it during render made the server (UTC) print
  // "Welcome back" while the browser (local time) printed "Good evening" — a hydration
  // mismatch, which is what React #418/#423/#425 in the production console were: React threw
  // the whole server-rendered shell away and re-rendered it on the client. Set it after mount.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 17 ? "Welcome back" : "Good evening");
  }, []);

  // Below 860px the sidebar is a slide-over drawer, so following a link inside it has to
  // close it. On desktop the same flag is the rail's expanded state and must survive
  // navigation, hence the width test rather than an unconditional reset.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches) setNavOpen(false);
  }, [path]);

  return (
    <div className={"appshell" + (navOpen ? " nav-open" : "")} style={{ position: "relative", zIndex: 1 }}>
      <div className="shell">
        {/* Mobile only: tapping outside the drawer closes it. Rendered unconditionally and
            hidden by CSS so it can fade rather than pop. */}
        <button className="nav-scrim" aria-label="Close menu" tabIndex={navOpen ? 0 : -1} onClick={() => setNavOpen(false)} />

        <aside className="sidedesk">
          <Link href="/" className="s-brand">
            <span className="s-mark">⚡</span>
            <div className="s-brand-t">
              <div className="t">GrowthTeam<br />AI</div>
              <div className="st">Operate. Automate. Grow.</div>
            </div>
          </Link>

          <div className="nav">
            {ITEMS.map(([label, ico, href]) => (
              <Link key={href} href={href} className={"ni" + (on(href) ? " active" : "")} title={label}>
                <span className="ni-ico">{Icon[ico]}</span>
                <span className="ni-l">{label}</span>
                {badge(href) ? <span className="cnt">{badge(href)}</span> : null}
              </Link>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <div className="plan">
            <div className="lbl">YOUR PLAN</div>
            <div className="row1">
              <b>{plan.name}</b>
              <Link href="/app/billing" className="upg">Upgrade</Link>
            </div>
            <div className="meter">
              <div className="mr"><span>AI Tokens</span><b>{s.tokens}/{s.tokensMax}</b></div>
              <div className="bar"><i style={{ width: `${s.tokensMax ? Math.min(100, Math.round((s.tokens / s.tokensMax) * 100)) : 0}%` }} /></div>
            </div>
            <div className="tagline">{plan.tagline}</div>
          </div>

          <div className="s-foot">
            <ThemeToggle />
            {s.user && (
              <div className="s-user">
                <span className="s-av">{initial}</span>
                <div className="s-user-t">
                  <div className="n">{s.user.name || "Account"}</div>
                  <div className="e">{s.user.email}</div>
                </div>
                {/* Sign-out used to be the whole row's onClick — one stray click on your own
                    name logged you out. It needs its own button and a confirm step. */}
                <button
                  className="s-out"
                  title={confirmOut ? "Click again to sign out" : "Sign out"}
                  onClick={() => {
                    if (confirmOut) { signOut(); return; }
                    setConfirmOut(true);
                    setTimeout(() => setConfirmOut(false), 3000);
                  }}
                >
                  {confirmOut ? "Sure?" : Icon.chevron}
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="col">
          <header className="topbar">
            <button className="sb-t" onClick={() => setNavOpen(o => !o)} aria-label="Toggle sidebar" title="Toggle menu">{Icon.menu}</button>
            <div className="tb-t">
              <div className="hello">{greeting}{s.user?.name ? `, ${s.user.name}` : ""}! 👋</div>
              <div className="status"><span className="dot" /> All systems operational</div>
            </div>
            <Link href="/app/reports" className="tb-btn bell" aria-label="Reports" title="Reports">
              {Icon.bell}{unread ? <span className="b-cnt">{unread}</span> : null}
            </Link>
            <Link href="/app/approvals" className="tb-btn" aria-label="Approvals" title="Approvals">
              {Icon.chat}{wait ? <span className="b-cnt">{wait}</span> : null}
            </Link>
            {/* Always visible, even with the sidebar collapsed — which is the default, and is
                why nobody could find their plan. */}
            <Link href="/app/billing" className="tb-plan" title="Your plan">{plan.name}</Link>
            <AccountMenu initial={initial} onSignOut={signOut} />
          </header>

          {/* Above the content, below the topbar: the crawl is the one long-running job with
              no room in the office, so it needs to be visible from every page. */}
          <CrawlBanner />

          <main className={"appmain" + (isDashboard ? " is-dash" : "")}>{children}</main>
        </div>
      </div>

      <nav className="mnavbar">
        {ITEMS.slice(0, 5).map(([label, ico, href]) => (
          <Link key={href} href={href} className={"mni" + (on(href) ? " active" : "")}>
            <span className="mni-ico">{Icon[ico]}</span>{label}
            {badge(href) ? <span className="mni-b">{badge(href)}</span> : null}
          </Link>
        ))}
      </nav>

      {/* one poll for the whole shell: office rooms, stat row and the chat all read its result */}
      <LiveAgents />
      <BossChat />

      <style jsx global>{`
        /* ---- shell: 72px rail | content | chat dock (BossChat is position:fixed) ----
           The chat column is kept as narrow as the request asked for ("10%"), but a literal
           10% is ~100px on a 1024px laptop — unreadable for a conversation — so it's 10vw
           with a 272px floor and a 340px ceiling: the office keeps ~75-85% of the width and
           the chat text still wraps sanely. */
        /* --mnav is the height of the fixed bottom bar including the home-indicator inset. The
           main scroller's bottom padding and the chat bubble's offset both read it, so the
           three can never drift apart again. */
        .appshell { --sbw: 72px; --chatw: clamp(272px, 10vw, 340px); --topbar: 60px;
                    --mnav: calc(53px + env(safe-area-inset-bottom)); }
        .appshell.nav-open { --sbw: 244px; }
        .shell { display: grid; grid-template-columns: var(--sbw) 1fr; height: 100vh;
                 transition: grid-template-columns .45s cubic-bezier(.55,.06,.25,1); }
        .col { display: flex; flex-direction: column; min-width: 0; height: 100vh; }

        /* ---- sidebar ---- */
        /* This said "gap: 3" with no unit, which is silently invalid — the column's spacing
           was coming entirely from its children's own margins. */
        .sidedesk { background: var(--bg2); border-right: 1px solid var(--line); padding: 16px 12px;
                    display: flex; flex-direction: column; gap: 3px; position: sticky; top: 0; height: 100vh;
                    overflow: hidden; }
        .nav-scrim { display: none; }
        .s-brand { display: flex; align-items: center; gap: 10px; padding: 2px 4px 16px; }
        .s-mark { width: 34px; height: 34px; border-radius: 10px; flex: none; display: grid; place-items: center;
                  background: linear-gradient(135deg,var(--ac),var(--ac-d)); color: #fff; font-size: 16px;
                  box-shadow: 0 4px 16px #6a5af055; }
        .s-brand-t .t { font-weight: 800; color: var(--ink); font-size: 14px; line-height: 1.15; }
        .s-brand-t .st { font-size: 9.5px; color: var(--mut2); font-weight: 600; letter-spacing: .3px; margin-top: 2px; }
        .nav { display: flex; flex-direction: column; gap: 3px; }
        .ni { display: flex; align-items: center; gap: 11px; padding: 10px; border-radius: 11px;
              font-size: 13px; font-weight: 600; color: var(--mut); transition: background .18s, color .18s;
              position: relative; white-space: nowrap; }
        .ni:hover { background: var(--panel2); color: var(--ink); }
        .ni.active { background: linear-gradient(90deg,#6a5af026,transparent); color: var(--ink);
                     box-shadow: inset 2px 0 0 var(--ac); }
        .ni-ico { width: 18px; height: 18px; flex: none; display: grid; place-items: center; }
        .ni-ico svg { width: 18px; height: 18px; }
        .ni.active .ni-ico { color: var(--ac); }
        .cnt { margin-left: auto; background: var(--ac); color: #fff; font-size: 10px; font-weight: 800;
               min-width: 18px; height: 18px; border-radius: 9px; display: grid; place-items: center; padding: 0 5px; }

        /* collapsed rail: icons only, labels + plan card hidden.
           Scoped to desktop — below 860px the same .nav-open flag drives a full-width drawer,
           where hiding every label would leave eight unlabelled icons. */
        @media (min-width: 861px) {
          .appshell:not(.nav-open) .s-brand-t,
          .appshell:not(.nav-open) .ni-l,
          .appshell:not(.nav-open) .plan,
          .appshell:not(.nav-open) .s-user-t,
          .appshell:not(.nav-open) .s-out { display: none; }
          .appshell:not(.nav-open) .s-brand,
          .appshell:not(.nav-open) .ni,
          .appshell:not(.nav-open) .s-user { justify-content: center; }
          .appshell:not(.nav-open) .cnt { position: absolute; top: 3px; right: 3px; margin: 0;
                                          min-width: 15px; height: 15px; font-size: 9px; padding: 0 3px; }
        }

        .plan { background: var(--panel); border: 1px solid var(--line); border-radius: 13px;
                padding: 12px 13px; margin-bottom: 12px; }
        .plan .lbl { font-size: 9.5px; font-weight: 700; letter-spacing: .6px; color: var(--mut2); }
        .plan .row1 { display: flex; align-items: center; justify-content: space-between; margin: 5px 0 9px; }
        .plan .row1 b { font-size: 14.5px; font-weight: 800; color: var(--ink); }
        .plan .upg { background: linear-gradient(135deg,var(--ac),var(--ac-d)); color: #fff; font-size: 10.5px;
                     font-weight: 700; padding: 4px 10px; border-radius: 8px; }
        .plan .mr { display: flex; justify-content: space-between; font-size: 11px; color: var(--mut); }
        .plan .mr b { color: var(--ink); font-weight: 700; }
        .plan .bar { height: 5px; border-radius: 3px; background: var(--line2); margin-top: 6px; overflow: hidden; }
        .plan .bar i { display: block; height: 100%; border-radius: 3px;
                       background: linear-gradient(90deg,var(--ac),var(--vio)); transition: width .5s; }
        .plan .tagline { font-size: 10.5px; color: var(--mut2); margin-top: 9px; line-height: 1.4; }

        .s-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px;
                  padding: 9px 2px 2px; border-top: 1px solid var(--line); }
        .s-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .s-out { background: none; border: none; cursor: pointer; color: var(--mut2); padding: 4px 6px;
                 border-radius: 8px; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; }
        .s-out:hover { color: var(--red); background: var(--panel2); }
        .s-out svg { width: 14px; height: 14px; }
        .s-av { width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center;
                background: linear-gradient(135deg,var(--ac),var(--vio)); color: #fff; font-weight: 800; font-size: 13px; }
        .s-user-t { min-width: 0; }
        .s-user-t .n { font-size: 12px; font-weight: 700; color: var(--ink); overflow: hidden;
                       text-overflow: ellipsis; white-space: nowrap; max-width: 108px; }
        .s-user-t .e { font-size: 10px; color: var(--mut2); overflow: hidden; text-overflow: ellipsis;
                       white-space: nowrap; max-width: 108px; }
        .s-chev { color: var(--mut2); display: grid; place-items: center; }
        .s-chev svg { width: 14px; height: 14px; }

        /* ---- topbar ---- */
        .topbar { display: flex; align-items: center; gap: 12px; padding: 13px 20px 12px;
                  border-bottom: 1px solid var(--line); background: var(--bg); flex: none; }
        .sb-t, .tb-btn { width: 34px; height: 34px; border-radius: 10px; flex: none; display: grid;
                         place-items: center; background: var(--panel); border: 1px solid var(--line);
                         color: var(--mut); cursor: pointer; position: relative; transition: color .18s, border-color .18s; }
        .sb-t:hover, .tb-btn:hover { color: var(--ink); border-color: var(--line2); }
        .sb-t svg, .tb-btn svg { width: 17px; height: 17px; }
        .tb-t { flex: 1; min-width: 0; }
        /* The greeting is "Good evening, <their name>! 👋" — an arbitrary-length string in a
           row that also has to hold four 34px buttons. On a 360px phone it wrapped the topbar
           to two lines and shoved the avatar off the edge. */
        .hello { font-size: 17px; font-weight: 800; color: var(--ink); line-height: 1.2;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--grn);
                  font-weight: 600; margin-top: 2px; white-space: nowrap; }
        .status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--grn);
                       box-shadow: 0 0 7px var(--grn); animation: tbping 1.8s infinite; }
        @keyframes tbping { 50% { opacity: .35; } }
        .b-cnt { position: absolute; top: -5px; right: -5px; background: var(--red); color: #fff;
                 font-size: 9px; font-weight: 800; min-width: 15px; height: 15px; border-radius: 8px;
                 display: grid; place-items: center; padding: 0 3px; }
        .tb-btn.bell .b-cnt { background: var(--red); }
        .tb-av { width: 34px; height: 34px; border-radius: 10px; flex: none; display: grid; place-items: center;
                 background: linear-gradient(135deg,var(--ac),var(--vio)); color: #fff; font-weight: 800; font-size: 14px;
                 border: none; cursor: pointer; }
        .tb-plan { font-size: 11px; font-weight: 700; color: var(--mut); background: var(--panel);
                   border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; white-space: nowrap; }
        .tb-plan:hover { color: var(--ink); border-color: var(--line2); }

        /* ---- account menu ---- */
        .acct { position: relative; flex: none; }
        .acct-pop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 200; width: 268px;
                    background: var(--panel); border: 1px solid var(--line2); border-radius: 14px;
                    box-shadow: 0 18px 44px #0006; padding: 13px 14px; }
        .acct-p { font-size: 12px; color: var(--mut); margin: 0; }
        .acct-head { padding-bottom: 10px; border-bottom: 1px solid var(--line); }
        .acct-em { font-size: 12.5px; font-weight: 700; color: var(--ink); word-break: break-all; }
        .acct-ws { font-size: 10.5px; color: var(--mut2); margin-top: 2px; word-break: break-all; }
        .acct-lbl { font-size: 9.5px; font-weight: 700; letter-spacing: .6px; color: var(--mut2); margin-bottom: 4px; }
        .acct-plan { display: flex; gap: 10px; align-items: flex-start; padding: 11px 0;
                     border-bottom: 1px solid var(--line); }
        .acct-plan b { font-size: 14px; color: var(--ink); }
        .acct-tag { font-size: 10.5px; color: var(--mut2); margin-top: 3px; line-height: 1.4; }
        .acct-up { margin-left: auto; flex: none; background: linear-gradient(135deg,var(--ac),var(--ac-d));
                   color: #fff; font-size: 10.5px; font-weight: 700; padding: 4px 10px; border-radius: 8px; }
        .acct-usage { padding: 10px 0; border-bottom: 1px solid var(--line); }
        .acct-row { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px;
                    color: var(--mut); padding: 2px 0; }
        .acct-row b { color: var(--ink); font-weight: 700; }
        .acct-row b.is-full { color: var(--amb); }
        .acct-links { display: flex; gap: 12px; padding: 10px 0 4px; }
        .acct-links a { font-size: 11.5px; color: var(--ac); font-weight: 600; }
        .acct-out { width: 100%; margin-top: 8px; background: var(--panel2); border: 1px solid var(--line);
                    border-radius: 9px; padding: 7px; font-size: 11.5px; font-weight: 600; color: var(--mut);
                    cursor: pointer; }
        .acct-out:hover { color: var(--red); border-color: var(--red); }
        /* 268px anchored to the right edge of a 360px viewport still clears the padding, but
           only just — cap it so it can never be the thing that widens the page. */
        .acct-pop { max-width: calc(100vw - 24px); }
        /* The plan chip is the first thing to go when the row runs out of room; it stays one
           tap away in the drawer and in this menu. */
        @media (max-width: 520px) { .tb-plan { display: none; } }

        /* ---- main ---- */
        .appmain { flex: 1; min-height: 0; overflow-y: auto; padding: 22px clamp(14px,2.4vw,26px) 26px; }
        /* The dashboard scrolls now: the office takes the first screenful, the counters and
           the controls sit under the fold. */
        .appmain.is-dash { padding: 0; overflow-y: auto; position: relative; }
        /* The dashboard's own padding is 0 (the office fills it edge to edge), but it still has
           to keep clear of the chat dock — without this the office ran underneath it. */
        @media (min-width: 900px) {
          .appmain { padding-right: calc(var(--chatw) + 22px); }
          /* margin, not padding: the dashboard's own wrapper is position:absolute, and an
             absolutely positioned box is laid out against the PADDING box — padding-right
             would have been ignored and the office would still slide under the chat. */
          .appmain.is-dash { padding-right: 0; margin-right: var(--chatw); }
          /* Dock closed (components/kit.tsx sets body.chat-collapsed): give the width back. */
          body.chat-collapsed .appmain { padding-right: clamp(14px,2.4vw,26px); }
          body.chat-collapsed .appmain.is-dash { padding-right: 0; margin-right: 0; }
        }

        /* ---- mobile ---- */
        @media (max-width: 860px) {
          .shell { grid-template-columns: 1fr !important; height: auto !important; }
          .col { height: auto; min-height: 100vh; min-width: 0; }
          /* Clears the bottom bar AND the 54px chat bubble floating above it, so the last card
             on a page is never half-hidden behind either. */
          .appmain { padding: 16px 14px calc(var(--mnav) + 76px) !important; height: auto !important; }
          .appmain.is-dash { padding: 0 0 calc(var(--mnav) + 10px) !important; overflow-y: auto; height: auto; }
          .topbar { padding: 10px 12px; gap: 8px; }
          .appshell { --topbar: 56px; }
          .hello { font-size: 15px; }
          /* 34px is below every thumb-target guideline, and these four are the only controls
             in the topbar on a phone. */
          .sb-t, .tb-btn, .tb-av { width: 38px; height: 38px; }
          .mnavbar { display: grid !important; }

          /* The sidebar was display:none on mobile, which left the hamburger next to it
             toggling a class nothing responded to — a dead control — and left Reports, Memory
             and Billing unreachable, since the bottom bar only holds five of the eight routes.
             Same element, same .nav-open flag, now a slide-over drawer. */
          .sidedesk { display: flex !important; position: fixed !important; top: 0; left: 0; bottom: 0;
                      width: min(276px, 84vw); height: 100dvh; z-index: 220; overflow-y: auto;
                      border-right: 1px solid var(--line2); box-shadow: 8px 0 32px #0006;
                      transform: translateX(-101%); transition: transform .28s cubic-bezier(.4,0,.2,1);
                      padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
          .appshell.nav-open .sidedesk { transform: none; }
          .nav-scrim { display: block; position: fixed; inset: 0; z-index: 215; border: none; padding: 0;
                       background: #060a14a8; backdrop-filter: blur(2px); cursor: pointer;
                       opacity: 0; pointer-events: none; transition: opacity .28s; }
          .appshell.nav-open .nav-scrim { opacity: 1; pointer-events: auto; }
          /* Drawer rows are tap targets, not hover targets. */
          .ni { padding: 12px 11px; font-size: 14px; }
          .s-foot { padding-top: 12px; }

          /* The chat bubble is fixed at bottom:22 / right:22 with 54px of height, which put it
             squarely on top of the bottom bar's last two tabs. It sits above the bar instead.
             Inline styles in components/kit.tsx set these, so !important is what it takes. */
          .bosschat-bubble { bottom: calc(var(--mnav) + 12px) !important; right: 14px !important; }
          .bosschat-panel { bottom: calc(var(--mnav) + 76px) !important; right: 14px !important;
                            max-width: calc(100vw - 28px) !important; }
        }
        .mnavbar { display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 140;
                   background: var(--panel); border-top: 1px solid var(--line); backdrop-filter: blur(12px);
                   grid-template-columns: repeat(5, 1fr); padding: 6px 2px calc(6px + env(safe-area-inset-bottom)); }
        /* Was space-around, which gave five differently-sized tabs uneven gutters. Five equal
           columns keeps the icons on a grid. */
        .mni { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
               font-size: 9.5px; color: var(--mut); padding: 5px 2px; min-height: 46px; min-width: 0;
               position: relative; font-weight: 600; text-align: center; white-space: nowrap; }
        .mni.active { color: var(--ac); }
        .mni-ico { display: grid; place-items: center; }
        .mni-ico svg { width: 19px; height: 19px; }
        .mni-b { position: absolute; top: 1px; right: calc(50% - 18px); background: var(--ac); color: #fff;
                 font-size: 8.5px; font-weight: 800; min-width: 14px; height: 14px; border-radius: 7px;
                 display: grid; place-items: center; }
      `}</style>
    </div>
  );
}

/** The account menu behind the topbar avatar.
 *
 *  "Website pe mera kaunsa plan hai?" had no answer anywhere you'd look: the plan card is in
 *  the sidebar, which is collapsed by default, and the avatar did nothing at all. This is
 *  always one click away, and every number in it comes from the database and from
 *  agent-server's own cap table — the same values that decide whether a job actually runs.
 */
function AccountMenu({ initial, onSignOut }: { initial: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Loaded on first open, then refreshed each time — usage changes while you sit here.
  useEffect(() => {
    if (!open) return;
    fetch("/api/account").then((r) => r.json()).then(setData).catch(() => setData({ ok: false }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const plan = data?.plan ? PLANS[data.plan] : null;

  return (
    <div className="acct" ref={wrap}>
      <button className="tb-av" onClick={() => setOpen((o) => !o)} aria-label="Account" title="Account">{initial}</button>

      {open && (
        <div className="acct-pop">
          {!data && <p className="acct-p">Loading…</p>}

          {data && !data.ok && <p className="acct-p">Could not load your account.</p>}

          {data?.ok && (
            <>
              <div className="acct-head">
                <div className="acct-em">{data.email}</div>
                {data.workspace && <div className="acct-ws">{data.workspace}{data.website ? ` · ${data.website}` : ""}</div>}
              </div>

              <div className="acct-plan">
                <div>
                  <div className="acct-lbl">YOUR PLAN</div>
                  <b>{plan?.name ?? (data.plan ?? "Unknown")}</b>
                  {plan && <div className="acct-tag">{plan.tagline}</div>}
                  {/* Straight from the DB. Saying "run migration 009" is more useful than
                      quietly showing a tier that isn't stored anywhere. */}
                  {data.plan === null && <div className="acct-tag">Not stored yet — run migration 009.</div>}
                </div>
                <Link href="/app/billing" className="acct-up" onClick={() => setOpen(false)}>Change</Link>
              </div>

              {data.usage?.length > 0 && (
                <div className="acct-usage">
                  <div className="acct-lbl">TODAY</div>
                  {data.usage.map((u: any) => (
                    <div key={u.agent} className="acct-row">
                      <span>{u.label}</span>
                      <b className={u.cap != null && u.used >= u.cap ? "is-full" : ""}>
                        {u.cap != null ? `${u.used} / ${u.cap}` : u.known ? `${u.used} · unlimited` : u.used}
                      </b>
                    </div>
                  ))}
                </div>
              )}

              <div className="acct-usage">
                <div className="acct-row"><span>Connected</span><b>{data.connected}</b></div>
                <div className="acct-row"><span>Awaiting your approval</span><b>{data.awaiting}</b></div>
              </div>

              <div className="acct-links">
                <Link href="/app/connect" onClick={() => setOpen(false)}>Connect</Link>
                <Link href="/app/schedule" onClick={() => setOpen(false)}>Schedule</Link>
                <Link href="/app/billing" onClick={() => setOpen(false)}>Billing</Link>
              </div>
            </>
          )}

          <button
            className="acct-out"
            onClick={() => {
              if (confirmOut) { onSignOut(); return; }
              setConfirmOut(true);
              setTimeout(() => setConfirmOut(false), 3000);
            }}
          >
            {confirmOut ? "Click again to sign out" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
