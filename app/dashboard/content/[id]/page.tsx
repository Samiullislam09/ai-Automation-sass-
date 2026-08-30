import Link from "next/link";
import type { Metadata } from "next";
import ArticleApprovalSection from "@/components/dashboard/ArticleApprovalSection";
import { LxGlobalStyle } from "@/components/lx-theme";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** /dashboard/content/[id] — the "Article Approval" reviewer, pixel-matched to the reference
 *  mockup (Downloads/artical read for approved page.png, 2026-08-29) and rebuilt on the new Lx
 *  theme. Same real logic as the old /app/content/[id] (components/ArticleReview.tsx): read on
 *  the server, save/approve/reject/revise via the same /api/content/[id]/** routes — only the
 *  UI and the client component (components/dashboard/ArticleApprovalSection.tsx) are new.
 *
 *  FULL-SCREEN — NOT wrapped in <MrLxwaDashboard> (no sidebar shell). The owner asked for this
 *  to open as its own dedicated page (2026-08-29), not competing with the dashboard's left nav
 *  for width — see ArticleApprovalSection's own header comment for the theme-CSS story
 *  (components/lx-theme.tsx, shared with the dashboard shell rather than duplicated).
 *
 *  Every field the sidebar shows is real or explicitly says it isn't measured — see that
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

  if (!tenantId || error || !item) {
    return (
      <div className="lx-root min-h-screen p-6">
        <LxGlobalStyle />
        <div className="lx-card p-6" style={{ maxWidth: 560 }}>
          <Link href="/dashboard/content" className="lx-11" style={{ color: "var(--lx-cyan)", fontWeight: 600 }}>
            ← Back to Content
          </Link>
          <b className="mt-3 block text-sm">Couldn&apos;t open this article</b>
          <p className="lx-11 lx-mut mt-1.5">
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
    />
  );
}
