import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { encrypt } from "@/lib/crypto";
import { generateWebhookSecret } from "@/lib/webhook";
import { normalizeSiteUrl } from "@/lib/crawl";

/** Build Guide Step 4 — persists the onboarding wizard to Supabase:
 *  tenant profile (niche/tone/ICP) always, WordPress integration if provided. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { websiteUrl, niche, toneProfile, icpProfile, wordpress, webhook } = await request.json();

  // Users type domains without a protocol ("wca-global.com") — found live, that bare form got
  // saved as-is and every downstream reader requires ^https?:// before fetching, so the crawl
  // silently did nothing. Normalised once here so every reader can trust the stored value.
  //
  // And it is VALIDATED, not just prefixed. The wizard's own "Skip — describe instead" link
  // used to hand this route the literal string "(no website yet)"; prefixing turned that into
  // "https://(no website yet)", which is what later took the crawler down with "Invalid URL".
  // No website is a legitimate answer — it is stored as null. A typo is not, and is refused.
  const rawUrl = typeof websiteUrl === "string" ? websiteUrl.trim() : "";
  const normalizedUrl = rawUrl ? normalizeSiteUrl(rawUrl) : null;
  if (rawUrl && !normalizedUrl) {
    return NextResponse.json(
      { ok: false, error: `"${rawUrl}" isn't a website address. Give something like https://yourbusiness.com, or skip this step.` },
      { status: 400 }
    );
  }

  // Read what's on file BEFORE this write. If /api/onboarding/site (step 0) already saved this
  // exact address, it already enqueued this same crawl — up to 300 live page fetches, up to 300
  // paid NVIDIA embedding calls, and a full Mr. Analyst run that chains off it automatically
  // (agent-server/src/agents/crawler.ts). This route used to fire the identical job again below,
  // unconditionally, which meant every signup with a website paid for all three things twice.
  // The trigger below is step 0's fallback for when it never reached the server at all (offline,
  // a bad gateway — see that route's own comment), not a second, unconditional run.
  const { data: before } = await supabase.from("tenants").select("website_url").eq("id", tenantId).maybeSingle();
  const crawlAlreadyStarted = !!normalizedUrl && before?.website_url === normalizedUrl;

  const { error: tenantErr } = await supabase
    .from("tenants")
    .update({
      website_url: normalizedUrl,
      niche: niche ?? null,
      tone_profile: toneProfile ?? {},
      icp_profile: icpProfile ?? {},
      onboarded: true, // DB is the source of truth now — not just local browser state
    })
    .eq("id", tenantId);

  if (tenantErr) {
    return NextResponse.json({ ok: false, error: tenantErr.message }, { status: 500 });
  }

  let wpConnected = false;
  if (wordpress?.siteUrl && wordpress?.username && wordpress?.appPassword) {
    const base = wordpress.siteUrl.trim().replace(/\/+$/, "");
    const auth = Buffer.from(`${wordpress.username}:${wordpress.appPassword}`).toString("base64");
    let verified = false;
    try {
      const res = await fetch(`${base}/wp-json/wp/v2/users/me`, { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
      verified = res.ok;
    } catch {
      verified = false;
    }

    const { error: intErr } = await supabase.from("integrations").insert({
      tenant_id: tenantId,
      type: "wordpress",
      status: verified ? "connected" : "error",
      encrypted_credentials: {
        siteUrl: base,
        username: wordpress.username,
        appPassword: encrypt(wordpress.appPassword),
      },
    });
    if (!intErr) wpConnected = verified;
  }

  // Webhook (Next.js / custom site) — push-delivery, no credentials of theirs stored, only a
  // secret WE generate for them to verify our signature. Body/content itself is never pushed
  // here — only wired at delivery time (Build Guide Step 12 equivalent), and by design that
  // path won't persist the article body for webhook-type tenants once delivery succeeds.
  let webhookSecret: string | null = null;
  if (webhook?.url) {
    webhookSecret = generateWebhookSecret();
    const { error: whErr } = await supabase.from("integrations").insert({
      tenant_id: tenantId,
      type: "webhook",
      status: "connected",
      encrypted_credentials: { url: webhook.url, secret: encrypt(webhookSecret) },
    });
    if (whErr) webhookSecret = null;
  }

  // Only a fallback: fire the full site crawl here if step 0 never managed to (see the
  // comment above `crawlAlreadyStarted`). A website that was already saved for this tenant
  // already has its crawl running or done — nothing to start twice.
  const agentServerUrl = process.env.AGENT_SERVER_URL;
  if (!normalizedUrl) {
    // Nothing to crawl — "no website yet" is a real, final answer, not a reason to enqueue a
    // job the crawler would just reject for lack of an address.
  } else if (crawlAlreadyStarted) {
    console.log("[onboarding/complete] skipping crawl — step 0 already started it for this address");
  } else if (agentServerUrl) {
    fetch(`${agentServerUrl}/jobs/crawler`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    }).catch((e) => console.error("[onboarding/complete] failed to enqueue full crawl:", e.message));
  } else {
    console.error("[onboarding/complete] AGENT_SERVER_URL not set — skipping full site crawl");
  }

  return NextResponse.json({ ok: true, tenantId, wpConnected, webhookSecret });
}
