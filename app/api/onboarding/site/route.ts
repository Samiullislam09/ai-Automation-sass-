import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { normalizeSiteUrl } from "@/lib/crawl";
import { enqueueAgentJob } from "@/lib/agent-jobs";

/** The first thing onboarding does with a website address: save it and start reading (§25.7).
 *
 *  The plan's onboarding is "Site URL → crawl start (background) → 'we read your site, here is
 *  what we understood' → goals". None of that works if the crawl only begins at the END of the
 *  wizard, which is where it used to begin — by then there is nothing to confirm, and the user
 *  is shown a spinner or, worse, our guesses. Starting here buys the crawler and Mr. Analyst
 *  the two or three minutes the rest of the wizard takes.
 *
 *  Two deliberate choices:
 *
 *   · The address is normalised and REJECTED if it isn't usable, right here, while the user is
 *     still looking at the field they typed it into. The alternative is what this codebase has
 *     already lived through once: a bad value saved, then a bare "Invalid URL" thrown from deep
 *     inside the crawler minutes later, naming nothing.
 *   · A crawl that cannot be started is not an error the user sees. `/api/onboarding/complete`
 *     saves the address again at the end and the old end-of-wizard crawl still runs, so the
 *     worst case is the confirm screen saying "still reading" and being skipped. Nobody is
 *     blocked from signing up because a queue is down.
 */

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const site = normalizeSiteUrl(typeof body?.websiteUrl === "string" ? body.websiteUrl : "");
  if (!site) return NextResponse.json({ ok: false, error: "That doesn't look like a website address." }, { status: 400 });

  const { error } = await supabase.from("tenants").update({ website_url: site }).eq("id", tenantId);
  if (error) {
    console.error("[onboarding/site] could not save the address:", error.message);
    return NextResponse.json({ ok: false, error: "Couldn't save your website address." }, { status: 500 });
  }

  // Fire and forget by design — see the block comment. The crawler enqueues Mr. Analyst itself
  // when it finishes, so this one job is the whole "read the site and understand it" chain.
  const started = await enqueueAgentJob("crawler", tenantId, { taskLabel: "Reading your site" });

  return NextResponse.json({ ok: true, websiteUrl: site, crawlStarted: started.ok });
}
