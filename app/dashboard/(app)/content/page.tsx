import type { Metadata } from "next";
import ContentSection from "@/components/dashboard/ContentSection";

export const metadata: Metadata = { title: "Content — MrLxwa" };

export default function DashboardContentPage() {
  return (
    <>
      <ContentSection />
    </>
  );
}
