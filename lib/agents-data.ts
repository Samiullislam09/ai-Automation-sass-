/** lib/agents-data.ts — plain data, no "use client" directive on purpose.
 *  lib/store.tsx (a client component module) re-exports AGENTS from here for the UI, and
 *  server-only code (lib/dashboard-data.ts, used by the API routes) imports it straight from
 *  here. Importing AGENTS from lib/store.tsx on the server used to crash every /api/dashboard/*
 *  request with "Attempted to call filter() from the server but filter is on the client" —
 *  Next.js replaces every export of a "use client" module with a client-reference proxy that
 *  throws the moment server code touches it (here: STORE_AGENTS.filter(...)). Keeping this one
 *  array in a plain module is the fix; do not move it back into store.tsx.
 *
 * "live" agents have real backend wiring (agent-server queue jobs, see agent-server/src/agents/).
 * The rest are visual roster slots for now (roadmap placeholders) — shown in the office same as
 * the reference "AI Command Center" layout, but their status stays "idle"/decorative until a real
 * agent is built for them. Not faked as working; see Office.tsx's room tag for how this is signaled.
 */
export const AGENTS = [
  { id: "boss",      name: "Mr Lxwa",       role: "Orchestrator",       ico: "🧠", c: "#7c5cff", live: true },
  { id: "kw",        name: "Mr. Keyword",   role: "Keyword Research",   ico: "🔎", c: "#6ea8ff", live: true },
  { id: "writer",    name: "Mr. Writer",    role: "Article Writer",     ico: "✍️", c: "#b48bff", live: true },
  { id: "image",     name: "Mr. Image",     role: "Image Generation",   ico: "🖼️", c: "#ff8fb3", live: false },
  { id: "seo",       name: "Mr. SEO",       role: "SEO & Site Care",    ico: "📈", c: "#7ee787", live: false }, // agent-server/src/agents/seo.ts is still a stub — not real yet
  { id: "social",    name: "Miss Social",   role: "Social Media",       ico: "📣", c: "#ffb95e", live: false }, // agent-server/src/agents/social.ts is still a stub — not real yet
  { id: "reply",     name: "Mr. Reply",     role: "Comment Replies",    ico: "💬", c: "#5ec9d6", live: false },
  { id: "email",     name: "Mr. Email",     role: "Email Outreach",     ico: "✉️", c: "#f5c451", live: false },
  { id: "analytics", name: "Miss Analytics",role: "Analytics",          ico: "📊", c: "#6ea8ff", live: false },
  { id: "story",     name: "Mr. Story",     role: "Web Stories",        ico: "🎨", c: "#ff8fb3", live: false },
  { id: "qa",        name: "Mr. QA",        role: "Quality Review",     ico: "🔍", c: "#e08a3c", live: true }, // powers the real quality gate (Step 12)
  { id: "publish",   name: "Mr. Publish",   role: "WordPress Publish",  ico: "📤", c: "#a78bfa", live: true }, // powers real WordPress/webhook publish (Step 12)
  { id: "backup",    name: "Mr. Backup",    role: "Backups",            ico: "🗄️", c: "#8b93b8", live: false },
];
