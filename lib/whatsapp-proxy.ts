/** Server-side helper: call agent-server's /whatsapp/* endpoints with the shared token.
 *
 *  WHY A PROXY AT ALL. The browser must never hold AGENT_SERVER_TOKEN — it is the key that lets
 *  a caller spend a tenant's WhatsApp and model credits. So the dashboard calls our own
 *  /api/whatsapp/* routes (same origin, cookie-authenticated as the signed-in member), those
 *  routes verify the member owns the tenant, and only THEN does this helper add the token and
 *  reach agent-server. The token stays on the server the whole way.
 *
 *  Same 25s-ceiling-plus-one-retry shape as lib/agent-jobs.ts, for the same reason: Railway
 *  restarts agent-server on deploy and the first call after can be slow. */
const TRANSIENT = /timeout|abort|ECONNREFUSED|ECONNRESET|fetch failed|ENOTFOUND|EAI_AGAIN/i;

export type WaResult = { ok: boolean; status?: number; error?: string; [k: string]: unknown };

export async function callWhatsapp(
  tenantId: string,
  path: "connect" | "status" | "send" | "disconnect",
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<WaResult> {
  const base = process.env.AGENT_SERVER_URL;
  if (!base) return { ok: false, error: "Agent server not configured.", status: 503 };

  const url = `${base.replace(/\/+$/, "")}/whatsapp/${tenantId}/${path}`;
  const attempt = async (): Promise<WaResult> => {
    const res = await fetch(url, {
      method: init.method ?? (path === "status" ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AGENT_SERVER_TOKEN ? { "x-agent-token": process.env.AGENT_SERVER_TOKEN } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const data = (await res.json().catch(() => ({}))) as WaResult;
    if (!res.ok) return { ok: false, error: data?.error ?? "Agent server rejected the request.", status: res.status };
    return { ...data, ok: true };
  };

  try {
    return await attempt();
  } catch (first: any) {
    if (!TRANSIENT.test(String(first?.name ?? "") + " " + String(first?.message ?? ""))) {
      return { ok: false, error: first?.message ?? "Could not reach the agent server.", status: 502 };
    }
    try {
      return await attempt();
    } catch (second: any) {
      return { ok: false, error: second?.message ?? "Agent server is not responding.", status: 502 };
    }
  }
}
