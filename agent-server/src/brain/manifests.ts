/** What today's agents can actually do, written as manifests.
 *
 *  This file is the bridge between the world that exists (seven pg-boss workers in
 *  `src/agents/*.ts`, some real, some stubs) and the world the plan describes (every agent its
 *  own service, describing itself over `GET /manifest`). Until the agents move out, the brain
 *  reads their manifests from here and reaches them through the in-process adapter.
 *
 *  THE RULES THAT MAKE THIS SAFE (plan §5.5, the "panga" table):
 *   - `needs` / `provides` are what the planner walks. They are the ONLY thing that decides
 *     which agent runs first. Nobody hard-codes an order anywhere else.
 *   - `phrases` are what the intent engine offers the model as tools. Two actions may not
 *     claim the same phrase — the registry refuses to start if they do.
 *   - `irreversible: true` is what triggers the echo-and-confirm. It comes from here, never
 *     from the model.
 *   - `estimated_seconds` is what the user is told. Measured where we have numbers (see the
 *     comment on each), guessed only where nothing has ever run.
 *
 *  A stub agent still gets a manifest, but `enabled: false` in the registry — so the model is
 *  never offered a tool that would answer with "stub — Phase 3 wires in…". Better to say
 *  "I can't do that yet" than to accept the order and return nothing.
 */

import type { Manifest } from "../vendor/agent-contract/index.js";

