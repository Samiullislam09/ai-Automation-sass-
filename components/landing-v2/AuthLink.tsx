"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** True once we know there is a signed-in session. getSession() reads the local cookie (no
 *  network round trip), so the swap happens right after the page becomes interactive. Starts
 *  false, i.e. the logged-out wording, which is also what is rendered on the server. */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    try {
      createClient().auth.getSession().then(({ data }) => { if (alive) setSignedIn(!!data.session); }).catch(() => {});
    } catch { /* no Supabase env in this context: stay logged-out */ }
    return () => { alive = false; };
  }, []);
  return signedIn;
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
