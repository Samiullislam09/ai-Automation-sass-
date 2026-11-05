import type { Metadata } from "next";
import SiteBrainSection from "@/components/dashboard/SiteBrainSection";

export const metadata: Metadata = { title: "Site Brain — MrLxwa" };

export default function DashboardSiteBrainPage() {
  return (
    <>
      <SiteBrainSection />
    </>
  );
}
