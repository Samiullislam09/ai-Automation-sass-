import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import AuditSection from "@/components/dashboard/AuditSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Audit — MrLxwa" };

export default async function DashboardAuditPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <AuditSection />
    </MrLxwaDashboard>
  );
}
