"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useStore, PLANS } from "@/lib/store";
import { BossChat } from "@/components/kit";
import { ThemeToggle } from "@/components/theme-toggle";

const ITEMS = [
  ["Dashboard", "▦", "/app"], ["Content", "✍️", "/app/content"], ["Approvals", "☑", "/app/approvals"],
  ["Reports", "🗒", "/app/reports"], ["Memory", "🧠", "/app/memory"], ["Billing", "💳", "/app/billing"],
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { s, signOut } = useStore();
  const path = usePathname();
  const router = useRouter();
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

  // The dashboard root (components/dashboard/AICommandCenter.tsx) renders its own full
  // sidebar + topbar + chat panel — pixel-perfect port of the reference build, see its own
  // header comment. Every other /app/* page still gets this shared shell.
  if (isDashboard) return <>{children}</>;

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <div className="shell" style={{ display: "grid", gridTemplateColumns: "244px 1fr", height: "100vh" }}>
        <aside className="sidedesk" style={{ background: "var(--bg2)", borderRight: "1px solid var(--line)", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 3, position: "sticky", top: 0, height: "100vh" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 18px" }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,var(--ac),var(--ac-d))`, display: "grid", placeItems: "center", color: "#fff", fontSize: 16, boxShadow: "0 4px 14px #7c5cff44", flex: "none" }}>⚡</span>
            <div>
              <div style={{ fontWeight: 800, color: "var(--ink)", fontSize: 14.5, lineHeight: 1.2 }}>GrowthTeam AI</div>
              <div style={{ fontSize: 10, color: "var(--mut2)", fontWeight: 600, letterSpacing: 0.3 }}>Operate. Automate. Grow.</div>
            </div>
          </Link>
          {ITEMS.map(([label, ico, href]) => (
            <Link key={href} href={href} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 11, fontSize: 13.5, fontWeight: 600, transition: "all .2s", color: on(href) ? "var(--ink)" : "var(--mut)", background: on(href) ? "var(--panel2)" : "transparent", boxShadow: on(href) ? "inset 2px 0 0 var(--ac)" : "none" }}>
              <span>{ico}</span>{label}
              {badge(href) ? <span style={{ marginLeft: "auto", background: "var(--ac)", color: "#fff", fontSize: 10, fontWeight: 800, minWidth: 17, height: 17, borderRadius: 9, display: "grid", placeItems: "center", padding: "0 5px" }}>{badge(href)}</span> : null}
            </Link>
          ))}
          <div style={{ flex: 1 }} />

          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 13, padding: "13px 14px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="xs mut" style={{ textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Your plan</span>
              <Link href="/app/billing" className="btn btn-p btn-sm" style={{ padding: "3px 10px", fontSize: 11 }}>Upgrade</Link>
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{plan.name}</div>
            <div className="xs mut" style={{ marginTop: 2 }}>{plan.tagline}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px", borderTop: "1px solid var(--line)" }}>
            <ThemeToggle />
            {s.user && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                  <div className="xs mut" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{s.user.email}</div>
                  <a onClick={signOut} style={{ cursor: "pointer", color: "var(--mut2)", fontSize: 10.5 }}>Log out</a>
                </div>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,var(--ac),var(--vio))", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 13, flex: "none" }}>{initial}</div>
              </div>
            )}
          </div>
        </aside>
        <main style={isDashboard ? { position: "relative", width: "100%", height: "100vh", overflow: "hidden" } : { padding: "26px clamp(16px,3vw,38px)", maxWidth: 1180, width: "100%", overflowY: "auto", height: "100vh" }} className="appmain">{children}</main>
      </div>
      <nav className="mnavbar">
        {ITEMS.slice(0, 5).map(([label, ico, href]) => (
          <Link key={href} href={href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 9.5, color: on(href) ? "var(--ac)" : "var(--mut)", padding: "5px 10px", position: "relative" }}>
            <span style={{ fontSize: 18 }}>{ico}</span>{label}
            {badge(href) ? <span style={{ position: "absolute", top: 0, right: 2, background: "var(--ac)", color: "#fff", fontSize: 8.5, fontWeight: 800, minWidth: 14, height: 14, borderRadius: 7, display: "grid", placeItems: "center" }}>{badge(href)}</span> : null}
          </Link>
        ))}
      </nav>
      <BossChat />
      <style jsx global>{`
        @media (max-width: 860px) {
          .shell { grid-template-columns: 1fr !important; height: auto !important; }
          .sidedesk { display: none !important; }
          .appmain { padding: 18px 16px 96px !important; height: auto !important; min-height: 100vh; }
          .mnavbar { display: flex !important; }
        }
        .mnavbar { display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 140; background: var(--panel); border-top: 1px solid var(--line); backdrop-filter: blur(12px); justify-content: space-around; padding: 8px 4px calc(8px + env(safe-area-inset-bottom)); }
        /* reserve space so page content doesn't sit under the fixed chat dock (see components/kit.tsx BossChat) */
        @media (min-width: 900px) {
          .appmain { padding-right: 300px !important; }
        }
      `}</style>
    </div>
  );
}
