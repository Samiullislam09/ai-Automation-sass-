import type { Job } from "pg-boss";
import { Agent, type AgentJobData } from "./base.js";
import { discoverUrls, extractPage } from "../lib/crawl.js";
import { embed } from "../lib/embeddings.js";
import { completeJson } from "../lib/llm.js";
import { supabase } from "../supabase.js";

// A real small-business site rarely has more than a few hundred pages — this is a safety
// ceiling, not a target. Runs as a background job specifically so it CAN go this deep:
// the main app's synchronous onboarding crawl (/api/onboarding/crawl) stays capped at ~15
// pages so onboarding itself doesn't time out on Vercel's serverless request limit.
const PAGE_LIMIT = Number(process.env.CRAWL_PAGE_LIMIT) || 300;

/** Full-site crawl agent — the deep follow-up to onboarding's quick 15-page sample.
 *  Triggered after onboarding completes (see app/api/onboarding/complete/route.ts) so the
 *  tenant's knowledge base (site_pages) — and every downstream agent/chat reply that reads
 *  it — reflects the WHOLE site, not a sample. Also what a future site chatbot widget
 *  (RAG over site_pages) would read from. */
export class CrawlerAgent extends Agent {
  type = "crawler";
  async run(job: Job<AgentJobData>) {
    const { tenantId } = job.data;

    const { data: tenant } = await supabase.from("tenants").select("website_url, tone_profile").eq("id", tenantId).single();
    // Defensive: the main app normalizes this at save time now (bug found live — a bare
    // domain like "wca-global.com" with no protocol got saved as-is and silently failed
    // this exact check, every time), but older rows may still lack the protocol.
    const raw = tenant?.website_url?.trim();
    const site = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
    if (!site) return { pagesCrawled: 0, reason: "no valid website_url on file" };

    const urls = await discoverUrls(site, PAGE_LIMIT);
    let pagesCrawled = 0;
    let unreadable = 0;
    const titles: string[] = [];
    // A page that couldn't be embedded or stored used to vanish into a console line, so a
    // crawl could quietly leave holes in the knowledge base and still report success.
    const failures: { url: string; error: string }[] = [];

    for (const url of urls) {
      const page = await extractPage(url);
      if (!page) { unreadable++; continue; }
      try {
        const vector = await embed(`${page.title}\n\n${page.text}`);
        const { error } = await supabase
          .from("site_pages")
          .upsert(
            { tenant_id: tenantId, url, title: page.title, content_text: page.text, embedding: vector },
            { onConflict: "tenant_id,url" }
          );
        if (error) throw new Error(error.message);
        pagesCrawled++;
        titles.push(page.title);
      } catch (e: any) {
        console.error("[crawler] embed/store failed for", url, e.message);
        if (failures.length < 20) failures.push({ url, error: String(e?.message ?? e).slice(0, 200) });
      }
    }

    if (!pagesCrawled) {
      return {
        pagesCrawled: 0,
        urlsFound: urls.length,
        reason: failures.length
          ? `Found ${urls.length} page(s) but could not index any. First error: ${failures[0].error}`
          : `Found ${urls.length} page(s) but none could be read.`,
        failures,
      };
    }

    // Re-summarize niche/topics from the FULL set of titles now on file, not just this
    // run's — a fuller picture than onboarding's quick pass could ever have had.
    try {
      const { data: allPages } = await supabase.from("site_pages").select("title").eq("tenant_id", tenantId).limit(200);
      const digest = (allPages ?? []).map((p) => `- ${p.title}`).join("\n");
      const result = await completeJson<{ niche: string; topics: string[] }>(
        `Here are page titles from a business website:\n${digest}\n\n` +
        `Reply with ONLY JSON, no markdown fences: {"niche": "one sentence describing what this business does and who it's for", "topics": ["6-10 short content topics this business could publish articles about"]}`
      );
      await supabase
        .from("tenants")
        .update({ niche: result.niche, tone_profile: { ...(tenant?.tone_profile as any ?? {}), topics: result.topics ?? [] } })
        .eq("id", tenantId);
    } catch (e: any) {
      console.error("[crawler] niche re-summary failed:", e.message);
    }

    return {
      pagesCrawled,
      urlsFound: urls.length,
      skipped: failures.length + unreadable,
      // Named, not just counted: "40 skipped" tells you nothing about whether it matters.
      failures,
    };
  }
}
