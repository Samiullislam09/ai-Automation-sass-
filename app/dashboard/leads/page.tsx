import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import LeadsSection from "@/components/dashboard/LeadsSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Leads — MrLxwa" };

export default async function DashboardLeadsPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <LeadsSection />
    </MrLxwaDashboard>
  );
}
