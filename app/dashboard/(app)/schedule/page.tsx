import type { Metadata } from "next";
import ScheduleSection from "@/components/dashboard/ScheduleSection";
import { readRoute } from "@/lib/server-read";
import { GET as getSchedule } from "@/app/api/schedule/route";
import { GET as getHistory } from "@/app/api/schedule/history/route";
import { GET as getOrders } from "@/app/api/scheduled-orders/route";
import { GET as getIntegrations } from "@/app/api/integrations/route";

export const metadata: Metadata = { title: "Schedule — MenCra" };

/** The four things this page shows are read HERE, on the server, in parallel, with the page (each is the route's own handler, so the page and the API cannot disagree). The page
 *  used to paint every switch OFF, then fetch the same four things and flip them. If any read fails the component loads its own. */
export default async function DashboardSchedulePage() {
  const [schedule, history, orders, integrations] = await Promise.all([
    readRoute(getSchedule), readRoute(getHistory), readRoute(getOrders), readRoute(getIntegrations),
  ]);
  const initial = schedule ? { schedule, history, orders, integrations } : null;
  return (
    <>
      <ScheduleSection initial={initial} />
    </>
  );
}
