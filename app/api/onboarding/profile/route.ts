import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { normalizeProfile } from "@/components/SiteBrainModel";

/** What onboarding needs to know to show step "Hamne aapki site padhi — ye samjha:" (§25.7).
 *
 *  Read only, on purpose. The confirm/correct step writes through PATCH /api/site-brain, so
 *  there is exactly ONE code path that versions a profile — the same one the Site Brain page
 *  uses. A second writer here would be a second place for the `user_edited` contract to drift.
 *
 *  The whole point of the answer is `status`, because the analyst is a background job and the
 *  user walks into this screen the moment the wizard hands them over:
 *
 *    "ready"    — a profile exists; show it and let them correct it.
 *    "thinking" — pages are crawled but no profile yet; the analyst is still reading. Say so
 *                 and let them carry on. Onboarding is never blocked on a background job.
 *    "no-pages" — nothing was crawled (no website, or the crawl failed). Nothing to confirm;
 *                 the step is skipped rather than shown empty.
 *    "off"      — migration 019 is not applied on this database. Same handling as "no-pages".
 */

export const dynamic = "force-dynamic";

const MISSING_TABLE = "42P01";

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const [{ data: row, error }, { count: pagesCrawled }] = await Promise.all([
    supabase
      .from("site_profiles")
      .select("version, profile, built_from, created_at")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .maybeSingle(),
    supabase.from("site_pages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);

  if (error && (error as any).code === MISSING_TABLE) {
    return NextResponse.json({ ok: true, status: "off", pagesCrawled: pagesCrawled ?? 0, profile: null, version: null });
  }
  if (error) {
    console.error("[onboarding/profile] read failed:", error.message);
    // Not a hard failure: the wizard treats this exactly like "thinking" and moves on. A
    // database hiccup must never be the reason somebody cannot finish signing up.
    return NextResponse.json({ ok: true, status: "thinking", pagesCrawled: pagesCrawled ?? 0, profile: null, version: null });
  }

  const pages = pagesCrawled ?? 0;
  const status = row ? "ready" : pages > 0 ? "thinking" : "no-pages";

  return NextResponse.json({
    ok: true,
    status,
    pagesCrawled: pages,
    version: row ? Number(row.version) || 1 : null,
    builtAt: row?.created_at ?? null,
    builtFromPages: Number((row?.built_from as any)?.pages) || null,
    profile: row ? normalizeProfile(row.profile) : null,
  });
}
