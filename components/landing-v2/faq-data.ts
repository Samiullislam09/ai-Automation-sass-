import { BRAND } from "@/lib/brand";
import { PLANS, TOKEN_COST } from "@/lib/plans";

/** The FAQ's questions and answers, in a plain module (not "use client") so the home page's server code can also read them for the
 *  FAQPage structured data (lib/structured-data.ts). */
export const CATS: Record<string, { q: string; a: string }[]> = {
  "Getting started": [
    { q: `What is ${BRAND.name}?`, a: `${BRAND.name} is an AI marketing team for your website. It researches keywords, writes articles in your tone and publishes them, with your approval at every step.` },
    { q: "How do I get started?", a: "Sign up, connect your website and answer a few questions. The team reads your site and proposes what to publish first." },
    { q: "Do I need technical skills?", a: "No. You talk to the chat manager in plain language and approve or reject what it prepares." },
    { q: "Which websites does it work with?", a: "It reads any public website. For publishing it connects to WordPress or any site that can receive a signed webhook." },
  ],
  Content: [
    { q: "Where do the topics come from?", a: "From real search data where available. Anything suggested by AI is clearly labelled and never shown with an invented number." },
    { q: "Will articles sound like my business?", a: "Yes. The team learns your services and tone from your site and checks every draft with a quality gate before it reaches you." },
    { q: "Where does it publish?", a: "To WordPress or through a signed webhook. More destinations are on the roadmap." },
    { q: "Can I edit an article before it goes live?", a: "Yes. Every article waits in your approvals. You can read it, edit it, approve it or reject it." },
    { q: "Which languages can I talk to it in?", a: "The chat manager understands English, Hinglish and Roman Urdu." },
  ],
  "Plans & billing": [
    { q: "How much does it cost?", a: `${PLANS.free.name} is $${PLANS.free.price} with no card needed, ${PLANS.starter.name} is $${PLANS.starter.price} a month and ${PLANS.growth.name} is $${PLANS.growth.price} a month. You can change plan at any time.` },
    { q: "What is a token?", a: `A token is the unit your plan counts work in. One article uses ${TOKEN_COST.article} tokens, a story ${TOKEN_COST.story} and a social post ${TOKEN_COST.social}. ${PLANS.starter.name} includes ${PLANS.starter.tokens} tokens a month, about ${Math.floor(PLANS.starter.tokens / TOKEN_COST.article)} articles.` },
    { q: "Can I cancel any time?", a: "Yes. Cancel from your account and keep everything the team already wrote." },
    { q: "Is there a free plan?", a: `Yes. The ${PLANS.free.name} plan lets you try the full experience with about ${Math.floor(PLANS.free.tokens / TOKEN_COST.article)} article a month, and no card is needed.` },
    { q: "Do you offer agency pricing?", a: `Not yet as a separate plan. If you manage several client sites, write to ${BRAND.supportEmail} and we will work something out with you.` },
  ],
  "Privacy & control": [
    { q: "Does anything publish without me?", a: "Only if you turn on auto-publish for a schedule. By default every outward action waits for your approval." },
    { q: "Who sees my data?", a: "Your data is kept per account and is used only to run your team." },
    { q: "Is there a record of what the team did?", a: "Yes. Every action and every decision is logged so you can review who approved what and when." },
    { q: "Can I disconnect my website?", a: "Yes. You can disconnect a site at any time and the team stops working on it." },
  ],
};

