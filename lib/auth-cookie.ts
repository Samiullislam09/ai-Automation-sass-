/** Is there a Supabase session cookie in this browser? A cheap, synchronous check that needs no Supabase code.
 *
 *  The public pages (the home page above all) used to download and start the whole Supabase client (~65 kB gzip, two chunks) just to learn that a visitor is not signed in. Every way of
 *  signing in ends in a full page load (the login form navigates with location.href, the OAuth callback redirects), so a browser with no session cookie can be treated as signed out
 *  without asking Supabase. The cookie is named sb-<project>-auth-token, split into .0 .1 ... when long. */
export function hasAuthCookie(): boolean {
  try {
    return document.cookie.split(";").some((c) => /^\s*sb-[^=]+-auth-token(\.\d+)?=/.test(c));
  } catch {
    return false;
  }
}
