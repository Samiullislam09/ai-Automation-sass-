import type { Metadata } from "next";
import AuditSection from "@/components/dashboard/AuditSection";

export const metadata: Metadata = { title: "Audit — MenCra" };

export default function DashboardAuditPage() {
  return (
    <>
      <AuditSection />
    </>
  );
}
