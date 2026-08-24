import type { SupabaseClient } from "@supabase/supabase-js";
import { marked } from "marked";
import { decrypt } from "@/lib/crypto";
import { signPayload } from "@/lib/webhook";

/** Build Guide Step 12 — "Approve & publish" actually publishes, for real, to whichever
 *  integration the tenant connected during onboarding (Step 4). WordPress: REST API post
 *  create. Webhook (Next.js/custom sites): signed POST, delivery is the site's own job to
 *  render/store. No integration connected: explicit error, not a silent no-op. */

// Not a discriminated union on purpose — this repo runs with strict:false, where TS's
// control-flow narrowing on `if (result.ok)` doesn't reliably exclude the other member
// (confirmed: caller-side `result.error` errored even inside an else branch). Both fields
// optional, always present-or-not based on ok, sidesteps needing narrowing at all.
export type PublishResult = { ok: boolean; url?: string; error?: string };

export async function publishContentItem(
  supabase: SupabaseClient,
  tenantId: string,
  item: { id: string; title: string | null; body: string | null; type: string }
): Promise<PublishResult> {
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, type, status, encrypted_credentials")
    .eq("tenant_id", tenantId)
    .eq("status", "connected");

  const wp = integrations?.find((i) => i.type === "wordpress");
  const webhook = integrations?.find((i) => i.type === "webhook");

  if (wp) return publishToWordPress(wp.encrypted_credentials as any, item);
  if (webhook) return deliverWebhook(webhook.encrypted_credentials as any, item);
  return { ok: false, error: "No connected publishing destination (WordPress or webhook) — add one in Connect (/app/connect) first." };
}

async function publishToWordPress(
  creds: { siteUrl: string; username: string; appPassword: string },
  item: { title: string | null; body: string | null }
): Promise<PublishResult> {
  try {
    const auth = Buffer.from(`${creds.username}:${decrypt(creds.appPassword)}`).toString("base64");
    const html = await marked.parse(item.body ?? "");
    const res = await fetch(`${creds.siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ title: item.title ?? "Untitled", content: html, status: "publish" }),
    });
    if (!res.ok) return { ok: false, error: `WordPress publish failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}` };
    const data = await res.json();
    return { ok: true, url: data?.link };
  } catch (e: any) {
    return { ok: false, error: `WordPress publish error: ${e.message}` };
  }
}

async function deliverWebhook(
  creds: { url: string; secret: string },
  item: { id: string; title: string | null; body: string | null; type: string }
): Promise<PublishResult> {
  try {
    const secret = decrypt(creds.secret);
    const payload = JSON.stringify({ id: item.id, type: item.type, title: item.title, body: item.body });
    const res = await fetch(creds.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MrLxwa-Signature": signPayload(secret, payload) },
      body: payload,
    });
    if (!res.ok) return { ok: false, error: `Webhook delivery failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Webhook delivery error: ${e.message}` };
  }
}
