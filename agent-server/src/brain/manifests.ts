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
      // Same site-analysis + duplicate locks as plan_topics, count fixed to 1 and the topic
      // returned as this step's output instead of being enqueued itself — see needs on
      // find_keywords and write_article below. Added 2026-08-31 so "article likho" (no topic
      // given) does not dead-end on "which topic?": the planner's own backward-closure pulls
      // this step in automatically whenever `topic` is a `need` and the intent left it blank
      // (the existing "user already gave us this one" rule in planner.ts skips it the instant
      // a literal topic IS given, so this changes nothing for the common case).
      {
        id: "pick_topic",
        phrases: ["best topic for me", "aap he decide karo", "khud topic chuno", "which topic should i write"],
        input: {},
        // The step's own output IS the topic string — see boss.ts's run() for why (resolveInput
        // threads a provider's whole output in under the need's name, so the value here has to
        // be exactly what a consumer's `topic` field expects). `why` goes out as a live "data"
        // event instead, not through this return value.
        output: { topic: "string" },
        provides: "topic",
        needs: [],
        irreversible: false,
        estimated_seconds: 25, // GUESS — same call shape as plan_topics, never timed alone
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
        // "topic" only turns into a real step when the user did not give one — see boss's
        // pick_topic above. When a topic IS given ("keywords do X"), the planner's own rule
        // ("the user already handed us this one") satisfies the need from the literal param
        // and no Boss step is added — this plan stays exactly the 1-step plan it always was.
        needs: ["topic"],
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
        // `with_story` is REQUIRED on purpose, and it is the one question this action asks.
        // Owner, 2026-09-05: "article likhne se pehle user se poochna kya wo web story bhi
        // chahta hai — pehle hi puchlena". A model that hears "article + story banao" fills it
        // and nobody is asked anything; silence means the planner asks once, before any work
        // starts, rather than the customer discovering afterwards that they could have had one.
        input: { topic: "string", keywords: "string[]", with_story: "boolean", tone: "string?", words: "number?" },
        output: { title: "string", body: "string", wordCount: "number", qualityGate: "object" },
        provides: "article",
        // "topic" here for the same reason as find_keywords above: given → satisfied literally,
        // no extra step; blank → Boss picks one, grounded in the site's own crawled pages and
        // what has already been written, and the SAME picked topic reaches both this step and
        // the keyword step it depends on (the planner adds boss.pick_topic once, shared).
        needs: ["keywords", "topic"],
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
    id: "image",
    name: "Mr. Image",
    version: "1.0.0",
    description: "Makes the pictures an article needs — a thumbnail, a hero, and one per long section — each tied to the part of the article it belongs to.",
    actions: [
      {
        // The article pipeline's own step. Mr. Image writes the brief itself here, from the
        // article and the Site Brain, and then checks its own answer against the article's
        // headings (MASTER_PLAN §19.4.3). `bump` is the user's "another image" button.
        id: "make_images",
        phrases: ["image banao", "is article ki image badlo", "images do", "make images", "add pictures", "thumbnail banao"],
        // Named `article` because that is also the NEED: when this step follows Mr. Writer the
        // brain threads the writer's whole output in under the need's name (the same reason
        // write_article's input is called `keywords`), and agents/image.ts reads the article's
        // own id out of it. `bump` is the user's "another image" button — seed + 1, §19.4.3.
        input: { article: "object", bump: "number?" },
        output: { images: "object[]", imageSetId: "string", generated: "number" },
        provides: "images",
        needs: ["article"],
        // §5.5's own word for this, and §19.4.4's promise: a publish never waits on pictures.
        // If Mr. Image is down the plan runs without him and the article goes out with
        // template cards, rather than the whole order stopping.
        optional: true,
        irreversible: false,
        // Measured: Cloudflare answered in 3.7s per image (2026-09-05) and an article takes 2-5
        // of them, plus one brief call and the sharp work. A template fallback is far quicker.
        estimated_seconds: 40,
        cost_units: 4,
      },

      {
        // ONE picture, on its own, with no article anywhere near it. Without this, "ek image
        // banao" hit `make_images`, whose `needs: ["article"]` made the planner walk backwards
        // and write a whole article first — expensive, slow, and not remotely what was asked
        // (owner, 2026-09-05: "sirf image banane bole to image hi bana ke de").
        //
        // `subject` is required and is the user's own words: the picture is theirs to describe,
        // so nothing here invents a subject for them.
        id: "make_image",
        phrases: ["ek image banao", "image generate karo", "picture banao", "generate an image", "make me an image", "ek picture do"],
        input: { subject: "string", style: "string?", shape: "string?" },
        output: { url: "string", imageSetId: "string" },
        provides: "standalone_image",
        needs: [],
        irreversible: false,
        estimated_seconds: 15, // measured: Cloudflare answered in 3.7s, plus sharp and the upload
        cost_units: 2,
      },
    ],
    // NOTE — `render_images` is deliberately NOT a manifest action. Mr. Image also accepts a
    // job carrying `briefs` (agents/image.ts's renderBriefs), which is how Mr. Story gets its
    // cover and hook pages and how Miss Social will get a post image: the caller writes the
    // brief and Mr. Image renders it word for word (§19.4.3). That is agent-to-agent work, the
    // same way the crawler enqueues the analyst — nobody orders it in chat, it has no phrases
    // a person would say, and putting it in the manifest would offer the intent engine a tool
    // whose only required input is something a user cannot type.
    office: { room: "image", ico: "🖼️", color: "#f472b6" },
  },

  {
    id: "story",
    name: "Mr. Story",
    version: "1.0.0",
    description: "Turns an article into a Google Web Story — a phone-sized picture story that gets its own carousel in Discover.",
    actions: [
      {
        id: "make_story",
        phrases: ["web story banao", "make a web story", "isse story banao", "story banao", "amp story"],
        // Same naming rule as make_images: the input is called after the need, so the brain can
        // thread Mr. Writer's whole output straight into it.
        input: { article: "object", bump: "number?" },
        output: { pages: "number", storyId: "string", valid: "boolean" },
        provides: "web_story",
        // Images too: a story reuses the article's own pictures rather than generating eight of
        // its own (MASTER_PLAN §19.4.5), so it has to run after Mr. Image.
        needs: ["article", "images"],
        // Filed for approval like everything else — it does not touch the live site itself.
        irreversible: false,
        // Two Cloudflare images at ~4s, one outline call, plus re-cropping the article's own.
        estimated_seconds: 50,
        cost_units: 5,
      },
    ],
    office: { room: "story", ico: "📖", color: "#38bdf8" },
  },

  {
    id: "seo",
    name: "Mr. SEO",
    version: "1.0.0", // was 0.1.0/stub — agents/seo.ts (24 checks) landed in Phase 2, `seo.test.ts`
    // itself asserts `STUB_AGENTS.has("seo") === false`. This comment was the only stale thing:
    // STUB_AGENTS below was already empty, so the agent has been enabled all along.
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
        // `images` was deliberately absent while no image agent existed — a need nobody
        // provides makes every publish plan fail — and the note here said to add it "the same
        // day agent-image gets a manifest, not before". That day was 2026-09-05, so it is in.
        // It is safe because make_images is `optional: true`: the
        // planner schedules it, and if Mr. Image is unavailable the step is skipped with a
        // note and the publish still runs — the article goes out with template cards rather
        // than not at all (§19.4.4).
        needs: ["article", "seo_passed", "images"],
        irreversible: true,
        estimated_seconds: 30, // measured: WP REST round-trip plus the 200 check
        cost_units: 2,
      },
    ],
    office: { room: "publish", ico: "🚀", color: "#f87171" },
  },

  {
    id: "audit",
    name: "Mr. Audit",
    version: "1.0.0",
    description: "Checks the whole site for what is broken, invisible to Google, or costing traffic.",
    actions: [
      {
        id: "audit_site",
        phrases: ["site audit karo", "audit my site", "meri site check karo", "site audit", "what is wrong with my site", "site ki problem batao"],
        input: { pages: "number?" },
        output: { score: "number", issues: "object[]", summary: "string" },
        provides: "site_audit",
        needs: [],
        irreversible: false,
        // Measured against the sequential fetch: 50 pages at ~400ms of politeness plus the
        // response itself. §7.4 quotes 2-4 minutes for the Playwright version; this one is
        // lighter because it never starts a browser.
        estimated_seconds: 150,
        cost_units: 6,
      },
    ],
    office: { room: "audit", ico: "🩺", color: "#facc15" },
  },

  {
    id: "social",
    name: "Miss Social",
    version: "1.0.0",
    // §7.7: no network can actually be posted to yet (Meta App Review is weeks away and a
    // manual step), so the honest description is drafts to copy, not automation.
    description: "Drafts social posts for an article, one per network, ready to copy and post yourself.",
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
    version: "1.0.0",
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
export const STUB_AGENTS = new Set<string>([]);

/** Agents with a manifest but no code behind them yet. Registered so the planner can reason
 *  about what they would provide, but never offered to a user.
 *
 *  Empty as of 2026-08-27: `publish` moved out when `agents/publish.ts` landed with its queue,
 *  its worker and its adapter route. Keep the set — the next agent to get a manifest before it
 *  gets an implementation belongs here rather than in a comment somewhere. */
export const NOT_YET_ROUTED = new Set<string>([]);
