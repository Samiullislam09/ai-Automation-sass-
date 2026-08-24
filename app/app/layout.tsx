import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import AppShell from "@/components/AppShell";

/** The onboarding gate, decided on the server.
 *
 *  It used to be a client-side effect: the browser asked Supabase whether the tenant was
 *  onboarded and redirected if the answer came back falsy. The problem is that "falsy" and
 *  "we don't know yet" looked identical — a query that failed, was blocked by RLS before the
 *  session attached, or returned an unexpected shape all read as "not onboarded", and the
 *  user was pushed back into the wizard with their real, completed profile sitting untouched
 *  in the database. Logging out and back in was the reliable way to trigger it.
 *
 *  Here there is no race and no guessing: one authoritative read, before anything renders.
 *  And it redirects ONLY on a definite `onboarded === false`. If the read fails, the app
 *  renders — a broken query must never look like a brand-new account. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // middleware.ts already guarantees a session on /app/**, so a missing tenant here means the
  // lookup itself failed rather than that the user is new — fail open and let the app load.
  const tenantId = await getCurrentTenantId(supabase);
  if (tenantId) {
    const { data, error } = await supabase.from("tenants").select("onboarded").eq("id", tenantId).single();
    if (!error && data?.onboarded === false) redirect("/onboarding");
  }

  return <AppShell>{children}</AppShell>;
}
