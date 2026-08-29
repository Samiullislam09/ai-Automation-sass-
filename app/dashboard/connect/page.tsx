import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import ConnectSection from "@/components/dashboard/ConnectSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Connect — MrLxwa" };

/** Real Connect page, in the new dashboard's own theme (see components/dashboard/
 *  ConnectSection.tsx's own header comment for why) — same shell as /dashboard, so clicking
 *  "Connect" in the sidebar never jumps to the old app/app/connect page's different look. */
export default async function DashboardConnectPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <ConnectSection />
    </MrLxwaDashboard>
  );
}
