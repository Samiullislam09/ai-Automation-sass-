import type { Metadata } from "next";
import ReportsSection from "@/components/dashboard/ReportsSection";
import { getRequestContext } from "@/lib/supabase/request";
import { listReportItems } from "@/lib/reports-data";

export const metadata: Metadata = { title: "Daily Reports — MenCra" };

export default async function DashboardReportsPage() {
  // Read here, on the server, so the page arrives WITH its rows instead of a spinner.
  const { supabase, tenantId } = await getRequestContext();
  const initial = tenantId ? await listReportItems(supabase, tenantId) : null;
  return (
    <>
      <ReportsSection initialItems={initial && !initial.error ? (initial.items as any) : undefined} truncated={initial?.truncated} />
    </>
  );
}
