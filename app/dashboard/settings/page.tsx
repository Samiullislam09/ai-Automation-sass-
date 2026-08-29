import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import BillingSection from "@/components/dashboard/BillingSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Billing & Plans — MrLxwa" };

export default async function DashboardSettingsPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <BillingSection />
    </MrLxwaDashboard>
  );
}
