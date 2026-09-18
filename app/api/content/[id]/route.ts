import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** One article, for the reviewer at /app/content/[id].
 *
 *  Reading a draft used to mean staring at the raw first paragraph on the Approvals card and
 *  approving on faith. This is the route behind actually reading it — and editing it. */

/** A published row is the copy of what already went to WordPress or the customer's site.
 *  Re-publishing an edit isn't wired, so allowing edits here would leave the two silently
 *  disagreeing — the reviewer shows it read-only instead. */
const EDITABLE = ["draft", "awaiting_approval", "failed", "rejected"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("content_items")
    .select("id, type, status, title, body, blueprint, meta, created_at, updated_at")
    .eq("id", params.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  return NextResponse.json({ ok: true, item: data, editable: EDITABLE.includes(data.status) });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: current, error: readErr } = await supabase
    .from("content_items")
    .select("status, body, meta")
    .eq("id", params.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (!EDITABLE.includes(current.status)) {
    return NextResponse.json({ ok: false, error: `A ${current.status} item can't be edited here.` }, { status: 409 });
  }

  const body = await request.json().catch(() => ({} as any));
  const nextBody = typeof body?.body === "string" ? body.body : null;
  const nextTitle = typeof body?.title === "string" ? body.title.trim() : null;
  // The reviewer can rename the URL before it publishes (owner, 2026-09-18). Whatever the box
  // was typed into, what lands is a real slug — the same shape Mr. Writer's meta step produces.
  const rawSlug = typeof body?.slug === "string" ? body.slug : null;
  const nextSlug = rawSlug === null ? null : slugify(rawSlug);
  if (rawSlug !== null && !nextSlug) {
    return NextResponse.json({ ok: false, error: "That slug has no usable characters in it." }, { status: 400 });
  }
  if (nextBody === null && nextTitle === null && nextSlug === null) {
    return NextResponse.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  }

  // The counts on the Approvals card and in the job receipt are measured, so they have to be
  // re-measured after an edit — otherwise the card keeps quoting the length of a draft that
  // no longer exists.
  const meta = { ...((current.meta as any) ?? {}) };
  if (nextBody !== null) {
    meta.wordCount = countWords(nextBody);
    meta.sections = (nextBody.match(/^##\s+/gm) ?? []).length;
    meta.links = (nextBody.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g) ?? []).length;
    meta.editedByHuman = true;
    meta.editedAt = new Date().toISOString();
  }
  // The slug is stored twice on purpose and the two must never drift: the `slug` COLUMN is
  // what migration 019's unique index and lib/dedupe.ts findExistingBySlug read, `meta.slug`
  // is what Mr. SEO and the reviewer read. Writing one without the other is how a row ends up
  // claiming two different URLs.
  if (nextSlug) meta.slug = nextSlug;

  const { error } = await supabase
    .from("content_items")
    .update({
      ...(nextBody !== null ? { body: nextBody } : {}),
      ...(nextTitle ? { title: nextTitle } : {}),
      ...(nextSlug ? { slug: nextSlug } : {}),
      meta,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("tenant_id", tenantId);

  if (error) {
    // 23505 = the unique slug index. Two articles on one site cannot own the same URL, and
    // saying so beats a raw Postgres constraint name in a toast.
    if ((error as any).code === "23505") {
      return NextResponse.json(
        { ok: false, error: `Another article in this workspace already uses /${nextSlug}.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, meta, slug: nextSlug ?? undefined });
}

function countWords(md: string): number {
  return md.replace(/[#*_`>[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Same shape Mr. Writer's meta step produces (agent-server writerPipeline.ts): lowercase,
 *  hyphen-separated, nothing a URL would have to escape. */
function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
}
