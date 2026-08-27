import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import {
  PROFILE_FIELDS,
  coerceField,
  emptyProfile,
  isProfileField,
  normalizeProfile,
  type ProfileField,
  type SiteProfile,
} from "@/components/SiteBrainModel";

/** The Site Brain, read and corrected by its owner (rebuild plan §25.2 / §25.9).
 *
 *  GET   → the active profile, its version, when it was built and what it was built from,
 *          plus the metadata of every earlier version.
 *  PATCH → the user's own value for one or more fields.
 *
 *  The two rules this route exists to keep:
 *
 *   1. A PROFILE IS NEVER EDITED IN PLACE. PATCH writes version N+1 and moves the `active`
 *      flag, exactly the way agent-server's saveProfile() does — same order, same retry, same
 *      reasons (see the block comment on `writeVersion` below). The old jsonb stays readable
 *      forever, which is what makes the version list and a future one-click rollback real.
 *
 *   2. THE USER'S EDIT WINS. Every field named in a PATCH is added to `profile.user_edited`,
 *      the flat array of field names that analyst.ts reads back as
 *      `previous?.profile.user_edited ?? []` and then copies forward untouched on its next
 *      run. Without that entry, next week's re-crawl would quietly overwrite the correction —
 *      which is the entire failure §25.9 was written to stop.
 *
 *  Tenant scoping is the app's normal one: `createClient()` is the anon key plus the request's
 *  cookies, so site_profiles' RLS policy (is_tenant_member) applies as the signed-in user; the
 *  explicit .eq("tenant_id", …) is belt and braces, not the security boundary.
 */

export const dynamic = "force-dynamic";

/** 019_site_brain.sql may not be applied on a given database yet. That is not an error the
 *  user can act on from this page, and it must not render as "your site brain is broken". */
const MISSING_TABLE = "42P01";

