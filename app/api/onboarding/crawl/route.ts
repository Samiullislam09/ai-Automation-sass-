import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { discoverUrls, extractPage } from "@/lib/crawl";
import { embed } from "@/lib/ai/embeddings";
import { completeJson } from "@/lib/ai/llm";

// Guide says "cap 100 pages" — that's the eventual ceiling once this runs as a background
// agent-server job (Step 6+). Run synchronously inside one request (today's setup), so we
// default much lower to stay well under serverless function time limits. Raise via env once
// crawling moves off the request/response cycle.
const PAGE_LIMIT = Number(process.env.CRAWL_PAGE_LIMIT) || 15;

export async function POST() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: tenant } = await supabase.from("tenants").select("website_url, tone_profile").eq("id", tenantId).single();
  // Defensive: /api/onboarding/complete normalizes this at save time now, but older rows
  // (saved before that fix) may still be a bare domain with no protocol.
  const raw = tenant?.website_url?.trim();
  const site = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
  if (!site) {
    return NextResponse.json({ ok: false, error: "No valid website on file — crawl skipped." });
  }

  const urls = await discoverUrls(site, PAGE_LIMIT);
  const pages: { url: string; title: string }[] = [];

  for (const url of urls) {
    const page = await extractPage(url);
    if (!page) continue;

    try {
      const vector = await embed(`${page.title}\n\n${page.text}`);
      await supabase.from("site_pages").insert({
        tenant_id: tenantId,
        url,
        title: page.title,
        content_text: page.text,
        embedding: vector,
      });
      pages.push({ url, title: page.title });
    } catch (e: any) {
      // one bad page (or a missing/invalid embeddings key) shouldn't kill the whole crawl
      console.error("crawl: embed/store failed for", url, e.message);
    }
  }

  if (!pages.length) {
    return NextResponse.json({ ok: true, pagesCrawled: 0, niche: null, topics: [] });
  }

  let niche: string | null = null;
  let topics: string[] = [];
  try {
    const digest = pages.slice(0, 15).map(p => `- ${p.title}`).join("\n");
    const result = await completeJson<{ niche: string; topics: string[] }>(
      `Here are page titles from a business website:\n${digest}\n\n` +
      `Reply with ONLY JSON, no markdown fences: {"niche": "one sentence describing what this business does and who it's for", "topics": ["5-8 short content topics this business could publish articles about"]}`
    );
    niche = result.niche;
    topics = result.topics ?? [];

    await supabase
      .from("tenants")
      .update({ niche, tone_profile: { ...(tenant?.tone_profile ?? {}), topics } })
      .eq("id", tenantId);
  } catch (e: any) {
    console.error("crawl: niche summary failed", e.message);
  }

  return NextResponse.json({ ok: true, pagesCrawled: pages.length, niche, topics, pages });
}
