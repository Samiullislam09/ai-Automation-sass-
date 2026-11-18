/** lib/data-sources.ts — which measurements this product can actually see for a customer, as DATA the model reads through a tool.
 *
 *  This replaces lib/chat-no-data.ts. That file refused metric questions BEFORE the model, in code, using keyword lists ("kitne log", "traffic",
 *  "followers"…): safe, but English and Hinglish only, and it misfired — "is mein se WhatsApp par kitne log hain" was answered with "connect Google
 *  Analytics" (client chat, 2026-11-18). The safety it gave is now carried by a tool: asked for any number about traffic, rankings, followers or
 *  revenue, the model calls `lookup_data_sources`, which says which of those exist for THIS customer and which never will. The model keeps the
 *  language (any), and the one thing it cannot do is claim a number the tool did not return — the tool-result block says so on every call.
 *
 *  What exists, verified against the database when the old file was written: GA4 and Search Console flow into site_insights once Google is
 *  connected AND a property is chosen AND rows synced. Social follower / engagement / reach: nothing — no table, no API client (Miss Social only
 *  drafts text). Revenue / conversions: nothing, and not planned. */
import type { SupabaseClient } from "@supabase/supabase-js";

export type DataSources = {
  /** Google Analytics: connected, a property chosen, AND rows actually synced. */
  ga4: boolean;
  /** Search Console: the same three conditions. */
  gsc: boolean;
  /** Connected social integrations. Even when non-empty this yields no metrics today, so it only makes the answer accurate. */
  social: string[];
};

/** Which measurement sources are live for this tenant. Never throws: a failed read is "nothing connected", the honest direction. */
export async function loadDataSources(supabase: SupabaseClient, tenantId: string | null): Promise<DataSources> {
  const none: DataSources = { ga4: false, gsc: false, social: [] };
  if (!tenantId) return none;
  try {
    const [{ data: rows }, { data: insightSources }] = await Promise.all([
      supabase.from("integrations").select("type, encrypted_credentials").eq("tenant_id", tenantId).eq("status", "connected"),
      supabase.from("site_insights").select("source").eq("tenant_id", tenantId).limit(500),
    ]);
    const google = (rows ?? []).find((r: any) => r.type === "google")?.encrypted_credentials as { ga4PropertyId?: string | null; gscSiteUrl?: string | null } | undefined;
    const synced = (insightSources ?? []).map((r: any) => String(r.source));
    return {
      ga4: !!google?.ga4PropertyId && synced.some((s) => /ga4|analytics/i.test(s)),
      gsc: !!google?.gscSiteUrl && synced.some((s) => /gsc|search|query|page/i.test(s)),
      social: (rows ?? []).map((r: any) => String(r.type)).filter((t: string) => t.startsWith("social_")),
    };
  } catch (e: any) {
    console.error("[data-sources] could not read which sources are connected:", e?.message);
    return none;
  }
}

/** What the model is handed: every kind of number a customer might ask for, and whether we can produce it. */
export function shapeDataSources(s: DataSources) {
  const connectGoogle = "They can connect it on the Connect page (Google: Analytics and Search Console).";
  return {
    website_visitors_traffic_sessions: s.ga4
      ? { available: true, how: "Use the analytics lookup for the real figures." }
      : { available: false, reason: `Google Analytics is not connected (or has not synced yet), so visitor and traffic numbers cannot be seen. ${connectGoogle}` },
    search_clicks_impressions_rankings: s.gsc
      ? { available: true, how: "Use the analytics lookup for the real figures." }
      : { available: false, reason: `Search Console is not connected (or has not synced yet), so clicks, impressions and rankings cannot be seen. ${connectGoogle}` },
    social_followers_likes_engagement_reach: {
      available: false,
      reason: "This product does not read social platforms at all: the social agent only drafts post text. No follower or engagement number is stored anywhere, so none can be given. Do NOT point them to the Connect page for this — it cannot deliver it.",
    },
    revenue_sales_conversions: { available: false, reason: "There is no revenue or conversion tracking in this product, and none is planned yet." },
    lead_and_whatsapp_numbers: { available: true, how: "Those ARE counted: use the lead-stats lookup (how many leads, how many have WhatsApp, replies, calls)." },
    articles_and_schedule: { available: true, how: "Use the content and schedule lookups." },
    connected_social_accounts: s.social,
    rule: "State a figure only if a lookup returned it. If a kind of number is marked unavailable, say so plainly, once, in the customer's language, with the reason — never estimate.",
  };
}
