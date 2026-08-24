import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import OnboardingWizard from "@/components/OnboardingWizard";

/** The other half of the gate: an already-onboarded tenant must never see this wizard.
 *
 *  Finishing it overwrites the tenant's niche, tone and ICP and re-asks for the publishing
 *  connection, so landing here by accident (a stale tab, a bookmarked URL, or the redirect
 *  bug this replaces) meant walking through a form that quietly replaced a working profile.
 *  Anyone who genuinely wants to change those answers edits them in the app instead. */
export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);

  if (tenantId) {
    const { data, error } = await supabase.from("tenants").select("onboarded").eq("id", tenantId).single();
    // Only bounce on a definite yes — mirroring the /app gate, which only redirects on a
    // definite no. A failed read leaves the wizard reachable rather than trapping the user
    // between two redirects.
    if (!error && data?.onboarded === true) redirect("/app");
  }

  return <OnboardingWizard />;
}
