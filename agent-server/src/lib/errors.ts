/** Turns a thrown Error into something a non-engineer can act on.
 *
 *  "The operation was aborted due to timeout" is undici's wording for *any* aborted fetch.
 *  It named neither the call, nor the wait, nor what to do — and it went straight onto the
 *  user's dashboard three times in a row, which reads like the product is broken at random.
 *  Every failure now carries: what actually failed, the technical cause underneath, and a
 *  hint that says whose problem it is and what fixes it.
 *
 *  Nothing here invents a diagnosis: an unrecognised error keeps its original message and
 *  simply gets no hint, rather than being guessed at. */

export type ExplainedError = {
  /** One human sentence, shown on the dashboard and read back by Mr Lxwa in chat. */
  message: string;
  /** The raw thing that went wrong, kept verbatim for debugging. */
  cause: string;
  /** What to do about it. Absent when we genuinely don't know. */
  hint?: string;
  /** First few stack frames — enough to locate it, not a wall of text in a jsonb column. */
  stack?: string;
};

const AGENT_LABEL: Record<string, string> = {
  boss: "Mr Lxwa",
  keyword: "Mr. Keyword",
  writer: "Mr. Writer",
  crawler: "the site crawler",
  social: "Miss Social",
  seo: "Mr. SEO",
  leads: "the leads agent",
};

export function explainAgentError(agent: string, err: any, durationMs: number): ExplainedError {
  const who = AGENT_LABEL[agent] ?? agent;
  const raw = String(err?.message ?? err ?? "Unknown error");
  const seconds = Math.round(durationMs / 1000);
  const stack = typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 4).join("\n") : undefined;
  const base = { cause: raw, stack };

  // A fetch that ran out of time. The wording differs between undici versions and between
  // AbortSignal.timeout and a manual abort, so match on both the error name and the text.
  if (err?.name === "TimeoutError" || /aborted due to timeout|operation was aborted|abort/i.test(raw)) {
    return {
      ...base,
      message: `${who} gave up waiting for the AI model after ${seconds}s. Nothing was saved.`,
      hint:
        agent === "writer"
          ? "A full article takes this model ~90s to generate. If this keeps happening at ~60s, the running agent-server is an old build without the fix that stops the model burning its whole budget on internal reasoning — redeploy agent-server."
          : "The model provider did not answer in time. Usually transient; if it repeats, check NVIDIA status and the API key.",
    };
  }

  if (/40104/.test(raw) || /verify your account/i.test(raw)) {
    return {
      ...base,
      message: "DataForSEO refused the request: the account is not verified.",
      hint: "Verify the DataForSEO account to get measured search volumes. Until then keyword research falls back to Search Console, then to the AI — the pipeline keeps going either way.",
    };
  }

  if (/\b(401|403)\b|unauthor|forbidden|invalid api key/i.test(raw)) {
    return { ...base, message: `${who} was refused by the provider (auth).`, hint: "An API key is missing, wrong or expired — check the agent-server environment variables." };
  }

  if (/\b429\b|rate limit|too many requests/i.test(raw)) {
    return { ...base, message: `${who} hit the provider's rate limit.`, hint: "Too many calls at once. It will retry; if it persists, slow the schedule or raise the provider quota." };
  }

  if (/\b5\d\d\b|bad gateway|service unavailable|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(raw)) {
    return { ...base, message: `${who} could not reach the provider.`, hint: "Network or provider outage — normally transient, the job retries on its own." };
  }

  if (/token limit|finish_reason=length|cut off/i.test(raw)) {
    return { ...base, message: raw, hint: "The draft ran past the model's output ceiling. Ask for a shorter article, or raise max_tokens in agent-server/src/lib/writer.ts." };
  }

  if (/NVIDIA_API_KEY missing|missing required env/i.test(raw)) {
    return { ...base, message: raw, hint: "A required environment variable is not set on agent-server (Railway → Variables)." };
  }

  // Unrecognised: keep the original wording rather than inventing an explanation for it.
  return { ...base, message: raw };
}
