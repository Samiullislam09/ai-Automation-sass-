import type { Metadata } from "next";
import ReportDaySection from "@/components/dashboard/ReportDaySection";
import { getRequestContext } from "@/lib/supabase/request";
import { listReportItems } from "@/lib/reports-data";

/** /dashboard/reports/[day] — one day's report as a normal page rather than a modal
 *  (owner, 2026-09-05). `day` is the local calendar date, YYYY-MM-DD, exactly the key the
 *  Reports list links with. The rows are read on the server so the page arrives filled in; the
 *  day itself is worked out in the browser, because "which day" is the visitor's own local date. */
export const metadata: Metadata = { title: "Daily Report — MrLxwa" };

export default async function DashboardReportDayPage({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const { supabase, tenantId } = await getRequestContext();
  const initial = tenantId ? await listReportItems(supabase, tenantId) : null;
  return (
    <>
      <ReportDaySection day={day} initialItems={initial && !initial.error ? (initial.items as any) : undefined} />
    </>
  );
}
