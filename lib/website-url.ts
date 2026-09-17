import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSiteUrl } from "./crawl";

/** Whatever the crawler should read for this tenant — self-healing, same rationale as
 *  getCurrentTenantId (lib/supabase/tenant.ts).
 *
 *  Found live 2026-09-07: connecting WordPress or a Custom Website from /dashboard/connect
 *  (`/api/integrations`) only ever tested credentials and inserted a row into `integrations`.
 *  It never touched `tenants.website_url` — the ONLY column the crawler (agent-server's
 *  crawler.ts) reads — so a tenant could show "WordPress: Connected" on the Connect page
 *  forever while Site Brain kept saying "we haven't read your site yet" and Memory kept
 *  saying "no site connected". Onboarding's own "paste your website" step
 *  (app/api/onboarding/site/route.ts) writes this column directly and never had the bug.
 *
 *  Call this instead of reading `tenants.website_url` raw anywhere a missing value should be
 *  recovered from an already-connected integration rather than treated as "nothing to do
 *  here" — it derives the address from WordPress's siteUrl or a Custom Website endpoint's
 *  origin, and backfills the tenant so this only ever needs to run once per tenant.
 *
 *  A CONNECTED INTEGRATION OUTRANKS THE TYPED-IN COLUMN, and that ordering is the whole point
 *  of the second fix here (2026-09-18). This used to return `tenants.website_url` whenever it
 *  held anything at all, so the recovery below only ever ran for an EMPTY column. Found live:
 *  a tenant typed "s.com" into onboarding after connecting WordPress —
 *  app/api/onboarding/site/route.ts writes that column unconditionally — and from then on the
 *  whole product answered questions about `https://s.com`, a site nobody had ever crawled,
 *  while all 156 crawled pages and every published article belonged to wca-global.com. Chat
 *  was not hallucinating the wrong site name; it was faithfully reporting a column that had
 *  been overwritten with an unverified string.
 *
 *  So: the typed value is a claim, and a connected integration is evidence — we held working
 *  credentials against it. Evidence wins, and the stale claim is corrected on the way past. */
export async function resolveWebsiteUrl(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  const [{ data: tenant }, { data: rows }] = await Promise.all([
    supabase.from("tenants").select("website_url").eq("id", tenantId).maybeSingle(),
    supabase
      .from("integrations")
      .select("type, encrypted_credentials")
      .eq("tenant_id", tenantId)
      .eq("status", "connected")
      .in("type", ["wordpress", "webhook"]),
  ]);
  const existing = (tenant?.website_url as string | null) ?? null;

  const wordpress = (rows ?? []).find((r) => r.type === "wordpress");
  const webhook = (rows ?? []).find((r) => r.type === "webhook");
  const creds = (wordpress ?? webhook)?.encrypted_credentials as Record<string, string> | undefined;
  // A Custom Website's field is an API endpoint ("https://site.com/api/mrlxwa"), not a page —
  // only its origin is worth crawling. WordPress's siteUrl already IS the homepage.
  const raw = wordpress ? creds?.siteUrl : webhook ? originOf(creds?.url) : null;
  const verified = normalizeSiteUrl(raw ?? undefined);

  if (!verified) return existing;
  // Same site written two ways ("wca-global.com" vs "https://wca-global.com/") is not a
  // disagreement worth a write — compare what they actually point at.
  if (existing && sameSite(existing, verified)) return existing;

  const { error } = await supabase.from("tenants").update({ website_url: verified }).eq("id", tenantId);
  if (error) {
    console.error("[resolveWebsiteUrl] backfill failed:", error.message);
    // The column could not be corrected, but the caller still asked which site is real.
    return verified;
  }
  if (existing) console.warn(`[resolveWebsiteUrl] corrected ${existing} → ${verified} from a connected integration`);
  return verified;
}

/** Do two addresses name the same site? Host only, "www." folded, so a scheme or trailing
 *  slash difference never counts as the tenant having changed sites. */
function sameSite(a: string, b: string): boolean {
  const host = (s: string) => {
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    try {
      return new URL(withScheme).host.replace(/^www\./i, "").toLowerCase();
    } catch {
      return s.trim().replace(/^www\./i, "").toLowerCase();
    }
  };
  return host(a) === host(b);
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
