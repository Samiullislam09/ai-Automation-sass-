"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { BossChat } from "@/components/kit";

const ITEMS = [
  ["Dashboard", "▦", "/app"], ["Content", "✍️", "/app/content"], ["Approvals", "☑", "/app/approvals"],
  ["Reports", "🗒", "/app/reports"], ["Memory", "🧠", "/app/memory"], ["Billing", "💳", "/app/billing"],
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { s, signOut } = useStore();
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    // real session is enforced server-side by middleware.ts now — this only handles the
    // onboarding gate, which is still local demo state until Build Guide Step 4 wires it to the DB.
    if (s.user && !s.onboarded) router.replace("/onboarding");
  }, [s.user, s.onboarded, router]);

  const unread = s.reports.filter((r: any) => r.unread).length;
  const wait = s.content.filter((c: any) => c.status === "awaiting").length;
  const badge = (href: string) => (href === "/app/reports" && unread) ? unread : (href === "/app/approvals" && wait) ? wait : 0;
  const on = (href: string) => href === "/app" ? path === "/app" : path.startsWith(href);

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <div className="shell" style={{ display: "grid", gridTemplateColumns: "232px 1fr", minHeight: "100vh" }}>
        <aside className="sidedesk" style={{ background: "var(--bg2)", borderRight: "1px solid #16203a", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: 0, height: "100vh" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, color: "var(--ink)", padding: "4px 8px 16px" }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,var(--ac),#2bb99a)", display: "grid", placeItems: "center", color: "#04120d", fontSize: 13 }}>⚡</span>GrowthTeam
          </Link>
          {ITEMS.map(([label, ico, href]) => (
            <Link key={href} href={href} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 11, fontSize: 13.5, fontWeight: 500, transition: "all .2s", color: on(href) ? "var(--ink)" : "var(--mut)", background: on(href) ? "linear-gradient(90deg,#1a2a4a,#141d36)" : "transparent", boxShadow: on(href) ? "inset 2px 0 0 var(--ac)" : "none" }}>
              <span>{ico}</span>{label}
              {badge(href) ? <span style={{ marginLeft: "auto", background: "var(--ac)", color: "#04120d", fontSize: 10, fontWeight: 800, minWidth: 17, height: 17, borderRadius: 9, display: "grid", placeItems: "center", padding: "0 5px" }}>{badge(href)}</span> : null}
            </Link>
          ))}
          <div style={{ flex: 1 }} />
          {s.user && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 10px", fontSize: 12 }}>
              <span className="mut" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.user.email}</span>
              <a onClick={signOut} style={{ cursor: "pointer", color: "var(--mut)", flexShrink: 0, marginLeft: 8 }}>Log out</a>
            </div>
          )}
        </aside>
        <main style={{ padding: "26px clamp(16px,3vw,38px)", maxWidth: 1180, width: "100%" }} className="appmain">{children}</main>
      </div>
      <nav className="mnavbar">
        {ITEMS.slice(0, 5).map(([label, ico, href]) => (
          <Link key={href} href={href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 9.5, color: on(href) ? "var(--ac)" : "var(--mut)", padding: "5px 10px", position: "relative" }}>
            <span style={{ fontSize: 18 }}>{ico}</span>{label}
            {badge(href) ? <span style={{ position: "absolute", top: 0, right: 2, background: "var(--ac)", color: "#04120d", fontSize: 8.5, fontWeight: 800, minWidth: 14, height: 14, borderRadius: 7, display: "grid", placeItems: "center" }}>{badge(href)}</span> : null}
          </Link>
        ))}
      </nav>
      <BossChat />
      <style jsx global>{`
        @media (max-width: 860px) {
          .shell { grid-template-columns: 1fr !important; }
          .sidedesk { display: none !important; }
          .appmain { padding: 18px 16px 96px !important; }
          .mnavbar { display: flex !important; }
        }
        .mnavbar { display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 140; background: #0c1120f2; border-top: 1px solid var(--line); backdrop-filter: blur(12px); justify-content: space-around; padding: 8px 4px calc(8px + env(safe-area-inset-bottom)); }
        /* reserve space so page content doesn't sit under the fixed chat dock (see components/kit.tsx BossChat) */
        @media (min-width: 900px) {
          .appmain { padding-right: calc(clamp(16px,3vw,38px) + 360px) !important; }
        }
      `}</style>
    </div>
  );
}
