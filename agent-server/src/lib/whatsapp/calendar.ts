/** §29.6 (P7) — the agent-server's thin client to the web app's /api/whatsapp/calendar. The worker
 *  can't touch Google directly (the refresh token is encrypted with the web's key), so booking a
 *  Meet goes over the same internal hop as googleSync, authenticated with AGENT_SERVER_TOKEN.
 *
 *  Every call returns { ok } — a Google/Calendar problem is a graceful `ok:false` with a `code`, so
 *  the meeting flow can fall back to "admin will schedule manually" instead of throwing. */
import { env } from "../../env.js";

type Slot = { start: string; end: string };

async function call(body: Record<string, unknown>): Promise<any> {
  if (!env.WEB_APP_URL || !env.AGENT_SERVER_TOKEN) return { ok: false, code: "not_configured" };
  try {
    const res = await fetch(`${env.WEB_APP_URL.replace(/\/+$/, "")}/api/whatsapp/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": env.AGENT_SERVER_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return await res.json().catch(() => ({ ok: false, code: "bad_response" }));
  } catch (e: any) {
    return { ok: false, code: "unreachable", error: e?.message };
  }
}

export async function calendarFreeBusy(tenantId: string, opts: { tzOffset: number; sendStart: number; sendEnd: number; durationMin?: number; want?: number }): Promise<{ ok: boolean; slots?: Slot[]; code?: string }> {
  return call({ action: "freebusy", tenantId, ...opts });
}

export async function calendarBook(tenantId: string, opts: { startIso: string; endIso: string; tzOffset: number; summary: string; description?: string }): Promise<{ ok: boolean; eventId?: string; meetLink?: string | null; htmlLink?: string | null; code?: string; error?: string }> {
  return call({ action: "book", tenantId, ...opts });
}

export async function calendarCancel(tenantId: string, eventId: string): Promise<{ ok: boolean }> {
  return call({ action: "cancel", tenantId, eventId });
}
