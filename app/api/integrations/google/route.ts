import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import {
  SCOPE_GA4, SCOPE_GBP, SCOPE_GSC,
  accessTokenFor, googleConfigured, isPermissionError,
  listGa4Properties, listGbpLocations, listSearchConsoleSites, loadGoogle, saveGoogle,
} from "@/lib/google";

/** Status + the pick-lists for the Google card on /app/connect.
 *  GET  — what's connected, and every property/site/location this account can read.
 *  PATCH— save which of them we should actually read.
 *  DELETE — forget the connection (the grant itself is revoked by the user at
 *           myaccount.google.com/permissions; that is theirs to do, not ours). */

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  if (!googleConfigured()) {
    return NextResponse.json({ ok: true, configured: false, connected: false });
  }

  const creds = await loadGoogle(supabase, tenantId);
  if (!creds) return NextResponse.json({ ok: true, configured: true, connected: false });

  const base = {
    ok: true,
    configured: true,
    connected: true,
    email: creds.email ?? null,
    scopes: creds.scopes ?? [],
    selection: {
      gscSiteUrl: creds.gscSiteUrl ?? null,
      ga4PropertyId: creds.ga4PropertyId ?? null,
      gbpLocationName: creds.gbpLocationName ?? null,
    },
  };

  let token: string;
  try {
    token = await accessTokenFor(creds);
  } catch (e: any) {
    // The refresh token is dead (revoked, or the Google account password changed).
    // Say exactly that — "reconnect" is the only fix and the user can't guess it.
    return NextResponse.json({ ...base, tokenError: e?.message ?? "Google refresh failed — reconnect karo." });
  }

  const has = (s: string) => (creds.scopes ?? []).includes(s);

  // Independent lists, so one product being unavailable must not blank out the others.
  const [sites, properties, locations, lastSync] = await Promise.all([
    has(SCOPE_GSC) ? listSearchConsoleSites(token).catch((e) => ({ error: e.message })) : Promise.resolve([]),
    has(SCOPE_GA4) ? listGa4Properties(token).catch((e) => ({ error: e.message })) : Promise.resolve([]),
    has(SCOPE_GBP)
      ? listGbpLocations(token).catch((e) => ({
          error: isPermissionError(e.message)
            ? "Google ne is project ko Business Profile API access nahi diya hai — Google se access request approve karana padta hai."
            : e.message,
        }))
      : Promise.resolve([]),
    // Wrapped: Supabase's builder is only PromiseLike, so it has .then but no .catch —
    // and this must not be the thing that blanks out the whole card.
    (async () => {
      const { data } = await supabase
        .from("site_insights")
        .select("captured_at")
        .eq("tenant_id", tenantId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.captured_at ?? null;
    })().catch(() => null),
  ]);

  return NextResponse.json({ ...base, sites, properties, locations, lastSync });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const creds = await loadGoogle(supabase, tenantId);
  if (!creds) return NextResponse.json({ ok: false, error: "Google connected nahi hai." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const next = {
    ...creds,
    gscSiteUrl: pick(body?.gscSiteUrl, creds.gscSiteUrl),
    ga4PropertyId: pick(body?.ga4PropertyId, creds.ga4PropertyId),
    gbpLocationName: pick(body?.gbpLocationName, creds.gbpLocationName),
  };

  const { error } = await saveGoogle(supabase, tenantId, next);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, selection: { gscSiteUrl: next.gscSiteUrl, ga4PropertyId: next.ga4PropertyId, gbpLocationName: next.gbpLocationName } });
}

export async function DELETE() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  await supabase.from("integrations").delete().eq("tenant_id", tenantId).eq("type", "google");
  // The measurements go too: they are Google's data about this business, and keeping them
  // after the customer disconnects would mean the agents keep quoting a source that is no
  // longer authorised.
  await supabase.from("site_insights").delete().eq("tenant_id", tenantId);
  return NextResponse.json({ ok: true });
}

/** "" is a real choice (clear the selection); undefined means "leave it alone". */
function pick(incoming: unknown, current: string | null | undefined): string | null {
  if (incoming === undefined) return current ?? null;
  const v = String(incoming ?? "").trim();
  return v ? v : null;
}
