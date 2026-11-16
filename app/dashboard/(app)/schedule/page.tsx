import type { Metadata } from "next";
import ScheduleSection from "@/components/dashboard/ScheduleSection";

export const metadata: Metadata = { title: "Schedule — MenCra" };

export default function DashboardSchedulePage() {
  return (
    <>
      <ScheduleSection />
    </>
  );
}
