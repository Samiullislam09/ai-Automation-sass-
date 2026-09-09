import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import AccountSection from "@/components/dashboard/AccountSection";
import BillingSection from "@/components/dashboard/BillingSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Account — MrLxwa" };

export default async function DashboardAccountPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <div className="space-y-6">
        <AccountSection />
        <BillingSection />
      </div>
    </MrLxwaDashboard>
  );
}
