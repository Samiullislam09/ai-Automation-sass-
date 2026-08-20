import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { encrypt } from "@/lib/crypto";
import { generateWebhookSecret } from "@/lib/webhook";

/** Build Guide Step 4 — persists the onboarding wizard to Supabase:
 *  tenant profile (niche/tone/ICP) always, WordPress integration if provided. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { websiteUrl, niche, toneProfile, icpProfile, wordpress, webhook } = await request.json();

  const { error: tenantErr } = await supabase
    .from("tenants")
    .update({
      website_url: websiteUrl ?? null,
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

  // Kick off the FULL site crawl as a background job (agent-server, Railway) — not
  // awaited, this request shouldn't wait on it. Onboarding's own /api/onboarding/crawl
  // already did a quick ~15-page sample synchronously for immediate niche/topic feedback
  // in the wizard; this follow-up goes deep (up to ~300 pages, no request-timeout
  // constraint) so the tenant's real knowledge base — and every agent/chat reply that
  // reads site_pages — reflects the whole site, not a sample.
  const agentServerUrl = process.env.AGENT_SERVER_URL;
  if (agentServerUrl) {
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
