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
// wpPostId is only ever populated for WordPress: it is what unpublishContentItem needs to
// address the SAME post again rather than guessing one from a title or URL. Undefined for a
// webhook destination, which has no "post id" of its own — the customer's endpoint tracks that.
export type PublishResult = { ok: boolean; url?: string; wpPostId?: number; error?: string };

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
  if (webhook) return deliverWebhook(webhook.encrypted_credentials as any, item, "publish");
  return { ok: false, error: "No connected publishing destination (WordPress or webhook) — add one in Connect (/app/connect) first." };
}

/** The other half of publishContentItem: pull something already live back down. Same
 *  destination-lookup, same two integration types — "isko site se hata do" has to reach the
 *  SAME place "isko publish kar do" reached, or the two commands stop being opposites. */
export async function unpublishContentItem(
  supabase: SupabaseClient,
  tenantId: string,
  item: { id: string; title: string | null; type: string; meta: Record<string, unknown> | null }
): Promise<PublishResult> {
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, type, status, encrypted_credentials")
    .eq("tenant_id", tenantId)
    .eq("status", "connected");

  const wp = integrations?.find((i) => i.type === "wordpress");
  const webhook = integrations?.find((i) => i.type === "webhook");

  if (wp) {
    const wpPostId = (item.meta as any)?.wpPostId;
    if (typeof wpPostId !== "number") {
      // Published before this field existed, or published straight to a webhook that has since
      // been swapped for WordPress. Either way there is no post id to act on, and guessing one
      // from a title match against WordPress's list is exactly the kind of "probably right"
      // logic this file exists to refuse — a wrong guess un-publishes a stranger's page.
      return {
        ok: false,
        error:
          "Ye WordPress post ID ke bina publish hua tha (isse pehle ka), isliye chat se seedha hata nahi sakta. " +
          "WordPress me khud jaake is post ko draft/trash karo.",
      };
    }
    return unpublishFromWordPress(wp.encrypted_credentials as any, wpPostId);
  }
  if (webhook) return deliverWebhook(webhook.encrypted_credentials as any, { ...item, body: null }, "unpublish");
  return { ok: false, error: "No connected publishing destination (WordPress or webhook) found — nothing to unpublish from." };
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
    return { ok: true, url: data?.link, wpPostId: typeof data?.id === "number" ? data.id : undefined };
  } catch (e: any) {
    return { ok: false, error: `WordPress publish error: ${e.message}` };
  }
}

/** Sets the post back to draft rather than deleting it — the WordPress-native meaning of "not
 *  published any more" that a re-publish can reverse, matching the product's own reject/approve
 *  vocabulary. Deleting would make "publish it again" impossible to honour later. */
async function unpublishFromWordPress(
  creds: { siteUrl: string; username: string; appPassword: string },
  wpPostId: number
): Promise<PublishResult> {
  try {
    const auth = Buffer.from(`${creds.username}:${decrypt(creds.appPassword)}`).toString("base64");
    const res = await fetch(`${creds.siteUrl}/wp-json/wp/v2/posts/${wpPostId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ status: "draft" }),
    });
    if (!res.ok) return { ok: false, error: `WordPress unpublish failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `WordPress unpublish error: ${e.message}` };
  }
}

async function deliverWebhook(
  creds: { url: string; secret: string },
  item: { id: string; title: string | null; body: string | null; type: string },
  action: "publish" | "unpublish"
): Promise<PublishResult> {
  try {
    const secret = decrypt(creds.secret);
    const payload = JSON.stringify({ id: item.id, type: item.type, title: item.title, body: item.body, action });
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

/** Fetch, publish, and record the outcome — the whole of "Approve & publish" in one call.
 *
 *  Extracted so the chat can do exactly what the Approvals button does. It was inline in
 *  app/api/content/[id]/approve/route.ts, and "publish it from the chat" would otherwise have
 *  meant a second copy of the status transitions. Two copies of a rule about publishing to a
 *  customer's live website is one copy too many: they drift, and the one that drifts is the
 *  one nobody is looking at.
 */
export async function approveAndPublish(
  supabase: SupabaseClient,
  tenantId: string,
  id: string
): Promise<PublishResult & { title?: string | null }> {
  const { data: item, error } = await supabase
    .from("content_items")
    .select("id, tenant_id, type, title, body, status, meta")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !item) return { ok: false, error: "Content item not found." };
  if (item.status === "published") return { ok: false, error: "That one is already live.", title: item.title };
  // 'draft' is not refused here the way the button refuses it: an article the writer finished
  // seconds ago can still be a draft when the customer says "publish it", and telling them to
  // wait for a status they cannot see is not an answer. The quality gate has already run by
  // the time a body exists.
  if (!item.body) return { ok: false, error: "That article has no body yet — it is still being written.", title: item.title };

  const result = await publishContentItem(supabase, tenantId, item);
  const prevMeta = (item.meta as Record<string, unknown>) ?? {};

  if (result.ok) {
    await supabase
      .from("content_items")
      .update({
        status: "published",
        meta: {
          ...prevMeta,
          publishedUrl: result.url ?? null,
          publishedAt: new Date().toISOString(),
          // Needed to unpublish the SAME post later — see unpublishContentItem above.
          wpPostId: result.wpPostId ?? null,
        },
      })
      .eq("id", id);
  } else {
    await supabase
      .from("content_items")
      .update({ status: "failed", meta: { ...prevMeta, publishError: result.error } })
      .eq("id", id);
  }
  return { ...result, title: item.title };
}

/** The other half of approveAndPublish: pull a live article back off the site and record that
 *  it happened. Sets status back to "approved" rather than "draft" — it already passed the
 *  quality gate once and a re-publish should not have to re-earn Approvals from scratch. */
export async function unpublishContent(
  supabase: SupabaseClient,
  tenantId: string,
  id: string
): Promise<PublishResult & { title?: string | null }> {
  const { data: item, error } = await supabase
    .from("content_items")
    .select("id, tenant_id, type, title, status, meta")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !item) return { ok: false, error: "Content item not found." };
  if (item.status !== "published") return { ok: false, error: "That one isn't live.", title: item.title };

  const result = await unpublishContentItem(supabase, tenantId, item as any);
  const prevMeta = (item.meta as Record<string, unknown>) ?? {};

  if (result.ok) {
    await supabase
      .from("content_items")
      .update({
        status: "approved",
        meta: { ...prevMeta, publishedUrl: null, wpPostId: null, unpublishedAt: new Date().toISOString() },
      })
      .eq("id", id);
  }
  return { ...result, title: item.title };
}
