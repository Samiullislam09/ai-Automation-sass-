import type { Metadata } from "next";
import ApprovalsSection from "@/components/dashboard/ApprovalsSection";
import { getRequestContext } from "@/lib/supabase/request";
import { listContentItems } from "@/lib/content-list";

export const metadata: Metadata = { title: "Approvals — MrLxwa" };

export default async function DashboardApprovalsPage() {
  const { supabase, tenantId } = await getRequestContext();
  // The list is read here, on the server, so the page arrives WITH its rows. Before, the browser
  // downloaded the page, ran it, then asked the server for the list: a second round trip that
  // showed as an empty "Loading..." screen every time.
  const initial = tenantId ? await listContentItems(supabase, tenantId, { status: "all" }) : null;
  return (
    <>
      <ApprovalsSection initialItems={initial && !initial.error ? initial.items : undefined} />
    </>
  );
}
