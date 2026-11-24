import type { Metadata } from "next";
import Landing from "@/components/landing-v2/Landing";
import { GoogleOneTap } from "@/components/GoogleOneTap";
import { homeStructuredData } from "@/lib/structured-data";

// The canonical is the real domain: a copy served from another address (a *.vercel.app preview) is not indexed as a duplicate.
export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Home page. The previous pixel-art landing (components/landing-pixel) is kept in git history. */
export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData()).replace(/</g, "\u003c") }} />
      <Landing />
      {/* One Tap: loaded after the page has had time to paint, and only for a visitor who is not signed in. */}
      <GoogleOneTap deferMs={2500} />
    </>
  );
}
