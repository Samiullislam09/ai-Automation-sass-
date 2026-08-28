import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";

export const metadata: Metadata = { title: "Dashboard — MrLxwa" };

/** The real dashboard, approved 2026-08-29 to replace /app (app/app/page.tsx, renamed to
 *  page.tsx.outdated — unrouted, kept for reference, not deleted). Deliberately a top-level
 *  route, NOT under app/app/**: that route group's layout.tsx wraps every page in <AppShell>,
 *  which already renders its own sidebar/topbar/chat; MrLxwaDashboard is a full standalone
 *  page shell with its own sidebar/topbar/assistant panel, and the two would nest inside
 *  each other.
 *
 *  The Assistant panel talks to the real /api/chat (see components/MrLxwaDashboard.tsx's
 *  `stream()`) — same backend as production's BossChat. The workflow/agent-network data is
 *  still the mockup's own placeholder data; wiring that to real tasks/agents is the next step.
 *
 *  No auth/onboarding gate here yet (app/app/layout.tsx's redirect logic) — this is running
 *  local-only for now, per the owner ("abhi hum local pe hain"). Add that gate before this
 *  is meant to be reachable by real signed-out visitors. */
export default function DashboardPage() {
  return <MrLxwaDashboard />;
}
