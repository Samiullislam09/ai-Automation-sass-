/** One place that talks to agent-server's POST /jobs/:type.
 *  Used by /api/agents/trigger (the "Run the team" button) AND by /api/chat, so that asking
 *  Mr Lxwa in chat for an article starts exactly the same real pg-boss job the button does —
 *  the chat is not allowed to have its own, different, pretend pipeline. */

// "crawler" is here for the Site Brain page's Refresh (MASTER_PLAN §25.9, manual refresh):
// re-reading the site is what makes the profile fresh, and the crawler enqueues Mr. Analyst
// itself when it finishes, so one job rebuilds the whole brain. "analyst" is separate because
// a profile can also be rebuilt from pages already crawled, without paying for a crawl.
export const AGENT_JOB_TYPES = ["boss", "keyword", "writer", "social", "seo", "crawler", "analyst", "audit"] as const;
export type AgentJobType = (typeof AGENT_JOB_TYPES)[number];

// One flat shape rather than a discriminated union on purpose: this repo compiles with
// strict:false, where TS can't narrow `ok: true | false` unions at all.
export type EnqueueResult = { ok: boolean; jobId?: string; error?: string; status?: number };

export async function enqueueAgentJob(
  type: AgentJobType,
  tenantId: string,
  payload: Record<string, unknown> = {}
): Promise<EnqueueResult> {
  const agentServerUrl = process.env.AGENT_SERVER_URL;
  if (!agentServerUrl) return { ok: false, error: "Agent server not configured.", status: 503 };

  try {
    const res = await fetch(`${agentServerUrl}/jobs/${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Optional shared secret (agent-server/src/index.ts). Set it in both places to close
        // the public /jobs endpoint; leaving it unset keeps today's behaviour.
        ...(process.env.AGENT_SERVER_TOKEN ? { "x-agent-token": process.env.AGENT_SERVER_TOKEN } : {}),
      },
      body: JSON.stringify({ tenantId, ...payload }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { ok: false, error: data?.error ?? "Agent server rejected the job.", status: res.status };
    return { ok: true, jobId: data?.jobId };
  } catch (e: any) {
    console.error(`[agent-jobs] enqueue ${type} failed:`, e?.message);
    return { ok: false, error: e?.message ?? "Could not reach the agent server.", status: 502 };
  }
}
