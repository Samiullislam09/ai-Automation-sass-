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
 *  origin, and backfills the tenant so this only ever needs to run once per tenant. */
export async function resolveWebsiteUrl(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data: tenant } = await supabase.from("tenants").select("website_url").eq("id", tenantId).maybeSingle();
  const existing = (tenant?.website_url as string | null) ?? null;
  if (existing) return existing;

  const { data: rows } = await supabase
    .from("integrations")
    .select("type, encrypted_credentials")
    .eq("tenant_id", tenantId)
    .eq("status", "connected")
    .in("type", ["wordpress", "webhook"]);

  const wordpress = (rows ?? []).find((r) => r.type === "wordpress");
  const webhook = (rows ?? []).find((r) => r.type === "webhook");
  const creds = (wordpress ?? webhook)?.encrypted_credentials as Record<string, string> | undefined;
  // A Custom Website's field is an API endpoint ("https://site.com/api/mrlxwa"), not a page —
  // only its origin is worth crawling. WordPress's siteUrl already IS the homepage.
  const raw = wordpress ? creds?.siteUrl : webhook ? originOf(creds?.url) : null;
  const derived = normalizeSiteUrl(raw ?? undefined);
  if (!derived) return null;

  const { error } = await supabase.from("tenants").update({ website_url: derived }).eq("id", tenantId);
  if (error) console.error("[resolveWebsiteUrl] backfill failed:", error.message);
  return derived;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
