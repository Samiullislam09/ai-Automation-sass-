import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import SiteBrainSection from "@/components/dashboard/SiteBrainSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Site Brain — MrLxwa" };

export default async function DashboardSiteBrainPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <SiteBrainSection />
    </MrLxwaDashboard>
  );
}
