/** lib/agents-data.ts — plain data, no "use client" directive on purpose.
 *  lib/store.tsx (a client component module) re-exports AGENTS from here for the UI, and
 *  server-only code (lib/dashboard-data.ts, used by the API routes) imports it straight from
 *  here. Importing AGENTS from lib/store.tsx on the server used to crash every /api/dashboard/*
 *  request with "Attempted to call filter() from the server but filter is on the client" —
 *  Next.js replaces every export of a "use client" module with a client-reference proxy that
 *  throws the moment server code touches it (here: STORE_AGENTS.filter(...)). Keeping this one
 *  array in a plain module is the fix; do not move it back into store.tsx.
 *
 * THE TEAM IS THE FIVE AGENTS THAT ACTUALLY EXIST. The office used to show thirteen — eight of
 * them permanently asleep with "Coming soon" over their heads, which made a real run look like
 * a mostly-dead building and left no room on screen for the ones doing the work. The roadmap
 * names still live below in ROADMAP, so nothing is lost, but they are not staff until they have
 * an agent-server implementation and a queue.
 */
export const AGENTS = [
  { id: "boss",    name: "Mr Lxwa",     role: "Orchestrator",      ico: "🧠", c: "#7c5cff", live: true },
  { id: "kw",      name: "Mr. Keyword", role: "Keyword Research",  ico: "🔎", c: "#6ea8ff", live: true },
  { id: "writer",  name: "Mr. Writer",  role: "Article Writer",    ico: "✍️", c: "#b48bff", live: true },
  { id: "qa",      name: "Mr. QA",      role: "Quality Review",    ico: "🔍", c: "#e08a3c", live: true }, // the real quality gate (Step 12)
  { id: "publish", name: "Mr. Publish", role: "WordPress Publish", ico: "📤", c: "#a78bfa", live: true }, // real WordPress/webhook publish (Step 12)
];

/** Not staff yet — no agent-server implementation, no queue, so they get no room and are not
 *  counted anywhere. Kept here so the roadmap is visible in code rather than in someone's head. */
export const ROADMAP = [
  { id: "image",     name: "Mr. Image",      role: "Image Generation" },
  { id: "seo",       name: "Mr. SEO",        role: "SEO & Site Care" },
  { id: "social",    name: "Miss Social",    role: "Social Media" },
  { id: "reply",     name: "Mr. Reply",      role: "Comment Replies" },
  { id: "email",     name: "Mr. Email",      role: "Email Outreach" },
  { id: "analytics", name: "Miss Analytics", role: "Analytics" },
  { id: "story",     name: "Mr. Story",      role: "Web Stories" },
  { id: "backup",    name: "Mr. Backup",     role: "Backups" },
];

/* ============================= WHO EACH ONE IS =============================
 * Five identical stick figures in five different shirt colours is not a team — you cannot
 * tell at a glance which room you are looking at, and a zoomed-in desk looked exactly like
 * every other zoomed-in desk. Each agent now has a face you can recognise and a job title
 * that says what it is actually responsible for.
 *
 * `job` is the jobs_log.agent value this character's work is read from, so nothing here is
 * decoration hanging off nothing: an agent with no `job` (Mr. QA, Mr. Publish) is a stage
 * inside the writer job and its screen reads content_items instead. See lib/dashboard-data.ts.
 */
export type AgentLook = {
  /** Face + hair, so the five are distinguishable at a glance and at any zoom. */
  skin: string;
  hair: string;
  hairStyle: "short" | "quiff" | "bun" | "cap" | "buzz";
  shirt: string;
  /** One accessory each — the fastest way to tell two characters apart in silhouette. */
  wears: "glasses" | "headset" | "tie" | "visor" | "none";
  /** What sits on the desk next to the monitor. */
  prop: "magnifier" | "notebook" | "clipboard" | "outbox" | "none";
};

export type AgentProfile = {
  /** The job title on the door — what this agent is answerable for. */
  title: string;
  /** One sentence, present tense, describing the work it really does. No marketing. */
  brief: string;
  /** jobs_log.agent, or null when this agent is a stage inside another agent's job. */
  job: string | null;
  look: AgentLook;
};

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  boss: {
    title: "Chief of Staff",
    brief: "Picks what the team works on, from your niche and the pages we crawled, and hands each topic to the right specialist.",
    job: "boss",
    look: { skin: "#f0c8a0", hair: "#2b2320", hairStyle: "quiff", shirt: "#7c5cff", wears: "headset", prop: "clipboard" },
  },
  kw: {
    title: "Search Analyst",
    brief: "Measures what people actually search for — real monthly volume, competition, and what your own site already ranks for.",
    job: "keyword",
    look: { skin: "#8d5a3b", hair: "#171310", hairStyle: "buzz", shirt: "#6ea8ff", wears: "glasses", prop: "magnifier" },
  },
  writer: {
    title: "Staff Writer",
    brief: "Writes the draft against the blueprint, in your tone, with real internal links to your own pages.",
    job: "writer",
    look: { skin: "#f5cba0", hair: "#5a3a22", hairStyle: "bun", shirt: "#b48bff", wears: "none", prop: "notebook" },
  },
  qa: {
    title: "Quality Editor",
    brief: "Runs the quality gate on every draft — length, structure, keyword use, internal links — before you ever see it.",
    job: null,
    look: { skin: "#e8b98a", hair: "#3a2c22", hairStyle: "short", shirt: "#e08a3c", wears: "glasses", prop: "clipboard" },
  },
  publish: {
    title: "Publishing Manager",
    brief: "Puts an approved article on your site through WordPress or your webhook, and reports back the live URL.",
    job: null,
    look: { skin: "#c98f63", hair: "#241b16", hairStyle: "cap", shirt: "#a78bfa", wears: "visor", prop: "outbox" },
  },
};

/** The chain the code actually runs (agent-server: boss.ts enqueues keyword, keyword.ts
 *  enqueues writer). The office draws a handoff along this map — so an arrow between two
 *  rooms is the real pipeline, never a guess about who probably passed what to whom. */
export const HANDOFF_FROM: Record<string, string> = { kw: "boss", writer: "kw", qa: "writer", publish: "qa" };
