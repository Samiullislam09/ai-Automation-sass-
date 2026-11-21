"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hasAuthCookie } from "@/lib/auth-cookie";

/** True once we know there is a signed-in session: a session cookie is present. Read synchronously, with no Supabase code downloaded (the home page used to ship the whole Supabase client just
 *  for this). Starts false, i.e. the logged-out wording, which is also what is rendered on the server. If the cookie has expired, the link still goes to /dashboard and the middleware
 *  sends the visitor to the login page. */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { setSignedIn(hasAuthCookie()); }, []);
  return signedIn;
}

/** The signed-in user's plan id ("free" | "starter" | "growth") from /api/plan.
 *  plan is undefined while loading or when signed out, and null if the lookup failed. */
export function usePlan() {
  const signedIn = useSignedIn();
  const [plan, setPlan] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!signedIn) { setPlan(undefined); return; }
    let alive = true;
    fetch("/api/plan", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (alive) setPlan(d?.ok ? (d.plan ?? "free") : null); })
      .catch(() => { if (alive) setPlan(null); });
    return () => { alive = false; };
  }, [signedIn]);
  return { signedIn, plan };
}

/** A link that is "Log in" / "Start free" for visitors and "Dashboard" for signed-in users.
 *  `authedLabel={null}` hides the link entirely once signed in (e.g. a second "Log in" button). */
export function AuthLink({
  guestHref, guestLabel, authedLabel = "Dashboard", authedHref = "/dashboard", className, children,
}: {
  guestHref: string; guestLabel: string; authedLabel?: string | null; authedHref?: string; className?: string; children?: React.ReactNode;
}) {
  const signedIn = useSignedIn();
  if (signedIn && authedLabel === null) return null;
  return (
    <Link href={signedIn ? authedHref : guestHref} className={className}>
      <span>{signedIn ? authedLabel : guestLabel}</span>{children}
    </Link>
  );
}
