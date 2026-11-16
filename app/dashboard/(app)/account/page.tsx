import type { Metadata } from "next";
import AccountSection from "@/components/dashboard/AccountSection";
import BillingSection from "@/components/dashboard/BillingSection";

export const metadata: Metadata = { title: "Account — MenCra" };

export default function DashboardAccountPage() {
  return (
    <>
      <div className="space-y-6">
        <AccountSection />
        <BillingSection />
      </div>
    </>
  );
}
