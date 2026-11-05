import type { Metadata } from "next";
import ConnectSection from "@/components/dashboard/ConnectSection";

export const metadata: Metadata = { title: "Connect — MrLxwa" };

/** Real Connect page, in the new dashboard's own theme (see components/dashboard/
 *  ConnectSection.tsx's own header comment for why) — same shell as /dashboard, so clicking
 *  "Connect" in the sidebar never jumps to the old app/app/connect page's different look. */
export default function DashboardConnectPage() {
  return (
    <>
      <ConnectSection />
    </>
  );
}
