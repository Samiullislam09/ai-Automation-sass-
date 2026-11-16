import type { Metadata } from "next";
import LeadsSection from "@/components/dashboard/LeadsSection";

export const metadata: Metadata = { title: "Leads — MenCra" };

export default function DashboardLeadsPage() {
  return (
    <>
      <LeadsSection />
    </>
  );
}
