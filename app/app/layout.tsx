"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore, PLANS } from "@/lib/store";
import { BossChat } from "@/components/kit";
import LiveAgents from "@/components/LiveAgents";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon } from "@/components/app-icons";

/** Shell chrome for every /app/** page. Restyled to match the AI Command Center reference
 *  build (components/dashboard/AICommandCenter.tsx): same palette (see .dark in globals.css),
 *  same Inter type, same 72px collapsed icon rail that expands on toggle, same topbar with
 *  greeting + status dot + bell/chat/avatar, same SVG icon set (components/app-icons.tsx).
 *  Only the chrome changed — routing, auth guard and every page's behaviour are untouched. */

const ITEMS: [string, keyof typeof Icon, string][] = [
  ["Dashboard", "dashboard", "/app"],
  ["Content", "content", "/app/content"],
  ["Approvals", "approvals", "/app/approvals"],
  ["Reports", "reports", "/app/reports"],
  ["Memory", "memory", "/app/memory"],
  ["Billing", "billing", "/app/billing"],
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { s, signOut } = useStore();
  const path = usePathname();
  const router = useRouter();
  // Rail is collapsed by default, exactly like the reference build's sidebar.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    // real session is enforced server-side by middleware.ts. Onboarding status comes from
    // Supabase (lib/store.tsx syncFromSession) — wait for onboardedChecked before deciding,
    // or an already-onboarded user gets bounced to /onboarding during the brief window before
    // that DB check resolves (it defaults to false until then).
    if (s.user && s.onboardedChecked && !s.onboarded) router.replace("/onboarding");
  }, [s.user, s.onboarded, s.onboardedChecked, router]);

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

  return (
    <div className={"appshell" + (navOpen ? " nav-open" : "")} style={{ position: "relative", zIndex: 1 }}>
      <div className="shell">
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
              <div className="s-user" onClick={signOut} title="Sign out">
                <span className="s-av">{initial}</span>
                <div className="s-user-t">
                  <div className="n">{s.user.name || "Account"}</div>
                  <div className="e">{s.user.email}</div>
                </div>
                <span className="s-chev">{Icon.chevron}</span>
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
            <span className="tb-av">{initial}</span>
          </header>

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
        .appshell { --sbw: 72px; --chatw: clamp(272px, 10vw, 340px); }
        .appshell.nav-open { --sbw: 244px; }
        .shell { display: grid; grid-template-columns: var(--sbw) 1fr; height: 100vh;
                 transition: grid-template-columns .45s cubic-bezier(.55,.06,.25,1); }
        .col { display: flex; flex-direction: column; min-width: 0; height: 100vh; }

        /* ---- sidebar ---- */
        .sidedesk { background: var(--bg2); border-right: 1px solid var(--line); padding: 16px 12px;
                    display: flex; flex-direction: column; gap: 3; position: sticky; top: 0; height: 100vh;
                    overflow: hidden; }
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

        /* collapsed rail: icons only, labels + plan card hidden */
        .appshell:not(.nav-open) .s-brand-t,
        .appshell:not(.nav-open) .ni-l,
        .appshell:not(.nav-open) .plan,
        .appshell:not(.nav-open) .s-user-t,
        .appshell:not(.nav-open) .s-chev { display: none; }
        .appshell:not(.nav-open) .s-brand,
        .appshell:not(.nav-open) .ni,
        .appshell:not(.nav-open) .s-user { justify-content: center; }
        .appshell:not(.nav-open) .cnt { position: absolute; top: 3px; right: 3px; margin: 0;
                                        min-width: 15px; height: 15px; font-size: 9px; padding: 0 3px; }

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
        .s-user { display: flex; align-items: center; gap: 9px; min-width: 0; cursor: pointer; }
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
        .hello { font-size: 17px; font-weight: 800; color: var(--ink); line-height: 1.2; }
        .status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--grn);
                  font-weight: 600; margin-top: 2px; }
        .status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--grn);
                       box-shadow: 0 0 7px var(--grn); animation: tbping 1.8s infinite; }
        @keyframes tbping { 50% { opacity: .35; } }
        .b-cnt { position: absolute; top: -5px; right: -5px; background: var(--red); color: #fff;
                 font-size: 9px; font-weight: 800; min-width: 15px; height: 15px; border-radius: 8px;
                 display: grid; place-items: center; padding: 0 3px; }
        .tb-btn.bell .b-cnt { background: var(--red); }
        .tb-av { width: 34px; height: 34px; border-radius: 10px; flex: none; display: grid; place-items: center;
                 background: linear-gradient(135deg,var(--ac),var(--vio)); color: #fff; font-weight: 800; font-size: 14px; }

        /* ---- main ---- */
        .appmain { flex: 1; min-height: 0; overflow-y: auto; padding: 22px clamp(14px,2.4vw,26px) 26px; }
        .appmain.is-dash { padding: 0; overflow: hidden; position: relative; }
        /* The dashboard's own padding is 0 (the office fills it edge to edge), but it still has
           to keep clear of the chat dock — without this the office ran underneath it. */
        @media (min-width: 900px) {
          .appmain { padding-right: calc(var(--chatw) + 22px); }
          /* margin, not padding: the dashboard's own wrapper is position:absolute, and an
             absolutely positioned box is laid out against the PADDING box — padding-right
             would have been ignored and the office would still slide under the chat. */
          .appmain.is-dash { padding-right: 0; margin-right: var(--chatw); }
        }

        /* ---- mobile ---- */
        @media (max-width: 860px) {
          .shell { grid-template-columns: 1fr !important; height: auto !important; }
          .sidedesk { display: none !important; }
          .col { height: auto; min-height: 100vh; }
          .appmain { padding: 16px 14px 96px !important; height: auto !important; }
          .appmain.is-dash { padding: 0 0 76px !important; overflow: visible; height: 78vh; }
          .topbar { padding: 11px 14px 10px; }
          .hello { font-size: 15px; }
          .mnavbar { display: flex !important; }
        }
        .mnavbar { display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 140;
                   background: var(--panel); border-top: 1px solid var(--line); backdrop-filter: blur(12px);
                   justify-content: space-around; padding: 8px 4px calc(8px + env(safe-area-inset-bottom)); }
        .mni { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 9.5px;
               color: var(--mut); padding: 5px 10px; position: relative; font-weight: 600; }
        .mni.active { color: var(--ac); }
        .mni-ico svg { width: 19px; height: 19px; }
        .mni-b { position: absolute; top: 0; right: 2px; background: var(--ac); color: #fff; font-size: 8.5px;
                 font-weight: 800; min-width: 14px; height: 14px; border-radius: 7px; display: grid; place-items: center; }
      `}</style>
    </div>
  );
}
