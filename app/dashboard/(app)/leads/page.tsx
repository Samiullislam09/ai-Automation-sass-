import type { Metadata } from "next";
import LeadsSection from "@/components/dashboard/LeadsSection";
import { getRequestContext } from "@/lib/supabase/request";
import { loadLeadsBoard } from "@/lib/leads-board";

export const metadata: Metadata = { title: "Leads — MenCra" };

/** The leads are read HERE, on the server, in the same request as the page, and handed to the component as its first state. The page used to ship empty, run its JavaScript,
 *  THEN ask /api/leads/board for the rows (a second round trip) and show a skeleton in between. Now the HTML already contains the rows. If the read fails the component
 *  simply loads them itself, exactly as before. */
export default async function DashboardLeadsPage() {
  const { supabase, tenantId } = await getRequestContext();
  let initialBoard: { leads: any[]; gen: any } | null = null;
  if (tenantId) {
    try {
      const b = await loadLeadsBoard(supabase, tenantId);
      if (!("error" in b)) initialBoard = { leads: b.leads, gen: b.gen };
    } catch {
      /* the component loads its own */
    }
  }
  return <LeadsSection initialBoard={initialBoard} />;
}
