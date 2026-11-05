import type { Metadata } from "next";
import MemorySection from "@/components/dashboard/MemorySection";

export const metadata: Metadata = { title: "AI Memory — MrLxwa" };

export default function DashboardMemoryPage() {
  return (
    <>
      <MemorySection />
    </>
  );
}
