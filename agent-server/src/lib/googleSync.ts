import { env } from "../env.js";

/** Asks the Next.js app to refresh this tenant's Google numbers before we plan with them.
 *
 *  Why not call Google from here: the OAuth refresh token is encrypted with
 *  CREDENTIALS_ENCRYPTION_KEY, which lives on the web side. Keeping the key (and the
 *  Google client secret) in exactly one process is worth an internal HTTP hop — this
 *  server never holds a customer's Google credentials at all.
 *
 *  Entirely best-effort. Not configured, unreachable, Google down, tenant hasn't connected
 *  Google — all of it is a log line and a return, never a failed job. Planning still works
 *  off the crawl, exactly as it did before any of this existed. */
export async function syncGoogleInsights(tenantId: string): Promise<void> {
  if (!env.WEB_APP_URL || !env.AGENT_SERVER_TOKEN) {
    // Silent by design: most installs won't have Google connected, and a warning every
    // single run would train everyone to ignore the log.
    return;
  }

  try {
    const res = await fetch(`${env.WEB_APP_URL.replace(/\/+$/, "")}/api/integrations/google/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": env.AGENT_SERVER_TOKEN },
      body: JSON.stringify({ tenantId }),
      signal: AbortSignal.timeout(45_000),
    });
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn(`[googleSync] tenant ${tenantId}: ${data?.error ?? res.status}`);
      return;
    }
    if (data?.skipped) return;
    console.log(`[googleSync] tenant ${tenantId}: refreshed`, data?.counts ?? {});
  } catch (e: any) {
    console.warn(`[googleSync] tenant ${tenantId} failed:`, e?.message);
  }
}
