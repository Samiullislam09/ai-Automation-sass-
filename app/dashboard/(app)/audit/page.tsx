import type { Metadata } from "next";
import AuditSection from "@/components/dashboard/AuditSection";

export const metadata: Metadata = { title: "Audit — MrLxwa" };

export default function DashboardAuditPage() {
  return (
    <>
      <AuditSection />
    </>
  );
}
