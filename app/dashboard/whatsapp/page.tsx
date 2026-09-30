import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import WhatsAppSection from "@/components/dashboard/WhatsAppSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

export const metadata: Metadata = { title: "WhatsApp — MrLxwa" };

export default async function DashboardWhatsAppPage() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <WhatsAppSection />
    </MrLxwaDashboard>
  );
}
