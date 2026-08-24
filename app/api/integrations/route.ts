import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { encrypt } from "@/lib/crypto";
import { generateWebhookSecret, signPayload } from "@/lib/webhook";

/** Everything the Connect page (/app/connect) talks to.
 *
 *  Until now the only way to attach a publishing destination was the one-shot onboarding
 *  wizard — there was no way to change it, add a second one, or see what was attached.
 *  This is that missing surface, and it writes to the same `integrations` table the
 *  publisher already reads (lib/publish.ts).
 *
 *  SECRETS NEVER COME BACK OUT. GET returns type/status/a non-sensitive label only; the
 *  app password and the webhook signing secret are write-only from the browser's point of
 *  view (the signing secret is shown exactly once, at the moment it's generated, because
 *  the customer has to paste it into their own site).
 */

// Not exported: a route module may only export route handlers and Next's own config keys.
const SOCIAL_TYPES = ["social_x", "social_linkedin", "social_facebook", "social_instagram"] as const;
const ALL_TYPES = ["wordpress", "webhook", ...SOCIAL_TYPES] as const;
type IntegrationType = (typeof ALL_TYPES)[number];

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("integrations")
    .select("id, type, status, encrypted_credentials, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Onboarding used plain inserts, so a tenant can hold more than one row of a type.
  // Newest wins here, exactly like the publisher's `.find()` would land on it.
  const seen = new Set<string>();
  const items = (data ?? [])
    .filter((row) => (seen.has(row.type) ? false : (seen.add(row.type), true)))
    .map((row) => {
      const creds = (row.encrypted_credentials ?? {}) as Record<string, string>;
      return {
        type: row.type,
        status: row.status,
        updatedAt: row.updated_at,
        // A human-readable pointer at WHAT is connected — never the credential itself.
        label: creds.siteUrl ?? creds.url ?? creds.relayUrl ?? null,
        username: creds.username ?? null,
      };
    });

  return NextResponse.json({ ok: true, items });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type = String(body?.type ?? "") as IntegrationType;
  if (!ALL_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: `Unknown integration type: ${type}` }, { status: 400 });
  }

  // Every branch below verifies the connection first and returns early if it fails, so a
  // row only ever reaches the table as "connected" — the publisher trusts that word.
  const status = "connected";
  let credentials: Record<string, unknown>;
  let revealSecret: string | null = null;

  if (type === "wordpress") {
    const siteUrl = normalizeUrl(body?.siteUrl);
    const username = String(body?.username ?? "").trim();
    const appPassword = String(body?.appPassword ?? "");
    if (!siteUrl || !username || !appPassword) {
      return NextResponse.json({ ok: false, error: "Site URL, username aur application password — teeno chahiye." }, { status: 400 });
    }

    // Verify BEFORE saving. A row saved as `connected` is a promise the publisher relies on.
    const auth = Buffer.from(`${username}:${appPassword}`).toString("base64");
    try {
      const res = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: `Basic ${auth}` },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          error: res.status === 401
            ? "WordPress ne login reject kiya — application password (spaces ke saath paste karo) aur username dobara check karo."
            : `WordPress ne ${res.status} diya. REST API blocked ho sakti hai (security plugin).`,
        });
      }
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `Site tak pahunch nahi paye: ${e?.message ?? "network error"}` });
    }

    credentials = { siteUrl, username, appPassword: encrypt(appPassword) };
  } else if (type === "webhook") {
    const url = normalizeUrl(body?.url);
    if (!url) return NextResponse.json({ ok: false, error: "Ek valid https:// URL do." }, { status: 400 });

    // Reuse an already-issued secret when the customer is only re-pointing the URL —
    // regenerating it silently would break the signature check on their live site.
    const { data: existing } = await supabase
      .from("integrations")
      .select("encrypted_credentials")
      .eq("tenant_id", tenantId)
      .eq("type", "webhook")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const keepSecret = body?.rotateSecret !== true && (existing?.encrypted_credentials as any)?.secret;
    const secret = keepSecret ? null : generateWebhookSecret();
    if (secret) revealSecret = secret;

    const ping = await pingEndpoint(url, secret ?? "rotation-not-requested");
    if (!ping.ok) return NextResponse.json({ ok: false, error: ping.error });

    credentials = { url, secret: keepSecret ? keepSecret : encrypt(secret!) };
  } else {
    // Social. There is no OAuth app for X/LinkedIn/Meta yet, so the connection a customer
    // can actually make today is a relay endpoint of their own (Zapier / Make / n8n / their
    // own route). The URL is verified the same way the site webhook is.
    const relayUrl = normalizeUrl(body?.relayUrl);
    if (!relayUrl) return NextResponse.json({ ok: false, error: "Apna Zapier/Make/n8n webhook URL do (https://)." }, { status: 400 });

    const secret = generateWebhookSecret();
    const ping = await pingEndpoint(relayUrl, secret);
    if (!ping.ok) return NextResponse.json({ ok: false, error: ping.error });

    revealSecret = secret;
    credentials = { relayUrl, secret: encrypt(secret), network: type.replace("social_", "") };
  }

  // Replace rather than accumulate — one live row per type per tenant.
  await supabase.from("integrations").delete().eq("tenant_id", tenantId).eq("type", type);
  const { error } = await supabase.from("integrations").insert({
    tenant_id: tenantId,
    type,
    status,
    encrypted_credentials: credentials,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, type, status, secret: revealSecret });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const type = request.nextUrl.searchParams.get("type") ?? "";
  if (!ALL_TYPES.includes(type as IntegrationType)) {
    return NextResponse.json({ ok: false, error: `Unknown integration type: ${type}` }, { status: 400 });
  }

  const { error } = await supabase.from("integrations").delete().eq("tenant_id", tenantId).eq("type", type);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Bare domains are what people actually type. Every consumer downstream requires a scheme. */
function normalizeUrl(raw: unknown): string | null {
  const v = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    new URL(withScheme);
    return withScheme;
  } catch {
    return null;
  }
}

async function pingEndpoint(url: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  const payload = JSON.stringify({ type: "ping", sentAt: new Date().toISOString() });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MrLxwa-Signature": signPayload(secret, payload) },
      body: payload,
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, error: `Endpoint ne ${res.status} diya — 2xx expected hai.` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Endpoint tak pahunch nahi paye (${e?.message ?? "network error"}). Public URL hona chahiye — localhost nahi chalega.` };
  }
}
