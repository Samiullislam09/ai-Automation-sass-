import type { Metadata } from "next";
import EvalSection from "@/components/dashboard/EvalSection";

export const metadata: Metadata = { title: "Intent eval — MenCra" };

export default function DashboardEvalPage() {
  return (
    <>
      <EvalSection />
    </>
  );
}
