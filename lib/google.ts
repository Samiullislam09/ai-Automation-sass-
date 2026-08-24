import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/crypto";

/** Google connection for a tenant — Search Console, GA4 and Business Profile.
 *
 *  Deliberately written against Google's plain REST endpoints with fetch() instead of
 *  pulling in `googleapis` (a ~40MB dependency for four URLs). Server-only: it decrypts
 *  the refresh token.
 *
 *  ONE Google connection covers all three products; which of them the tenant actually
 *  granted is recorded in `scopes`, and every read checks that first — asking GA4 for a
 *  report with a Search-Console-only grant is a 403 that reads like a bug otherwise.
 */

export const SCOPE_GSC = "https://www.googleapis.com/auth/webmasters.readonly";
export const SCOPE_GA4 = "https://www.googleapis.com/auth/analytics.readonly";
export const SCOPE_GBP = "https://www.googleapis.com/auth/business.manage";

export type GoogleCreds = {
  refreshToken: string;   // encrypted at rest
  scopes: string[];
  email?: string | null;
  gscSiteUrl?: string | null;
  ga4PropertyId?: string | null;   // "properties/123456789"
  gbpLocationName?: string | null; // "locations/123..."
};

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(origin: string): string {
  // An explicit env wins because Google matches the redirect URI byte-for-byte against the
  // list in the Cloud console — a preview deployment's own origin would never match.
  return process.env.GOOGLE_REDIRECT_URI || `${origin}/api/integrations/google/callback`;
}

export function consentUrl(origin: string, state: string, includeGbp: boolean): string {
  const scopes = [SCOPE_GSC, SCOPE_GA4, ...(includeGbp ? [SCOPE_GBP] : [])];
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: scopes.join(" "),
    // offline + consent is what actually produces a refresh_token. Without prompt=consent
    // Google returns one only on the very first authorisation ever, so a reconnect after a
    // disconnect would silently come back with no way to refresh.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, origin: string) {
  return tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error_description || data?.error || `Google token endpoint returned ${res.status}`);
  return data as { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
}

/** Refresh tokens are long-lived; access tokens last an hour. Nothing is cached between
 *  requests on purpose — a serverless function has nowhere durable to cache it, and one
 *  extra ~150ms call is cheaper than reasoning about a stale token. */
export async function accessTokenFor(creds: GoogleCreds): Promise<string> {
  const { access_token } = await tokenRequest({
    refresh_token: decrypt(creds.refreshToken),
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  return access_token;
}

export function packCreds(refreshTokenPlain: string, scopes: string[], email: string | null, keep?: Partial<GoogleCreds>): GoogleCreds {
  return {
    refreshToken: encrypt(refreshTokenPlain),
    scopes,
    email,
    gscSiteUrl: keep?.gscSiteUrl ?? null,
    ga4PropertyId: keep?.ga4PropertyId ?? null,
    gbpLocationName: keep?.gbpLocationName ?? null,
  };
}

export async function loadGoogle(supabase: SupabaseClient, tenantId: string): Promise<GoogleCreds | null> {
  const { data } = await supabase
    .from("integrations")
    .select("encrypted_credentials")
    .eq("tenant_id", tenantId)
    .eq("type", "google")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const creds = data?.encrypted_credentials as GoogleCreds | undefined;
  return creds?.refreshToken ? creds : null;
}

export async function saveGoogle(supabase: SupabaseClient, tenantId: string, creds: GoogleCreds) {
  await supabase.from("integrations").delete().eq("tenant_id", tenantId).eq("type", "google");
  return supabase.from("integrations").insert({
    tenant_id: tenantId,
    type: "google",
    status: "connected",
    encrypted_credentials: creds as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  });
}

// ── Google API calls ────────────────────────────────────────────────────────────────

async function gapi<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error?.message ?? `${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Every Search Console property this Google account can read. */
export async function listSearchConsoleSites(token: string): Promise<{ siteUrl: string; permission: string }[]> {
  const data = await gapi<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(
    "https://www.googleapis.com/webmasters/v3/sites",
    token
  );
  return (data.siteEntry ?? []).map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
}

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };

export async function searchAnalytics(
  token: string,
  siteUrl: string,
  dimension: "query" | "page",
  startDate: string,
  endDate: string,
  rowLimit = 200
): Promise<GscRow[]> {
  const data = await gapi<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    { method: "POST", body: JSON.stringify({ startDate, endDate, dimensions: [dimension], rowLimit }) }
  );
  return (data.rows ?? []).map((r) => ({
    key: r.keys[0],
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));
}

/** GA4 properties, flattened out of the account -> property tree the Admin API returns. */
export async function listGa4Properties(token: string): Promise<{ property: string; displayName: string; account: string }[]> {
  const data = await gapi<{
    accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[];
  }>("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", token);

  return (data.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? []).map((p) => ({ property: p.property, displayName: p.displayName, account: a.displayName }))
  );
}

export async function ga4Report(
  token: string,
  property: string,
  body: Record<string, unknown>
): Promise<{ rows: { dims: string[]; metrics: number[] }[] }> {
  const data = await gapi<{ rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] }>(
    `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
    token,
    { method: "POST", body: JSON.stringify(body) }
  );
  return {
    rows: (data.rows ?? []).map((r) => ({
      dims: (r.dimensionValues ?? []).map((d) => d.value),
      metrics: (r.metricValues ?? []).map((m) => Number(m.value) || 0),
    })),
  };
}

/** Business Profile. Google gates these APIs behind a per-project access request, so a
 *  clean 403 here is the normal state for a brand-new Cloud project, not a bug — callers
 *  surface that wording rather than "something went wrong". */
export async function listGbpLocations(token: string): Promise<{ name: string; title: string; address: string | null }[]> {
  const accounts = await gapi<{ accounts?: { name: string; accountName: string }[] }>(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    token
  );

  const out: { name: string; title: string; address: string | null }[] = [];
  for (const acc of accounts.accounts ?? []) {
    const locs = await gapi<{ locations?: { name: string; title: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[] }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
      token
    );
    for (const l of locs.locations ?? []) {
      const addr = [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality].filter(Boolean).join(", ");
      out.push({ name: l.name, title: l.title, address: addr || null });
    }
  }
  return out;
}

export function isPermissionError(message: string): boolean {
  return /permission|denied|403|not been used|disabled/i.test(message);
}
