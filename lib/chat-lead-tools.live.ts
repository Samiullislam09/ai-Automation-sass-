/** LIVE, READ-ONLY: runs the four lead lookups against the real database for one tenant and prints what the assistant would be handed.
 *    npx tsx lib/chat-lead-tools.live.ts <tenantId> [who]
 *  Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (agent-server/.env). Nothing is written or sent. */
import { readFileSync } from "node:fs";
for (const f of ["agent-server/.env", ".env.local"]) {
  try { for (const l of readFileSync(f, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); } } catch { /* none */ }
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { lookupLeadStats, lookupLeadConversation, lookupKeywords } = await import("./chat-lead-tools");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const tenant = process.argv[2];
  const who = process.argv[3] ?? "sainiul";
  const show = (t: string, r: any) => console.log(`\n=== ${t} ===\n` + JSON.stringify(r.data ?? r.note, null, 1).slice(0, 2600));
  show("lookup_lead_stats", await lookupLeadStats(sb as any, tenant));
  show(`lookup_lead_conversation("${who}")`, await lookupLeadConversation(sb as any, tenant, who));
  show("lookup_keywords", await lookupKeywords(sb as any, tenant));
  const { lookupAutopilot } = await import("./chat-lead-tools");
  show("lookup_autopilot (WhatsApp/web parts are null when no agent server is reachable from here)", await lookupAutopilot(sb as any, tenant));
}
main().catch((e) => { console.error(e); process.exit(1); });
