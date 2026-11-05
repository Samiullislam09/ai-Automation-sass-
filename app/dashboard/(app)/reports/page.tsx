import type { Metadata } from "next";
import ReportsSection from "@/components/dashboard/ReportsSection";

export const metadata: Metadata = { title: "Daily Reports — MrLxwa" };

export default function DashboardReportsPage() {
  return (
    <>
      <ReportsSection />
    </>
  );
}
