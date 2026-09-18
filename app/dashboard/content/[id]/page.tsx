import Link from "next/link";
import type { Metadata } from "next";
import ArticleApprovalSection from "@/components/dashboard/ArticleApprovalSection";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

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

export const metadata: Metadata = { title: "Review — MrLxwa" };

export default async function DashboardContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);

  const { data: item, error } = tenantId
    ? await supabase
        .from("content_items")
        .select("id, type, status, title, body, meta, primary_keyword, slug, created_at, updated_at")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle()
    : { data: null, error: null as any };

  const { data: tenant } = tenantId
    ? await supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle()
    : { data: null };

  /* Images and the Web Story are NOT in the article row — that is why this page showed neither
     until 2026-09-18. Mr. Image files every picture in `media`, keyed by (article, slot), and
     Mr. Story files the story as its own separately-reviewable `web_story` content_item tied
     back here through blueprint->>parent_article_id (migration 023). Both are read here, on
     the server, with the user's own client — RLS (is_tenant_member) already scopes them. */
  const { data: media } = tenantId
    ? await supabase
        .from("media")
        .select("slot, url, alt, anchor, width, height, provider")
        .eq("article_id", id)
        .order("slot")
    : { data: null };

  const { data: story } = tenantId
    ? await supabase
        .from("content_items")
        .select("id, status, title, meta")
        .eq("tenant_id", tenantId)
        .eq("type", "web_story")
        .eq("blueprint->>parent_article_id", id)
        .maybeSingle()
    : { data: null };

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
    />
  );
}
