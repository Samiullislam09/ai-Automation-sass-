import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Start free" };
export const dynamic = "force-dynamic";

/** Same as /login — an already-signed-in user landing here goes straight to the app
 *  instead of being asked to create a second account. */
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/app");
  return <AuthCard mode="signup" />;
}
