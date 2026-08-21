import AICommandCenter from "@/components/dashboard/AICommandCenter";

/** Dashboard root — the pixel-art "AI Command Center" scene, ported 1:1 from the
 *  user-supplied reference build and wired to real data (see the component's own
 *  [BACKEND-EVENTS]/[BACKEND-CHAT] comments + app/api/dashboard/live).
 *  This component renders its OWN sidebar + topbar + chat panel — app/app/layout.tsx
 *  skips its shared shell for this one route (see the `isDashboard` check there). */
export default function DashboardPage() {
  return <AICommandCenter />;
}
