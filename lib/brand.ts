/** Single source of truth for the brand. Everything on the home page (nav, hero, footer, FAQ, legal pages, metadata, sitemap, social image)
 *  reads from this file — change it here only.
 *
 *  The product is MenCra, at mencra.com (decided 2026-11-16; it replaces the earlier working names GrowthTeam AI and MrLxwa). */
export const BRAND = {
  name: "MenCra",
  short: "MenCra",
  tagline: "Your AI marketing team for small business",
  domain: "mencra.com",
  /** Create this inbox (or forward it to yours) BEFORE launch: it is printed in the footer, the legal pages and the agency offer. */
  supportEmail: "support@mencra.com",
} as const;

export const SITE_URL = `https://${BRAND.domain}`;
