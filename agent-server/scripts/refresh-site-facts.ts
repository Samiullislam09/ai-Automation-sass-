/** Re-read every tenant's price AND contact details from its own website, and fix the Site Brain where they are
 *  missing or wrong.
 *
 *    cd agent-server && npx tsx scripts/refresh-site-facts.ts                       # DRY RUN, all tenants: prints, writes nothing
 *    cd agent-server && npx tsx scripts/refresh-site-facts.ts <tenantId>            # dry run, one tenant
 *    cd agent-server && npx tsx scripts/refresh-site-facts.ts <tenantId> --apply    # write a new Site Brain version
 *    cd agent-server && npx tsx scripts/refresh-site-facts.ts --all --apply         # write for every tenant that needs it
 *
 *  Why a script and not just the analyst: the analyst reads these the next time it runs (after a crawl or "read my
 *  site again"), but a tenant that ALREADY has a wrong price keeps quoting it on WhatsApp until then — found
 *  2026-11-14 on a real workspace: "fixed price ₹100.00", printed nowhere on the site, while /pricing said
 *  "from $2,400 to $18,000". And a tenant whose brain predates the contact-details field has none saved, so the
 *  assistant cannot answer "where is your office?".
 *
 *  Per tenant (lib/pricing.ts and lib/businessDetails.ts do the reading, and discard anything the site does not print):
 *    price    the stored range is printed on the site → kept · a verified price is found → replaces the unsupported one
 *             · nothing supports any price → the unsupported range is removed (the assistant then says it cannot share one)
 *    details  address / phone / WhatsApp / email / hours / licence the site prints are SAVED; a value already stored is
 *             never replaced by nothing
 *    owner    a field the owner typed (user_edited) is never touched
 *  A write is a NEW version of the Site Brain (saveProfile): nothing is overwritten and the old version stays in the history. */
import "dotenv/config";
import { supabase } from "../src/supabase.js";
import { completeJson } from "../src/lib/llm.js";
import { detectPricing, rangeIsGrounded } from "../src/lib/pricing.js";
import { detectBusinessDetails, emptyDetails, hasAnyDetail } from "../src/lib/businessDetails.js";
import { loadActiveProfile, saveProfile, type BusinessDetails } from "../src/lib/siteProfile.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((a) => !a.startsWith("--"));

let q = supabase.from("tenants").select("id, name, website_url");
if (only) q = q.eq("id", only);
const { data: tenants, error } = await q.limit(200);
if (error) { console.error("could not list tenants:", error.message); process.exit(1); }
if (apply && !only && !args.includes("--all")) { console.error("Refusing to write for every tenant without --all. Pass a tenant id, or --all."); process.exit(1); }

console.log(apply ? "APPLY mode — new Site Brain versions will be written.\n" : "DRY RUN — nothing will be written. Add --apply to write.\n");

const KEYS: (keyof BusinessDetails)[] = ["address", "phone", "whatsapp", "email", "hours", "registration"];
let changed = 0;

for (const t of tenants ?? []) {
  const label = `${t.website_url ?? t.name ?? t.id} (${t.id})`;
  const prev = await loadActiveProfile(t.id);
  if (!prev) { console.log(`- ${label}: no Site Brain yet — skipped`); continue; }

  const { data: rows } = await supabase.from("site_pages").select("url, title, content_text").eq("tenant_id", t.id).order("word_count", { ascending: false, nullsFirst: false }).limit(300);
  const pages = (rows ?? []).map((r: any) => ({ url: String(r.url), title: r.title as string | null, text: String(r.content_text ?? "") }));
  if (!pages.length) { console.log(`- ${label}: no crawled pages — skipped`); continue; }

  const edited = (prev.profile.user_edited ?? []) as string[];
  const profile = { ...prev.profile } as any;
  const sources = { ...(prev.profile.sources ?? {}) } as Record<string, string[]>;
  const confidence = { ...(prev.profile.confidence ?? {}) } as Record<string, string>;
  const report: string[] = [];

  // ── price ────────────────────────────────────────────────────────────────────────────
  if (edited.includes("pricing")) report.push("price: the owner typed it — left alone");
  else {
    const current = prev.profile.pricing;
    if (current?.range && rangeIsGrounded(current.range, pages.map((p) => p.text))) report.push(`price: "${current.range}" is printed on the site — kept`);
    else {
      const found = await detectPricing(pages, (prompt) => completeJson(prompt));
      if (found) {
        profile.pricing = found.pricing; sources.pricing = found.sources; confidence.pricing = found.pricing.range ? "medium" : "low";
        report.push(`price: ${current ? JSON.stringify(current) : "none"}  →  ${JSON.stringify(found.pricing)}  (verified on ${found.sources.join(", ")})`);
      } else if (current?.range) {
        profile.pricing = current.model ? { model: current.model, range: null, note: null } : null;
        delete sources.pricing; if (!profile.pricing) delete confidence.pricing;
        report.push(`price: ${JSON.stringify(current)}  →  removed (not printed anywhere on the site)`);
      } else report.push("price: none on the site and none stored");
    }
  }

  // ── contact details ──────────────────────────────────────────────────────────────────
  if (edited.includes("business_details")) report.push("details: the owner typed them — left alone");
  else {
    const found = await detectBusinessDetails(pages, t.website_url ?? null, (prompt) => completeJson(prompt));
    const existing: BusinessDetails = { ...emptyDetails(), ...(prev.profile.business_details ?? {}) };
    if (!found) report.push(hasAnyDetail(existing) ? "details: the site prints none now — stored ones kept" : "details: the site prints none and none are stored");
    else {
      const merged: BusinessDetails = { ...existing };
      const delta: string[] = [];
      for (const k of KEYS) {
        const v = found.details[k];
        if (v && v !== existing[k]) { merged[k] = v; delta.push(`${k}: ${existing[k] ?? "—"}  →  ${v}`); }
      }
      if (delta.length) {
        profile.business_details = merged; sources.business_details = found.sources; confidence.business_details = "medium";
        report.push("details:\n      " + delta.join("\n      "));
      } else report.push("details: already saved and unchanged");
    }
  }

  const wrote = JSON.stringify(profile.pricing) !== JSON.stringify(prev.profile.pricing) || JSON.stringify(profile.business_details) !== JSON.stringify(prev.profile.business_details);
  console.log(`- ${label}\n    ${report.join("\n    ")}`);
  if (!wrote) continue;
  if (!apply) continue;

  profile.sources = sources; profile.confidence = confidence;
  const saved = await saveProfile(t.id, profile, { builtFrom: prev.built_from, createdBy: "system:site-facts" });
  console.log(`    written: Site Brain version ${saved.version}`);
  changed++;
}
console.log(`\n${apply ? `${changed} tenant(s) updated.` : "Dry run finished. Re-run with --apply to write the changes above."}`);
process.exit(0);
