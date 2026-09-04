import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import SiteBrainFieldPage from "@/components/dashboard/SiteBrainFieldPage";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** /dashboard/site-brain/[field] — one Site Brain fact on its own page, so adding or
 *  correcting it is a normal page and not a panel inside a list (owner, 2026-09-05).
 *  `field` is a ProfileField name; the section validates it and says so if it isn't one. */
export const metadata: Metadata = { title: "Site Brain — MrLxwa" };

export default async function DashboardSiteBrainFieldPage({ params }: { params: Promise<{ field: string }> }) {
  const { field } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <SiteBrainFieldPage field={field} />
    </MrLxwaDashboard>
  );
}
