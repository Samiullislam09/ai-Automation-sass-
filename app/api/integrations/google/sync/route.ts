import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import {
  SCOPE_GA4, SCOPE_GBP, SCOPE_GSC,
  accessTokenFor, ga4Report, isPermissionError, listGbpLocations, loadGoogle, searchAnalytics,
} from "@/lib/google";

/** Pulls Google's numbers into `site_insights` — the agents' evidence base.
 *
 *  Each run is a full snapshot: the previous rows for a source are deleted and replaced,
 *  so a query that stopped ranking disappears instead of haunting the blueprint forever.
 *
 *  Two callers:
 *   - the browser (a signed-in user pressing "Refresh"), and
 *   - agent-server, right before Mr Lxwa plans topics, using the shared AGENT_SERVER_TOKEN.
 *  The second is why this isn't just inlined into the Connect page.
 */

// Search Console finalises data ~2 days late; asking for today returns a misleading zero.
const LAG_DAYS = 3;
const WINDOW_DAYS = 28;
// Guard against a page that mounts twice, or a scheduler tick that overlaps a manual press.
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));

  // agent-server has no user session — it authenticates with the shared secret and names
  // the tenant explicitly. Without the secret configured this path is refused outright,
  // otherwise anyone could sync (and enumerate) any tenant they can guess the id of.
  const machineToken = request.headers.get("x-agent-token");
  let supabase: SupabaseClient;
  let tenantId: string | null;

  if (machineToken) {
    if (!process.env.AGENT_SERVER_TOKEN || machineToken !== process.env.AGENT_SERVER_TOKEN) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    supabase = createAdminClient();
    tenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
    if (!tenantId) return NextResponse.json({ ok: false, error: "tenantId is required" }, { status: 400 });
  } else {
    supabase = await createClient();
    tenantId = await getCurrentTenantId(supabase);
    if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const creds = await loadGoogle(supabase, tenantId);
  if (!creds) return NextResponse.json({ ok: false, error: "Google connected nahi hai." }, { status: 400 });

  if (body?.force !== true) {
    const { data: recent } = await supabase
      .from("site_insights")
      .select("captured_at")
      .eq("tenant_id", tenantId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.captured_at && Date.now() - Date.parse(recent.captured_at) < MIN_INTERVAL_MS) {
      return NextResponse.json({ ok: true, skipped: true, reason: "6 ghante se kam purana data hai.", lastSync: recent.captured_at });
    }
  }

  let token: string;
  try {
    token = await accessTokenFor(creds);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Google token refresh fail: ${e?.message}. Reconnect karna padega.` }, { status: 502 });
  }

  const end = daysAgo(LAG_DAYS);
  const start = daysAgo(LAG_DAYS + WINDOW_DAYS);
  const has = (s: string) => (creds.scopes ?? []).includes(s);
  const capturedAt = new Date().toISOString();
  const counts = { queries: 0, gscPages: 0, ga4Pages: 0, locations: 0 };
  const errors: Record<string, string> = {};

  // ── Search Console ───────────────────────────────────────────────────────────
  if (creds.gscSiteUrl && has(SCOPE_GSC)) {
    try {
      const [queries, pages] = await Promise.all([
        searchAnalytics(token, creds.gscSiteUrl, "query", start, end, 200),
        searchAnalytics(token, creds.gscSiteUrl, "page", start, end, 100),
      ]);

      const rows = [
        ...queries.map((r) => row(tenantId!, "gsc", "query", r.key, { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }, start, end, capturedAt)),
        ...pages.map((r) => row(tenantId!, "gsc", "page", r.key, { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }, start, end, capturedAt)),
      ];
      await replace(supabase, tenantId, "gsc", rows);
      counts.queries = queries.length;
      counts.gscPages = pages.length;
    } catch (e: any) {
      errors.gsc = e?.message ?? "Search Console read failed.";
    }
  }

  // ── GA4 ──────────────────────────────────────────────────────────────────────
  if (creds.ga4PropertyId && has(SCOPE_GA4)) {
    try {
      const [totals, pages] = await Promise.all([
        ga4Report(token, creds.ga4PropertyId, {
          dateRanges: [{ startDate: start, endDate: end }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
        }),
        ga4Report(token, creds.ga4PropertyId, {
          dateRanges: [{ startDate: start, endDate: end }],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "sessions" }, { name: "averageSessionDuration" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 50,
        }),
      ]);

      const t = totals.rows[0]?.metrics ?? [];
      const rows = [
        row(tenantId!, "ga4", "summary", "site", { sessions: t[0] ?? 0, users: t[1] ?? 0, pageViews: t[2] ?? 0 }, start, end, capturedAt),
        ...pages.rows.map((r) =>
          row(tenantId!, "ga4", "page", r.dims[0] ?? "/", { sessions: r.metrics[0] ?? 0, avgSessionSeconds: Math.round(r.metrics[1] ?? 0) }, start, end, capturedAt)
        ),
      ];
      await replace(supabase, tenantId, "ga4", rows);
      counts.ga4Pages = pages.rows.length;
    } catch (e: any) {
      errors.ga4 = e?.message ?? "GA4 read failed.";
    }
  }

  // ── Business Profile ─────────────────────────────────────────────────────────
  if (has(SCOPE_GBP)) {
    try {
      const locations = await listGbpLocations(token);
      const chosen = creds.gbpLocationName ? locations.filter((l) => l.name === creds.gbpLocationName) : locations;
      await replace(
        supabase,
        tenantId,
        "gbp",
        chosen.map((l) => row(tenantId!, "gbp", "location", l.name, { title: l.title, address: l.address }, start, end, capturedAt))
      );
      counts.locations = chosen.length;
    } catch (e: any) {
      errors.gbp = isPermissionError(e?.message ?? "")
        ? "Business Profile API abhi is Google Cloud project ke liye approve nahi hui."
        : e?.message ?? "Business Profile read failed.";
    }
  }

  const nothing = Object.values(counts).every((n) => n === 0);
  return NextResponse.json({
    ok: true,
    counts,
    errors: Object.keys(errors).length ? errors : undefined,
    period: { start, end },
    lastSync: capturedAt,
    note: nothing ? "Google se koi row nahi aayi — property/site select kiya hai ya nahi, wo check karo." : undefined,
  });
}

function row(
  tenantId: string,
  source: string,
  kind: string,
  key: string,
  metrics: Record<string, unknown>,
  start: string,
  end: string,
  capturedAt: string
) {
  return { tenant_id: tenantId, source, kind, key, metrics, period_start: start, period_end: end, captured_at: capturedAt };
}

/** Full-snapshot replace. Delete-then-insert rather than upsert so rows that fell out of
 *  Google's response actually disappear. */
async function replace(supabase: SupabaseClient, tenantId: string, source: string, rows: any[]) {
  await supabase.from("site_insights").delete().eq("tenant_id", tenantId).eq("source", source);
  if (!rows.length) return;
  // Chunked: 200 queries + 100 pages in one insert is fine, but this keeps a bigger site
  // from tripping the request size limit.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("site_insights").insert(rows.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
