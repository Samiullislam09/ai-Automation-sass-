import type { Metadata } from "next";
import LeadsSection from "@/components/dashboard/LeadsSection";

export const metadata: Metadata = { title: "Leads — MrLxwa" };

export default function DashboardLeadsPage() {
  return (
    <>
      <LeadsSection />
    </>
  );
}
