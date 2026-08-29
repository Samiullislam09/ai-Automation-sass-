import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import MemorySection from "@/components/dashboard/MemorySection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "AI Memory — MrLxwa" };

export default async function DashboardMemoryPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <MemorySection />
    </MrLxwaDashboard>
  );
}
