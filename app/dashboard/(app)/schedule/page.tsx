import type { Metadata } from "next";
import ScheduleSection from "@/components/dashboard/ScheduleSection";

export const metadata: Metadata = { title: "Schedule — MrLxwa" };

export default function DashboardSchedulePage() {
  return (
    <>
      <ScheduleSection />
    </>
  );
}
