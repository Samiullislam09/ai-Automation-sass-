import type { Metadata } from "next";
import SiteBrainFieldPage from "@/components/dashboard/SiteBrainFieldPage";

/** /dashboard/site-brain/[field] — one Site Brain fact on its own page, so adding or
 *  correcting it is a normal page and not a panel inside a list (owner, 2026-09-05).
 *  `field` is a ProfileField name; the section validates it and says so if it isn't one. */
export const metadata: Metadata = { title: "Site Brain — MenCra" };

export default async function DashboardSiteBrainFieldPage({ params }: { params: Promise<{ field: string }> }) {
  const { field } = await params;
  return (
    <>
      <SiteBrainFieldPage field={field} />
    </>
  );
}
