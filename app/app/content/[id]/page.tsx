import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { renderMarkdown } from "@/lib/md";
import ArticleReview from "@/components/ArticleReview";

/** The article reviewer, read on the SERVER.
 *
 *  This page spent days rendering a black rectangle: no markup, no console error, no error
 *  boundary hit, not even the loading fallback. Every theory about why — the params prop,
 *  marked's broken browser field, a suspended segment — was a guess, and each fix was a guess
 *  that didn't land.
 *
 *  So the guessing stops here. The article is fetched and rendered into the HTML by the
 *  server, before any JavaScript runs. If this page responds at all, the article is in the
 *  response. The client half (components/ArticleReview.tsx) still does the editing, but it can
 *  no longer be the difference between seeing your draft and seeing nothing — and the
 *  <noscript> fallback below means even a client bundle that never loads still shows you the
 *  thing you came to read.
 */
export const dynamic = "force-dynamic";

const EDITABLE = ["draft", "awaiting_approval", "failed", "rejected"];

export default async function Page({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);

  const { data: item, error } = tenantId
    ? await supabase
        .from("content_items")
        .select("id, type, status, title, body, meta, created_at")
        .eq("id", params.id)
        .eq("tenant_id", tenantId)
        .maybeSingle()
    : { data: null, error: null as any };

  // Every failure says which one it is, on the server, in the HTML. "Nothing here" was the
  // one outcome this page must never produce again.
  if (!tenantId || error || !item) {
    return (
      <div style={{ maxWidth: 620 }}>
        <Link href="/app/approvals" style={{ display: "inline-block", padding: "6px 0", fontSize: 12, color: "var(--ac)", fontWeight: 600 }}>← Approvals</Link>
        <div className="card" style={{ marginTop: 8, borderColor: "var(--red)" }}>
          <b style={{ fontSize: 13.5 }}>Couldn&apos;t open this article</b>
          <p className="sm brk" style={{ color: "var(--red)", margin: "6px 0 0" }}>
            {!tenantId
              ? "No workspace found for your account."
              : error
                ? error.message
                : "There is no article with that id in your workspace."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ArticleReview item={item as any} editable={EDITABLE.includes(item.status)} id={params.id} />

      {/* Server-rendered, and shown only if the client bundle never runs. The reading view is
          static text — there is no good reason for it to depend on JavaScript at all. */}
      <noscript>
        <article className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.body ?? "") }} />
      </noscript>
    </>
  );
}
