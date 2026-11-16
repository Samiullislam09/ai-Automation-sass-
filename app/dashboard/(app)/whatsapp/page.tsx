import type { Metadata } from "next";
import WhatsAppSection from "@/components/dashboard/WhatsAppSection";

export const metadata: Metadata = { title: "WhatsApp — MenCra" };

export default function DashboardWhatsAppPage() {
  return (
    <>
      <WhatsAppSection />
    </>
  );
}
