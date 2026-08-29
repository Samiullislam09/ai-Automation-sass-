"use client";
import Workspace from "@/components/Workspace";

/** /dashboard/workspace ("Office (Agents)") — the real, live Agent Workspace (MASTER_PLAN
 *  §24.4b), reused unmodified. components/Workspace.tsx is real-time, honesty-by-design UI
 *  (every pixel traces to a real task/step/line — see its own header comment) built entirely
 *  against the old app/globals.css theme tokens with zero hardcoded colours, so it renders
 *  correctly in the new palette through the CSS bridge in MrLxwaDashboard.tsx (the "legacy
 *  app/** theme bridge" comment there) without touching its logic. Rendered inside
 *  <MrLxwaDashboard> as its `children` — see app/dashboard/workspace/page.tsx. */

export default function WorkspaceSection({ tenantId }: { tenantId: string | null }) {
  return <Workspace tenantId={tenantId} />;
}
