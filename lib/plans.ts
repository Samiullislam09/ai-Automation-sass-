/** The plans and what a unit of work costs, in a plain module (NOT "use client") so server code — the sitemap, the structured data, the
 *  FAQ — can read them too. lib/store.tsx re-exports both, so every existing import keeps working. */
export const TOKEN_COST: Record<string, number> = { article: 10, story: 4, social: 1 };
export const PLANS: Record<string, { name: string; price: number; tokens: number; tagline: string }> = {
  free:    { name: "Free",    price: 0,  tokens: 10,  tagline: "1 article/month — try the full experience" },
  starter: { name: "Pro", price: 5,  tokens: 120, tagline: "~10 articles every month (stories & social posts coming soon)" },
  growth:  { name: "Max",     price: 15, tokens: 400, tagline: "Serious volume + priority writing model" },
};
