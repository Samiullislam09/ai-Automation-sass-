import type { Metadata } from "next";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import ReportDaySection from "@/components/dashboard/ReportDaySection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** /dashboard/reports/[day] — one day's report as a normal page rather than a modal
 *  (owner, 2026-09-05). `day` is the local calendar date, YYYY-MM-DD, exactly the key the
 *  Reports list links with. The section itself loads the data client-side from the same
 *  endpoints the list uses, so both always agree. */
export const metadata: Metadata = { title: "Daily Report — MrLxwa" };

export default async function DashboardReportDayPage({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return (
    <MrLxwaDashboard tenantId={tenantId}>
      <ReportDaySection day={day} />
    </MrLxwaDashboard>
  );
}
