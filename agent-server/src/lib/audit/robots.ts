/** robots.txt parsing — shared by checks.ts (per-page "Blocked" status) and agents/audit.ts
 *  (the AI-bot access card, 2026-09-05). One parser, one set of rules, used both places, so a
 *  page or a bot can never be "blocked" by one check and "allowed" by the other.
 *
 *  WHY THIS EXISTS. The owner's own real Semrush report (screenshot, 2026-09-05) showed two
 *  cards this file previously assumed were impossible to build honestly here — "AI Search
 *  Health" and "Blocked from AI Search" (does robots.txt let GPTBot/ChatGPT-User/Google-
 *  Extended/etc. in?). That was wrong: those are not Semrush's own traffic-log product, they
 *  are a robots.txt DIRECTIVE check — and this app already fetches robots.txt for every audit
 *  (agent-server/src/lib/audit/fetchSite.ts's `fetchSiteContext`). Real data, sitting unread.
 *
 *  SCOPE, HONESTLY. A simplified but standards-faithful subset of the robots.txt spec (RFC
 *  9309's core matching rule — longest matching Allow/Disallow path wins, ties go to Allow):
 *  User-agent groups, Disallow/Allow, `*` and `$` wildcards. NOT implemented: crawl-delay,
 *  sitemap directives (irrelevant here), and the rarer edge cases real crawlers occasionally
 *  disagree on. Good enough to answer "is this bot let in" the same way a site owner reading
 *  their own robots.txt would, never a guess dressed as a certainty. */

export type RobotsGroup = { userAgents: string[]; rules: { type: "allow" | "disallow"; pattern: string }[] };

/** Parses the User-agent groups out of a robots.txt body. Malformed lines are skipped, never
 *  thrown on — a robots.txt with a typo in it is still real evidence, not a reason to give up
 *  reading the rest of it. */
export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRuleSinceUA = true; // true at start so the very first "User-agent:" always opens a fresh group

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === "user-agent") {
      // Consecutive "User-agent:" lines (no rule lines between them) belong to the SAME group —
      // that is how robots.txt lets one rule set apply to several bots at once.
      if (!current || sawRuleSinceUA) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        sawRuleSinceUA = false;
      }
      current!.userAgents.push(value);
    } else if ((key === "disallow" || key === "allow") && current) {
      current.rules.push({ type: key, pattern: value });
      sawRuleSinceUA = true;
    }
  }
  return groups;
}

/** The group that applies to `userAgent` — the group naming it exactly (case-insensitive)
 *  wins; otherwise the `*` group; otherwise none (an unlisted bot with no wildcard group is
 *  unrestricted, per spec). */
function groupFor(userAgent: string, groups: RobotsGroup[]): RobotsGroup | null {
  const named = groups.find((g) => g.userAgents.some((ua) => ua.toLowerCase() === userAgent.toLowerCase()));
  if (named) return named;
  return groups.find((g) => g.userAgents.includes("*")) ?? null;
}

/** `*` (any run of characters) and a trailing `$` (end-of-path anchor) — robots.txt's own two
 *  wildcards, nothing more exotic. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** Is `path` blocked for `userAgent`? RFC 9309's own rule: the LONGEST matching pattern wins
 *  (more specific beats more general); an exact-length tie goes to Allow. An empty Disallow
 *  value ("Disallow:") means "block nothing" — a common robots.txt idiom, not a typo to ignore. */
export function isBlocked(path: string, userAgent: string, groups: RobotsGroup[]): boolean {
  const group = groupFor(userAgent, groups);
  if (!group) return false;
  let best: { type: "allow" | "disallow"; length: number } | null = null;
  for (const rule of group.rules) {
    if (!rule.pattern) continue; // "Disallow:" with nothing after it blocks nothing
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.type === "allow")) {
      best = { type: rule.type, length: rule.pattern.length };
    }
  }
  return best?.type === "disallow";
}

/** The named AI crawlers worth a site owner knowing about, by what they are FOR — never a
 *  claim about how much traffic any of them sends (this app has no log of that, unlike
 *  Semrush's own product). Kept short and named, not "every bot that has ever existed": a list
 *  a person can actually read and recognise. */
export const AI_BOTS: { id: string; label: string }[] = [
  { id: "GPTBot", label: "GPTBot (OpenAI training)" },
  { id: "ChatGPT-User", label: "ChatGPT-User (live browsing)" },
  { id: "OAI-SearchBot", label: "OAI-SearchBot (ChatGPT search)" },
  { id: "Google-Extended", label: "Google-Extended (Gemini / AI Overviews)" },
  { id: "PerplexityBot", label: "PerplexityBot" },
  { id: "ClaudeBot", label: "ClaudeBot (Anthropic)" },
  { id: "CCBot", label: "CCBot (Common Crawl)" },
];

export type BotAccess = { bot: string; label: string; allowed: boolean };

/** Whether each named AI bot may read the homepage ("/") — real robots.txt evaluation, `null`
 *  only when there is no robots.txt at all to evaluate (never guessed as "allowed" by default
 *  dressed as a measurement). No robots.txt genuinely does mean "everything is allowed" per
 *  spec, so that case returns every bot as allowed, not skipped — the absence itself is the
 *  real answer. */
export function aiSearchAccess(robotsTxt: string | null): BotAccess[] | null {
  if (robotsTxt === null) return null;
  const groups = parseRobotsTxt(robotsTxt);
  return AI_BOTS.map((b) => ({ bot: b.id, label: b.label, allowed: !isBlocked("/", b.id, groups) }));
}
