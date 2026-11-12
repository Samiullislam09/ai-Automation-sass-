/** What a message says the sender is "from".
 *
 *  A workspace's `name` is often just the account's username ("heysamiul09"), so "This is Sami from heysamiul09"
 *  told the lead nothing about the business. The business is its WEBSITE, so that is the name used: the site's
 *  host without the "https://" and "www." ("wca-global.com"). A workspace with no website falls back to its name. */

/** "https://www.wca-global.com/about" -> "wca-global.com". null when there is nothing usable. */
export function hostOf(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

type TenantLike = { name?: string | null; website_url?: string | null } | null | undefined;

/** The name messages are signed with. */
export function brandName(tenant: TenantLike): string {
  return hostOf(tenant?.website_url) ?? (String(tenant?.name ?? "").trim() || "our team");
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Make an already written message say the brand: a draft written before this rule still reads "from heysamiul09".
 *  Replaces the workspace name with the brand, and drops a website line that would only repeat it. */
export function applyBrand(text: string, tenant: TenantLike): string {
  const brand = brandName(tenant);
  const name = String(tenant?.name ?? "").trim();
  let out = text;
  // Not inside a longer word or a domain ("heysamiul09x", "heysamiul09.com"), but a sentence-ending "heysamiul09." is the name.
  if (name && name.toLowerCase() !== brand.toLowerCase()) out = out.replace(new RegExp(`(?<![\\w.-])${esc(name)}(?![\\w-]|\\.[a-z0-9])`, "gi"), brand);
  const host = hostOf(tenant?.website_url);
  if (host && brand === host) {
    // "— Sami, wca-global.com" followed by "https://wca-global.com": the second line says nothing new.
    out = out.replace(new RegExp(`(^|\\n)(— [^\\n]*${esc(host)}[^\\n]*)\\nhttps?://(?:www\\.)?${esc(host)}/?[ \\t]*(?=\\n|$)`, "i"), "$1$2");
  }
  return out;
}
