import type { Metadata } from "next";
import ReportDaySection from "@/components/dashboard/ReportDaySection";

/** /dashboard/reports/[day] — one day's report as a normal page rather than a modal
 *  (owner, 2026-09-05). `day` is the local calendar date, YYYY-MM-DD, exactly the key the
 *  Reports list links with. The section itself loads the data client-side from the same
 *  endpoints the list uses, so both always agree. */
export const metadata: Metadata = { title: "Daily Report — MrLxwa" };

export default async function DashboardReportDayPage({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  return (
    <>
      <ReportDaySection day={day} />
    </>
  );
}
