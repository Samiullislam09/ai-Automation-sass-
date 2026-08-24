import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Log in" };
// Reads the session cookie, so it can never be statically cached.
export const dynamic = "force-dynamic";

/** If a valid session already exists, /login must NOT show the form again.
 *  This was the "har baar login karna padta hai" bug: the session was usually still
 *  there, but nothing on the public side ever looked at it — the landing page always
 *  said "Log in", and /login always rendered the password form, so signing in again
 *  was the only path back to the app. */
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/app");
  return <AuthCard mode="login" />;
}
