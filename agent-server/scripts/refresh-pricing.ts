/** Re-read every tenant's price from its own website, and fix the Site Brain where it is wrong.
 *
 *    cd agent-server && npx tsx scripts/refresh-pricing.ts                 # DRY RUN, all tenants: prints, writes nothing
 *    cd agent-server && npx tsx scripts/refresh-pricing.ts <tenantId>      # dry run, one tenant
 *    cd agent-server && npx tsx scripts/refresh-pricing.ts <tenantId> --apply   # write a new Site Brain version
 *    cd agent-server && npx tsx scripts/refresh-pricing.ts --all --apply        # write for every tenant that needs it
 *
 *  Why a script and not just the analyst: the analyst fixes a tenant's price the next time it runs (after a
 *  crawl or "read my site again"), but a tenant whose Site Brain ALREADY holds an invented price keeps quoting
 *  it on WhatsApp until then. Found 2026-11-14 on a real workspace: the brain said "fixed price ₹100.00", a
 *  figure printed nowhere on the site, while the site's own /pricing page said "from $2,400 to $18,000".
 *
 *  What it does, per tenant (lib/pricing.ts does the reading):
 *    - the stored range is printed on the site          → keep it, nothing written
 *    - the owner typed the price (user_edited)           → never touched
 *    - a verified price is found on the site             → replaces the unsupported one
 *    - nothing on the site supports any price            → the unsupported range is removed, so the assistant
 *                                                          says it cannot share a price instead of quoting it
 *  A write is a NEW version of the Site Brain (saveProfile) — nothing is overwritten, and the previous version
 *  stays in the history. */
import "dotenv/config";
import { supabase } from "../src/supabase.js";
import { completeJson } from "../src/lib/llm.js";
import { detectPricing, rangeIsGrounded } from "../src/lib/pricing.js";
import { loadActiveProfile, saveProfile } from "../src/lib/siteProfile.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((a) => !a.startsWith("--"));

let q = supabase.from("tenants").select("id, name, website_url");
if (only) q = q.eq("id", only);
const { data: tenants, error } = await q.limit(200);
if (error) { console.error("could not list tenants:", error.message); process.exit(1); }
if (apply && !only && !args.includes("--all")) { console.error("Refusing to write for every tenant without --all. Pass a tenant id, or --all."); process.exit(1); }

console.log(apply ? "APPLY mode — new Site Brain versions will be written.\n" : "DRY RUN — nothing will be written. Add --apply to write.\n");

let changed = 0;
for (const t of tenants ?? []) {
  const label = `${t.website_url ?? t.name ?? t.id} (${t.id})`;
  const prev = await loadActiveProfile(t.id);
  if (!prev) { console.log(`- ${label}: no Site Brain yet — skipped`); continue; }
  if ((prev.profile.user_edited ?? []).includes("pricing" as any)) { console.log(`- ${label}: the owner typed the price — left alone`); continue; }

  const { data: rows } = await supabase.from("site_pages").select("url, title, content_text").eq("tenant_id", t.id).order("word_count", { ascending: false, nullsFirst: false }).limit(300);
  const pages = (rows ?? []).map((r: any) => ({ url: String(r.url), title: r.title as string | null, text: String(r.content_text ?? "") }));
  if (!pages.length) { console.log(`- ${label}: no crawled pages — skipped`); continue; }

  const current = prev.profile.pricing;
  const texts = pages.map((p) => p.text);
  if (current?.range && rangeIsGrounded(current.range, texts)) { console.log(`- ${label}: stored price "${current.range}" is printed on the site — kept`); continue; }

  const found = await detectPricing(pages, (prompt) => completeJson(prompt));
  const before = current ? JSON.stringify(current) : "none";

  let next: typeof current | null | undefined;
  let why = "";
  if (found) { next = found.pricing; why = `verified on ${found.sources.join(", ")}`; }
  else if (current?.range) { next = current.model ? { model: current.model, range: null, note: null } : null; why = "the stored range is not printed anywhere on the site; removed"; }
  else { console.log(`- ${label}: no price on the site and none stored — nothing to do`); continue; }

  console.log(`- ${label}\n    was:  ${before}\n    now:  ${next ? JSON.stringify(next) : "none (the assistant will say it cannot share a price)"}\n    why:  ${why}`);
  if (!apply) continue;

  const profile = { ...prev.profile, pricing: next ?? null } as typeof prev.profile;
  const sources = { ...(prev.profile.sources ?? {}) } as Record<string, string[]>;
  const confidence = { ...(prev.profile.confidence ?? {}) } as Record<string, string>;
  if (found) { sources.pricing = found.sources; confidence.pricing = found.pricing.range ? "medium" : "low"; }
  else { delete sources.pricing; if (!next) delete confidence.pricing; }
  (profile as any).sources = sources;
  (profile as any).confidence = confidence;
  const saved = await saveProfile(t.id, profile, { builtFrom: prev.built_from, createdBy: "system:price-verify" });
  console.log(`    written: Site Brain version ${saved.version}`);
  changed++;
}
console.log(`\n${apply ? `${changed} tenant(s) updated.` : "Dry run finished. Re-run with --apply to write the changes above."}`);
process.exit(0);
