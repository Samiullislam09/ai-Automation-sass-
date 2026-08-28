import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";

export const metadata: Metadata = { title: "Dashboard Preview — MrLxwa" };

/** A standalone render of the user-supplied MrLxwaDashboard.tsx mockup (2026-08-28), for
 *  visual review before any decision to replace the real /app dashboard. Deliberately NOT
 *  under app/app/** — that route group's layout.tsx wraps every page in <AppShell>, which
 *  already renders its own sidebar/topbar; MrLxwaDashboard is a full standalone page shell
 *  with its own sidebar/topbar/assistant panel, and the two would nest inside each other.
 *
 *  All data inside the component is still the mockup's own placeholder data — nothing here
 *  is wired to real tasks/agents/chat yet. */
export default function DashboardPreviewPage() {
  return <MrLxwaDashboard />;
}