/** Measured from jobs_log on 2026-08-27 where a number exists; marked GUESS otherwise. */
export const MANIFESTS: Manifest[] = [
  {
    id: "crawler",
    name: "Mr. Crawler",
    version: "1.0.0",
    description: "Reads the customer's website page by page and stores the text and embeddings.",
    actions: [
      {
        id: "crawl_site",
        phrases: ["crawl my site", "site padho", "read my website", "website crawl karo", "re-crawl"],
        input: { limit: "number?" },
        output: { pagesCrawled: "number" },
        provides: "site_pages",
        needs: [],
        irreversible: false,
        estimated_seconds: 180, // 15-300 pages; measured runs sat between 40s and 6 min
        cost_units: 5,
      },
    ],
    office: { room: "crawler", ico: "🕷️", color: "#7dd3fc" },
  },

  {
    id: "analyst",
    name: "Mr. Analyst",
    version: "1.0.0",
    description: "Turns the crawled pages plus Search Console into the Site Brain profile every other agent reads.",
    actions: [
      {
        id: "build_site_profile",
        phrases: ["analyse my site", "site profile banao", "meri site samjho", "what do you know about my site"],
        input: { pages: "number?" },
        output: { version: "number", fields: "number" },
        provides: "site_profile",
        needs: [],
        irreversible: false,
        estimated_seconds: 120, // GUESS — first version has never run in production
        cost_units: 8,
      },
    ],
    office: { room: "analyst", ico: "🔎", color: "#a3e635" },
  },

  {
    id: "boss",
    name: "Mr Lxwa",
    version: "1.0.0",
    description: "Picks which topics the business should publish next, grounded in the site and what is already written.",
    actions: [
      {
        id: "plan_topics",
        phrases: ["what should i write about", "topic suggest karo", "plan my content", "kya likhun", "content plan"],
        input: { count: "number?" },
        output: { planned: "number", topics: "string[]" },
        provides: "topics",
        needs: [],
        irreversible: false,
        estimated_seconds: 25, // measured: boss runs 18-30s
        cost_units: 6,
      },
    ],
    office: { room: "boss", ico: "🧠", color: "#f0abfc" },
  },

  {
    id: "keyword",
    name: "Mr. Keyword",
    version: "2.0.0", // 2.x = the free source chain (DataForSEO optional → GSC → autocomplete → AI)
    description: "Finds the keywords worth writing about and says where each number came from.",
    actions: [
      {
        id: "find_keywords",
        phrases: [
          "keywords do", "sirf keyword", "keyword research", "find keywords",
          "keyword nikalo", "search volume", "kaunse keyword",
        ],
        input: { topic: "string", count: "number?" },
        output: { relatedKeywords: "object[]", recommended: "string", source: "string" },
        provides: "keywords",
        needs: [],
        irreversible: false,
        estimated_seconds: 20, // measured: 12-30s, autocomplete path ~6s cold
        cost_units: 3,
      },
    ],
    office: { room: "kw", ico: "🔑", color: "#fbbf24" },
  },

  {
    id: "writer",
    name: "Mr. Writer",
    version: "1.0.0",
    description: "Researches and writes the article, then measures it against the quality gate before anyone sees it.",
    actions: [
      {
        id: "write_article",
        phrases: [
          "article likho", "blog likho", "write an article", "write a post",
          "likh do", "post banao", "content likho",
        ],
        // `keywords` is required, not optional, because it is also a hard `need`: the planner
        // guarantees a keyword step ran first, so declaring it optional was a lie that only
        // survived because nothing checked. (The planner exempts fields that are also needs
        // from the missing-slot question, so this costs the user no extra question.)
        input: { topic: "string", keywords: "string[]", tone: "string?", words: "number?" },
        output: { title: "string", body: "string", wordCount: "number", qualityGate: "object" },
        provides: "article",
        needs: ["keywords"],
        irreversible: false,
        estimated_seconds: 300, // measured: 3-8 min with research
        cost_units: 40,
      },
      {
        // "solar pe research karo, likhna mat" — plan §5.5's second question. Same agent, the
        // research step alone, so the model never has to fake a "research agent" that does not exist.
        id: "research_brief",
        phrases: ["research karo", "research only", "brief banao", "likhna mat", "just research"],
        input: { topic: "string" },
        output: { brief: "string", sources: "string[]" },
        provides: "brief",
        needs: [],
        irreversible: false,
        estimated_seconds: 90, // GUESS — the research step alone has never been timed on its own
        cost_units: 12,
      },
    ],
    office: { room: "writer", ico: "✍️", color: "#b48bff" },
  },

  {
    id: "seo",
    name: "Mr. SEO",
    version: "0.1.0", // stub today — registry keeps it disabled until the real checks land (Phase 2)
    description: "Scores a draft against the SERP and the on-page checklist, and sends it back if it fails.",
    actions: [
      {
        id: "check_seo",
        phrases: ["seo check", "seo score", "optimise this", "seo dekho"],
        input: { article: "object", keywords: "string[]?" },
        output: { score: "number", passed: "boolean", issues: "object[]" },
        provides: "seo_passed",
        needs: ["article"],
        irreversible: false,
        estimated_seconds: 40,
        cost_units: 8,
      },
    ],
    office: { room: "seo", ico: "📈", color: "#34d399" },
  },

  {
    id: "publish",
    name: "Mr. Publish",
    version: "1.0.0",
    description: "Puts the approved article on the customer's site and verifies the URL actually loads.",
    actions: [
      {
        id: "publish_article",
        phrases: ["publish karo", "publish it", "live kar do", "site pe daal do", "post it"],
        input: { content_item_id: "string" },
        output: { url: "string", verified: "boolean" },
        provides: "published_url",
        // seo_passed is required and NOT optional: a page on the customer's live site is the
        // one thing that cannot be quietly undone, so it does not go up unmeasured.
        //
        // `images` is deliberately absent until an image agent exists. The plan's diagram has
        // publish needing images — but a need nobody provides makes every publish plan fail,
        // and an optional-need for a non-existent agent is noise in every outline. Add
        // "images" here the same day agent-image gets a manifest, not before.
        needs: ["article", "seo_passed"],
        irreversible: true,
        estimated_seconds: 30, // measured: WP REST round-trip plus the 200 check
        cost_units: 2,
      },
    ],
    office: { room: "publish", ico: "🚀", color: "#f87171" },
  },

  {
    id: "social",
    name: "Mr. Social",
    version: "0.1.0", // stub — Phase 3
    description: "Drafts the social posts for an article and schedules them once approved.",
    actions: [
      {
        id: "draft_social",
        phrases: ["social post banao", "linkedin post", "share on social", "post for facebook"],
        input: { article: "object", networks: "string[]?" },
        output: { posts: "object[]" },
        provides: "social_posts",
        needs: ["article"],
        optional: true,
        irreversible: false,
        estimated_seconds: 45,
        cost_units: 10,
      },
    ],
    office: { room: "social", ico: "📣", color: "#60a5fa" },
  },

  {
    id: "leads",
    name: "Mr. Lead",
    version: "0.1.0", // stub — Phase 3
    description: "Finds businesses that match the customer's ICP and drafts the first outreach line.",
    actions: [
      {
        id: "find_leads",
        phrases: ["leads dhundo", "find leads", "prospects nikalo", "lead list banao"],
        input: { query: "string", count: "number?" },
        output: { leads: "object[]" },
        provides: "leads",
        needs: [],
        irreversible: false,
        estimated_seconds: 240,
        cost_units: 30,
      },
    ],
    office: { room: "leads", ico: "🎯", color: "#fb923c" },
  },
];

/** Which of the above are real today. Everything else is registered but disabled, so the intent
 *  engine is never offered a tool whose agent would answer "stub — Phase N wires in…".
 *  Move an id out of here the day its agent stops being a stub. */
export const STUB_AGENTS = new Set(["seo", "social", "leads"]);

/** `publish` has no worker of its own yet — today the writer auto-publishes when a schedule
 *  says so (`agents/writer.ts` → `maybeAutoPublish`). The manifest is here because the planner
 *  needs to know publishing is irreversible and needs a measured article; the adapter that
 *  routes `publish_article` to real code lands with agent-publish in Phase 2. */
export const NOT_YET_ROUTED = new Set(["publish"]);
