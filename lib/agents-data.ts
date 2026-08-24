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
