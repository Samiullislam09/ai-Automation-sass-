import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import ReportsSection from "@/components/dashboard/ReportsSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Daily Reports — MrLxwa" };

export default async function DashboardReportsPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <ReportsSection />
    </MrLxwaDashboard>
  );
}
