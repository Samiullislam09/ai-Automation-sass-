import type { Metadata } from "next";
import AutopilotSection from "@/components/dashboard/AutopilotSection";

export const metadata: Metadata = { title: "Autopilot — MenCra" };

export default function DashboardAutopilotPage() {
  return <AutopilotSection />;
}
