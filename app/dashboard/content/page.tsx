import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import ContentSection from "@/components/dashboard/ContentSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "Content — MrLxwa" };

export default async function DashboardContentPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <ContentSection />
    </MrLxwaDashboard>
  );
}
