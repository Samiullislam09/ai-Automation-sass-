/** Round-robin picker over a pool of NVIDIA API keys, so multiple keys give independent
 *  per-key rate-limit buckets instead of everything on the Next.js side fighting over one.
 *
 *  Two separate pools, not one shared list. NVIDIA_API_KEYS_CHAT is reserved for requests a
 *  human is waiting on right now (live chat: app/api/chat/route.ts; "revise this article":
 *  app/api/content/[id]/revise/route.ts). NVIDIA_API_KEYS_BG is agent-server's own pool for
 *  background/bulk work (crawler, keyword, writer, seo, analyst, the standalone reembed
 *  script) — see agent-server/src/lib/nvidia.ts, which has the fuller story.
 *
 *  Found live 2026-08-31: a standalone backfill script hitting the same single NVIDIA_API_KEY
 *  as live chat ate the account's whole rpm budget and chat sat on "…" for tens of seconds
 *  with no way to tell slow from dead. Splitting into dedicated pools per traffic class fixes
 *  this structurally — chat can never be starved by background load, no matter how heavy,
 *  because they physically cannot draw from the same bucket.
 *
 *  Falls back to the single NVIDIA_API_KEY when a pool isn't configured, so nothing breaks
 *  before real pool keys are added — this is additive, not a required migration. */

function parseKeys(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

const pools = {
  chat: parseKeys(process.env.NVIDIA_API_KEYS_CHAT),
  bg: parseKeys(process.env.NVIDIA_API_KEYS_BG),
};
const cursors = { chat: 0, bg: 0 };

/** Next key for the given traffic class. Throws (like the old single-key reads did) when
 *  nothing is configured at all — callers already handle that as a startup/config error. */
export function nvidiaKey(pool: "chat" | "bg"): string {
  const list = pools[pool];
  if (list.length > 0) {
    const i = cursors[pool] % list.length;
    cursors[pool]++;
    return list[i];
  }
  const single = process.env.NVIDIA_API_KEY;
  if (!single) {
    throw new Error(`NVIDIA_API_KEY missing (or NVIDIA_API_KEYS_${pool.toUpperCase()} for a dedicated pool)`);
  }
  return single;
}
