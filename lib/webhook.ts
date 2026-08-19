import crypto from "crypto";

/** Signs a webhook payload the same way GitHub/Stripe do — client-side sites (Next.js,
 *  or literally anything with an HTTP endpoint) verify this to trust the request came from us.
 *  Server-only. */
export function signPayload(secret: string, payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function generateWebhookSecret(): string {
  return "whsec_" + crypto.randomBytes(24).toString("hex");
}
