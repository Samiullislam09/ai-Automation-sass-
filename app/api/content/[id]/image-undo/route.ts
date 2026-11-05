import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { removeMediaFile } from "@/lib/media-files";

/** "Undo" for an "Another image" redo. `id` is the image_set; the body names the slot.
 *
 *  A redo keeps the picture it replaced on the card (`previous`) until the owner approves. This
 *  puts that picture back EVERYWHERE the new one went: the review card, the media row, and the
 *  article's own body (and its thumbnail), then deletes the new file. After approval there is
 *  nothing left to undo, and this says so. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const slot = typeof body?.slot === "string" ? body.slot : "";
  if (!slot) return NextResponse.json({ ok: false, error: "Which picture?" }, { status: 400 });

  const { data: set } = await supabase
    .from("content_items")
    .select("id, type, status, meta, parent_article_id:blueprint->>parent_article_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!set || (set as any).type !== "image_set") return NextResponse.json({ ok: false, error: "Image set not found." }, { status: 404 });

  const meta = ((set as any).meta ?? {}) as Record<string, any>;
  const images: any[] = Array.isArray(meta.images) ? meta.images : [];
  const card = images.find((i) => i.slot === slot);
  if (!card?.previous?.url) {
    return NextResponse.json({ ok: false, error: "Nothing to undo: the earlier picture is deleted once you approve." }, { status: 409 });
  }

  const newUrl: string = card.url;
  const old = card.previous as { url: string; alt?: string; provider?: string | null; width?: number | null; height?: number | null };
  const restored = images.map((i) =>
    i.slot === slot
      ? (({ previous, ...rest }: any) => ({ ...rest, url: old.url, alt: old.alt ?? rest.alt, provider: old.provider ?? rest.provider, width: old.width ?? rest.width, height: old.height ?? rest.height }))(i)
      : i,
  );
  const { error: setErr } = await supabase.from("content_items").update({ meta: { ...meta, images: restored } }).eq("id", id);
  if (setErr) return NextResponse.json({ ok: false, error: setErr.message }, { status: 500 });

  const articleId = (set as any).parent_article_id as string | null;
  if (articleId) {
    await supabase.from("media").update({ url: old.url, alt: old.alt ?? card.alt, width: old.width ?? card.width ?? null, height: old.height ?? card.height ?? null }).eq("article_id", articleId).eq("slot", slot);
    const { data: art } = await supabase.from("content_items").select("body, meta").eq("id", articleId).eq("tenant_id", tenantId).maybeSingle();
    if (art) {
      const artMeta = ((art as any).meta ?? {}) as Record<string, any>;
      const nextBody = typeof (art as any).body === "string" ? (art as any).body.split(newUrl).join(old.url) : (art as any).body;
      const nextMeta = artMeta.thumbnailUrl === newUrl ? { ...artMeta, thumbnailUrl: old.url } : artMeta;
      await supabase.from("content_items").update({ body: nextBody, meta: nextMeta }).eq("id", articleId);
    }
  }

  await removeMediaFile(newUrl);
  return NextResponse.json({ ok: true, images: restored });
}
