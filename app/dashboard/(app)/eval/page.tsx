import type { Metadata } from "next";
import EvalSection from "@/components/dashboard/EvalSection";

export const metadata: Metadata = { title: "Intent eval — MrLxwa" };

export default function DashboardEvalPage() {
  return (
    <>
      <EvalSection />
    </>
  );
}
