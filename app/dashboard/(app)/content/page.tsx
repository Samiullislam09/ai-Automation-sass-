import type { Metadata } from "next";
import ContentSection from "@/components/dashboard/ContentSection";
import { getRequestContext } from "@/lib/supabase/request";
import { listContentItems } from "@/lib/content-list";

export const metadata: Metadata = { title: "Content — MenCra" };

/** Same as Approvals: the list is read HERE, on the server, so the page arrives with its rows. It used to ship empty, run its JavaScript, then ask /api/content for the list
 *  (and show "Loading" in between): that was the whole reason this page felt slow. */
export default async function DashboardContentPage() {
  const { supabase, tenantId } = await getRequestContext();
  const initial = tenantId ? await listContentItems(supabase, tenantId, { status: "all" }) : null;
  return (
    <>
      <ContentSection initialItems={initial && !initial.error ? initial.items : undefined} />
    </>
  );
}
