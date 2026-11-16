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
    const j = await res.json().catch(() => ({ ok: false, code: "bad_response" }));
    // A refusal from the web app (wrong token, error page) has no `code`: name it, so the owner is told what to fix.
    if (!res.ok && j && !j.code) j.code = res.status === 401 ? "unauthorized" : `http_${res.status}`;
    return j;
  } catch (e: any) {
    return { ok: false, code: "unreachable", error: e?.message };
  }
}

/** What a failed calendar call means, in words an owner can act on. `where` says what to do and where. */
export function explainCalendarCode(code: string | undefined): string {
  switch (code) {
    case "not_configured": return "The agent server (Railway) is not linked to the web app: set WEB_APP_URL (your Vercel address, e.g. https://ai-automation-sass.vercel.app) and AGENT_SERVER_TOKEN (the SAME value as on Vercel) on Railway, then redeploy.";
    case "unreachable": return "The agent server could not reach the web app. Check that WEB_APP_URL on Railway is your live Vercel address.";
    case "unauthorized": return "AGENT_SERVER_TOKEN on Railway is different from AGENT_SERVER_TOKEN on Vercel. Make them identical and redeploy both.";
    case "not_connected": return "Google is not connected for this account. Connect it on the Connect page.";
    case "no_scope": return "Google is connected but without Calendar permission. Disconnect and connect Google again, and tick Calendar.";
    case "token": return "Google no longer accepts the saved login. Disconnect and connect Google again.";
    case "bad_response": return "The web app answered with something unexpected. Check the Vercel deployment logs for /api/whatsapp/calendar.";
    default: return code ? `Google Calendar could not be used (${code}). Check the Vercel logs for /api/whatsapp/calendar.` : "Google Calendar could not be used.";
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