const SELECT = "id, version, profile, sources, built_from, created_by, created_at, active";

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const [{ data: active, error: activeError }, { data: history, error: historyError }, { count: pagesCrawled }] = await Promise.all([
    supabase.from("site_profiles").select(SELECT).eq("tenant_id", tenantId).eq("active", true).maybeSingle(),
    supabase
      .from("site_profiles")
      .select("id, version, created_by, created_at, active, built_from")
      .eq("tenant_id", tenantId)
      .order("version", { ascending: false })
      .limit(25),
    // Distinguishes "the crawl never ran" from "the crawl ran and the analyst is still
    // thinking" — two very different sentences to show someone staring at an empty page.
    supabase.from("site_pages").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);

  const error = activeError ?? historyError;
  if (error && (error as any).code !== MISSING_TABLE) {
    console.error("[site-brain] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const schemaReady = !(error as any)?.code || (error as any).code !== MISSING_TABLE;

  return NextResponse.json({
    ok: true,
    schemaReady,
    pagesCrawled: pagesCrawled ?? 0,
    profile: active ? normalizeProfile(active.profile) : null,
    version: active ? Number(active.version) || 1 : null,
    builtAt: active?.created_at ?? null,
    builtBy: active?.created_by ?? null,
    builtFrom: active?.built_from ?? {},
    history: (history ?? []).map((r: any) => ({
      id: String(r.id),
      version: Number(r.version) || 0,
      created_at: String(r.created_at ?? ""),
      created_by: String(r.created_by ?? ""),
      active: !!r.active,
      pages: Number(r.built_from?.pages) || null,
    })),
  });
}

type PatchBody = {
  /** Single-field form: { field, value }. */
  field?: string;
  value?: unknown;
  /** Multi-field form: { edits: { what_they_do: "…", offerings: [...] } } — one new version
   *  for the whole set, which is what onboarding's "haan sahi hai" needs. */
  edits?: Record<string, unknown>;
  /** Optimistic concurrency: the version the browser was looking at. */
  baseVersion?: number;
};

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? null;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const raw: Record<string, unknown> =
    body?.edits && typeof body.edits === "object" && !Array.isArray(body.edits)
      ? body.edits
      : typeof body?.field === "string"
        ? { [body.field]: body.value }
        : {};

  const names = Object.keys(raw);
  if (!names.length) {
    return NextResponse.json({ ok: false, error: "Nothing to change — send { field, value } or { edits }." }, { status: 400 });
  }

  // A field that does not exist is a 400 that NAMES it. Silently ignoring an unknown key is
  // how a typo in a client turns into "I edited it and nothing happened", forever.
  const unknown = names.filter((n) => !isProfileField(n));
  if (unknown.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `No such field: ${unknown.map((u) => `"${u}"`).join(", ")}. Known fields: ${PROFILE_FIELDS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const edits: Partial<Record<ProfileField, unknown>> = {};
  for (const name of names as ProfileField[]) {
    const coerced = coerceField(name, raw[name]);
    if (!coerced.ok) return NextResponse.json({ ok: false, error: coerced.error }, { status: 400 });
    edits[name] = coerced.value;
  }

  // ── read the live version ────────────────────────────────────────────────────────────────
  const { data: active, error: readError } = await supabase
    .from("site_profiles")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();

  if (readError && (readError as any).code === MISSING_TABLE) {
    return NextResponse.json({ ok: false, error: "The Site Brain table isn't set up on this database yet." }, { status: 503 });
  }
  if (readError) {
    console.error("[site-brain] read-before-write failed:", readError.message);
    return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
  }

  const currentVersion = active ? Number(active.version) || 1 : 0;
  if (typeof body.baseVersion === "number" && body.baseVersion !== currentVersion) {
    // Somebody (an analyst run, another tab) wrote a version since this screen loaded. Refusing
    // is the only honest answer: applying the edit would silently discard whatever that version
    // said about the other eleven fields.
    return NextResponse.json(
      {
        ok: false,
        conflict: true,
        currentVersion,
        error: `This page is showing v${body.baseVersion}, but the live profile is now v${currentVersion}. Reload to see what changed, then edit again.`,
      },
      { status: 409 }
    );
  }

  const base: SiteProfile = active ? normalizeProfile(active.profile) : emptyProfile();

  // An edit that changes nothing does not deserve a version row — confirming "haan sahi hai"
  // without touching anything must not freeze the field against future analyst runs either.
  const changed = (Object.keys(edits) as ProfileField[]).filter(
    (f) => JSON.stringify((base as any)[f] ?? null) !== JSON.stringify(edits[f] ?? null)
  );
  if (!changed.length) {
    return NextResponse.json({ ok: true, unchanged: true, version: currentVersion || null, profile: base });
  }

  const next: SiteProfile = { ...base };
  const sources = { ...(base.sources ?? {}) };
  const confidence = { ...(base.confidence ?? {}) };

  for (const field of changed) {
    (next as any)[field] = edits[field];
    // "user" is the source siteProfile.ts documents for a hand-typed value. It is deliberately
    // NOT a URL: this page never fabricates a source link, and a value you typed has no page
    // behind it to link to.
    sources[field] = ["user"];
    confidence[field] = "high";
  }

  next.sources = sources;
  next.confidence = confidence;
  // The exact shape analyst.ts expects: a flat array of field-name strings on the profile
  // object itself. It reads `previous?.profile.user_edited ?? []`, then for each name does
  // `profile[field] = previous.profile[field]` — so a name in here means "never rewrite this".
  next.user_edited = Array.from(new Set([...(base.user_edited ?? []), ...changed])).filter(isProfileField);

  try {
    const saved = await writeVersion(supabase, tenantId, next, {
      builtFrom: {
        ...((active?.built_from as Record<string, unknown>) ?? {}),
        edited_from_version: currentVersion || null,
        user_edited_fields: changed,
        edited_at: new Date().toISOString(),
      },
      createdBy: userId ? `user:${userId}` : "user",
    });
    return NextResponse.json({ ok: true, version: saved.version, fields: changed, profile: saved.profile, builtAt: saved.created_at });
  } catch (e: any) {
    console.error("[site-brain] save failed:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message ?? "Could not save your change." }, { status: 500 });
  }
}

/** A straight port of agent-server/src/lib/siteProfile.ts `saveProfile`, kept step for step so
 *  a profile written from this screen is indistinguishable from one written by the analyst.
 *
 *  Order, and why it is this order:
 *    1. insert the new row with active=false — if this fails the tenant still has its old
 *       brain, which is the safe direction to fail in;
 *    2. clear `active` on every other row for the tenant;
 *    3. set `active` on the new row.
 *
 *  Between 2 and 3 the tenant briefly has no active profile; a reader gets null and falls back,
 *  which is survivable. The reverse order is not: `site_profiles_one_active` (the partial
 *  unique index in migration 019) would reject step 3 outright and we would have written a
 *  version nobody can ever see.
 *
 *  Concurrency: the version number is read and then inserted, so an analyst run finishing at
 *  the same moment can take the number first. That collision surfaces as unique-violation
 *  23505 on (tenant_id, version) — the index doing its job — and the answer is to retry with
 *  the next number, three times, rather than invent a scheme that pretends it cannot happen.
 */
async function writeVersion(
  supabase: any,
  tenantId: string,
  profile: SiteProfile,
  { builtFrom, createdBy }: { builtFrom: Record<string, unknown>; createdBy: string }
) {
  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: latest, error: readError } = await supabase
      .from("site_profiles")
      .select("version")
      .eq("tenant_id", tenantId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) throw new Error(`site_profiles read failed: ${readError.message}`);

    const version = (Number(latest?.version) || 0) + 1 + attempt;

    const { data: inserted, error: insertError } = await supabase
      .from("site_profiles")
      .insert({
        tenant_id: tenantId,
        version,
        profile,
        // Mirrored out of the document so SQL can answer "where did this claim come from"
        // without unpacking the whole profile. Same data, indexed access.
        sources: profile.sources ?? {},
        built_from: builtFrom,
        created_by: createdBy,
        active: false,
      })
      .select(SELECT)
      .single();

    if (insertError) {
      lastError = insertError.message;
      if ((insertError as any).code === "23505") continue; // somebody took this version number
      throw new Error(`site_profiles insert failed: ${insertError.message}`);
    }

    const { error: clearError } = await supabase
      .from("site_profiles")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (clearError) throw new Error(`site_profiles deactivate failed: ${clearError.message}`);

    const { error: activateError } = await supabase.from("site_profiles").update({ active: true }).eq("id", inserted.id);
    if (activateError) throw new Error(`site_profiles activate failed: ${activateError.message}`);

    return {
      id: String(inserted.id),
      version: Number(inserted.version),
      profile: normalizeProfile(inserted.profile),
      created_at: String(inserted.created_at ?? new Date().toISOString()),
    };
  }

  throw new Error(`site_profiles insert failed after 3 version attempts: ${lastError}`);
}
