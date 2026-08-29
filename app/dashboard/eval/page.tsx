import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import EvalSection from "@/components/dashboard/EvalSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Intent eval — MrLxwa" };

export default async function DashboardEvalPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <EvalSection />
    </MrLxwaDashboard>
  );
}
