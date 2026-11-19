import Link from "next/link";
import type { Metadata } from "next";
import ArticleApprovalSection from "@/components/dashboard/ArticleApprovalSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { nearestCategory, neighboursOf } from "@/lib/article-category";

/** /dashboard/content/[id] — the article reviewer. Same real logic as always: read on the
 *  server, save/approve/reject/revise via the same /api/content/[id]/** routes.
 *
 *  NO DASHBOARD SHELL (owner, 2026-09-18: "left sidebar ko remove kardo taki jayda space
 *  mile"). This page used to be wrapped in <MrLxwaDashboard> to match a 2026-09-04 mockup;
 *  it now renders on its own so the article gets the full viewport and reads like the real
 *  published web page — a white sheet on a light canvas, not a dark app screen. The section
 *  mounts the theme (<LxGlobalStyle/>) itself again, as it did before that wrapper existed.
 *
 *  Every field the rail shows is real or explicitly says it isn't measured — see that
 *  component's own header comment for the full accounting (owner confirmed 2026-08-29: skip
 *  the hero photo entirely rather than fake one, since Mr. Image doesn't exist yet). */
export const dynamic = "force-dynamic";

const EDITABLE = ["draft", "awaiting_approval", "failed", "rejected"];

export const metadata: Metadata = { title: "Review — MenCra" };

export default async function DashboardContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);

  /* The four reads do not depend on each other, so they go out together: one round trip instead
     of four in a row (that chain was most of the wait when an article opened).

     Images and the Web Story are NOT in the article row. Mr. Image files every picture in
     `media`, keyed by (article, slot), and Mr. Story files the story as its own
     separately-reviewable `web_story` content_item tied back here through
     blueprint->>parent_article_id (migration 023). All are read here, on the server, with the
     user's own client; RLS (is_tenant_member) already scopes them. */
  const [itemRes, tenantRes, mediaRes, storyRes, idsRes, profileRes] = tenantId
    ? await Promise.all([
        supabase
          .from("content_items")
          .select("id, type, status, title, body, meta, primary_keyword, slug, created_at, updated_at")
          .eq("id", id)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle(),
        supabase.from("media").select("slot, url, alt, anchor, width, height, provider").eq("article_id", id).order("slot"),
        supabase
          .from("content_items")
          .select("id, status, title, meta")
          .eq("tenant_id", tenantId)
          .eq("type", "web_story")
          .eq("blueprint->>parent_article_id", id)
          .maybeSingle(),
        // The ids of the content list in the order the Content page shows it (newest first): the previous / next arrows. Ids only. The browser used to download the whole list for this.
        supabase.from("content_items").select("id").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        // The topic clusters of the active Site Brain profile: the category name. The browser used to download the whole profile for this.
        supabase.from("site_profiles").select("clusters:profile->topic_clusters").eq("tenant_id", tenantId).eq("active", true).maybeSingle(),
      ])
    : [null, null, null, null, null, null];
  const item = itemRes?.data ?? null;
  const error = itemRes?.error ?? null;
  const tenant = tenantRes?.data ?? null;
  const media = mediaRes?.data ?? null;
  const story = storyRes?.data ?? null;
  // Both are optional extras. A failed read leaves them undefined, and the component then asks for them itself, exactly as before.
  const neighbors = idsRes && !idsRes.error && idsRes.data ? neighboursOf(idsRes.data.map((r: any) => String(r.id)), id) : undefined;
  const category = profileRes && !profileRes.error
    ? nearestCategory(
        (item as any)?.primary_keyword ?? null,
        (Array.isArray((profileRes.data as any)?.clusters) ? (profileRes.data as any).clusters : []).map((c: any) => ({ name: String(c?.name ?? ""), page_urls: Array.isArray(c?.page_urls) ? c.page_urls.slice(0, 8) : [] })),
      )
    : undefined;

  if (!tenantId || error || !item) {
    return (
      <div style={{ minHeight: "100vh", background: "#f2f4f7", padding: 32 }}>
        <div style={{ maxWidth: 560, padding: 24, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <Link href="/dashboard/content" style={{ color: "#4f46e5", fontWeight: 600, fontSize: 12.5 }}>
            ← Back to Content
          </Link>
          <b style={{ display: "block", marginTop: 12, fontSize: 14, color: "#111827" }}>Couldn&apos;t open this article</b>
          <p style={{ marginTop: 6, fontSize: 12.5, color: "#6b7280" }}>
            {!tenantId ? "No workspace found for your account." : error ? error.message : "There is no article with that id in your workspace."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ArticleApprovalSection
      item={item as any}
      editable={EDITABLE.includes(item.status)}
      id={id}
      siteName={tenant?.name ?? null}
      siteUrl={tenant?.website_url ?? null}
      media={(media ?? []) as any}
      story={(story ?? null) as any}
      neighbors={neighbors}
      category={category}
    />
  );
}
