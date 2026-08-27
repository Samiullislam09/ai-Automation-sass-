import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { supabase } from "../supabase.js";
import { completeJson } from "../lib/llm.js";
import { loadActiveProfile } from "../lib/siteProfile.js";
import { buildIcp, describeIcp } from "../lib/leads/icp.js";
import { discover, describeSources, fetchPageForResearch } from "../lib/leads/sources.js";
import { buildFindLeadsOutput, runPipeline, type LeadRecord, type PipelineDeps } from "../lib/leads/pipeline.js";
import { POLICY, RunLedger, assertDraftOnly, domainOf, stripWww, type SenderIdentity, type SuppressionEntry } from "../lib/leads/compliance.js";

/** Mr. Lead — finds businesses that match the tenant's ICP and drafts the first message.
 *
 *  Rebuild plan §17.4 (the seven-step flow) and §20.3 (the node-by-node anatomy). The pipeline
 *  itself lives in lib/leads/ so each node is testable on its own; this file is the part that
 *  talks to the outside world:
 *
 *      Site Brain + what the user typed  ->  ICP        (lib/leads/icp.ts)
 *      ICP                               ->  candidates (lib/leads/sources.ts)
 *      candidates                        ->  leads      (lib/leads/pipeline.ts)
 *      leads                             ->  the `leads` table + the live workspace
 *
 *  THREE THINGS THIS AGENT WILL NOT DO
 *
 *   1. It will not guess an ICP. No Site Brain and no usable query means one question back, not
 *      a search for something plausible (icp.ts returns that as a typed result, not a throw).
 *   2. It will not write to somebody whose address it had to work out. Addresses come from the
 *      page, by regex, screened by compliance.emailIsBusinessContact.
 *   3. It will not send. There is no transport in this agent or anywhere below it, the drafts
 *      are frozen objects permanently marked `status: "draft"`, and `assertDraftOnly` runs on
 *      every record before it is written down. Sending is a separate, human-approved action
 *      that does not exist yet.
 *
 *  Output shape is exactly the manifest's `{ leads }` (brain/manifests.ts, `leads.find_leads`),
 *  with extra context fields alongside for the chat card. The shape is asserted against the
 *  manifest in lib/leads/pipeline.test.ts, so it cannot drift without a test failing.
 */
export class LeadsAgent extends Agent {
  type = "leads";

  async run(job: Job<AgentJobData>, ctx: AgentContext) {
    const { tenantId } = job.data;
    const query = typeof job.data.query === "string" ? job.data.query : typeof job.data.topic === "string" ? job.data.topic : null;
    const count = Number(job.data.count) || null;

    ctx.onProgress({ phase: "icp", label: "Working out who to look for..." });
    ctx.progress(0.05, "Working out who to look for");

    const [{ data: tenant }, profileRow] = await Promise.all([
      supabase.from("tenants").select("name, website_url, icp_profile").eq("id", tenantId).single(),
      loadActiveProfile(tenantId),
    ]);

    // ── 1 · the ICP. No guessing: a missing one is a question, not a search ────────────────
    const icpResult = buildIcp({ profile: profileRow?.profile ?? null, query, count });
    if (!icpResult.ok) {
      // Returned rather than thrown: nothing here is retryable, and the fix is a sentence from
      // the user. Same shape the analyst uses when there is no crawl to read.
      return {
        leads: [],
        found: 0,
        needs: icpResult.missing,
        question: icpResult.question,
        sent: false as const,
        note: "No search was run — I do not know who to look for.",
      };
    }
    const { icp, warnings } = icpResult;
    ctx.log(`ICP: ${describeIcp(icp)} (${icp.evidence.map((e) => `${e.field}<-${e.from}`).join(", ")})`);

    // ── 2 · who we are, for the identification line every draft carries ────────────────────
    const identity = senderIdentity(tenant);

    // ── 3 · what we already know, so nobody is contacted twice or after saying no ──────────
    const { suppression, knownDomains, knownNames } = await loadHistory(tenantId);

    // ── 4 · discovery ─────────────────────────────────────────────────────────────────────
    ctx.onProgress({ phase: "discover", label: `Looking for ${icp.industry}${icp.geo ? ` in ${icp.geo}` : ""}...` });
    ctx.progress(0.15, `Looking for ${icp.industry}${icp.geo ? ` in ${icp.geo}` : ""}`);

    const { candidates, reports } = await discover(icp, icp.count);
    const sources = describeSources(reports);
    ctx.log(`discovery: ${sources.join(" | ")}`);

    // A business already on the list by name is not a new lead, even when the map gives it a
    // different (or no) website this time.
    const fresh = candidates.filter((c) => !knownNames.has(c.name.trim().toLowerCase()));

    if (!fresh.length) {
      ctx.progress(1, "Nothing found");
      return {
        leads: [],
        found: 0,
        considered: candidates.length,
        sources,
        icp: describeIcp(icp),
        warnings,
        sent: false as const,
        note:
          candidates.length > 0
            ? "Everything the search found is already in your leads list."
            : `Nothing found for "${icp.industry}"${icp.geo ? ` in ${icp.geo}` : ""} — try a broader category or a different area.`,
      };
    }

    ctx.onProgress({ phase: "research", label: `${fresh.length} found — reading their websites...`, candidates: fresh.length });
    ctx.progress(0.25, `${fresh.length} found — reading their websites`);

    // ── 5 · the pipeline ──────────────────────────────────────────────────────────────────
    const deps: PipelineDeps = {
      fetchPage: (url) => fetchPageForResearch(url),
      llmJson: (prompt) => completeJson(prompt),
      now: () => new Date(),
    };

    const found: LeadRecord[] = [];

    const result = await runPipeline({
      candidates: fresh,
      icp,
      identity,
      deps,
      knownDomains,
      suppression,
      // The ceiling is the smaller of what was asked for and what policy allows — a plan limit
      // could lower this further, never raise it (compliance.RunLedger clamps).
      ledger: new RunLedger({ maxPerRun: Math.min(icp.count, POLICY.MAX_PER_RUN) }),
      onLead: (lead) => {
        found.push(lead);
        // One event per user-meaningful thing (base.ts): the Leads list builds itself in front
        // of the user instead of appearing all at once at the end.
        ctx.data("lead", {
          name: lead.name,
          website: lead.website,
          score: lead.score,
          band: lead.band,
          why: lead.why,
          observation: lead.observation,
          channel: lead.channel,
          draft: lead.draft,
          status: lead.status,
          sent: false,
        });
        ctx.progress(Math.min(0.95, 0.3 + found.length / Math.max(1, icp.count) * 0.65), `${found.length} leads written`);
      },
      onDrop: (d) => ctx.log(`dropped ${d.name} at ${d.stage}: ${d.reason}`),
      onProgress: (done, total, label) => ctx.onProgress({ phase: "pipeline", label, done, total }),
    });

    // ── 6 · durable ───────────────────────────────────────────────────────────────────────
    ctx.onProgress({ phase: "saving", label: `Saving ${result.leads.length} leads...` });
    const saved = await saveLeads(tenantId, result.leads);

    ctx.progress(1, `${result.leads.length} leads, ${result.leads.filter((l) => l.band === "strong").length} strong`);

    const output = buildFindLeadsOutput({
      result,
      icpLabel: describeIcp(icp),
      sources,
      warnings: [...warnings, ...(saved.warning ? [saved.warning] : [])],
      considered: candidates.length,
    });

    return { ...output, saved: saved.count };
  }
}

// ── who is writing ──────────────────────────────────────────────────────────────────────────

/** The identification line every draft carries (compliance.buildSignature).
 *
 *  `icp_profile` is the onboarding jsonb blob; a tenant that filled in a contact name and a
 *  reply address gets both in the signature. Neither is invented: with no name on file the
 *  signature is the business alone, which is still a real identification. */
function senderIdentity(tenant: { name?: string | null; website_url?: string | null; icp_profile?: any } | null): SenderIdentity {
  const profile = (tenant?.icp_profile ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s || null;
  };
  return {
    personName: str(profile.contact_name ?? profile.owner_name ?? profile.sender_name),
    businessName: str(tenant?.name) ?? "our team",
    website: str(tenant?.website_url),
    replyTo: str(profile.reply_to ?? profile.contact_email ?? profile.email),
  };
}

// ── what we already know ────────────────────────────────────────────────────────────────────

/** The do-not-contact list and the leads we already have.
 *
 *  There is no separate suppression table yet, and there does not need to be one: a lead the
 *  user marked `unsubscribed`, `do_not_contact`, `bounced` or `skipped` has already told us the
 *  answer, and that is exactly what those stages mean. When a real suppression list arrives
 *  (imports from a customer's own CRM), it is another `select` merged into this array. */
async function loadHistory(tenantId: string): Promise<{ suppression: SuppressionEntry[]; knownDomains: Set<string>; knownNames: Set<string> }> {
  const suppression: SuppressionEntry[] = [];
  const knownDomains = new Set<string>();
  const knownNames = new Set<string>();

  const { data, error } = await supabase
    .from("leads")
    .select("company, email, phone, stage")
    .eq("tenant_id", tenantId)
    .limit(2000);

  if (error) {
    // Failing closed here would mean "cannot read the list, so contact nobody", which is the
    // safe direction but also a dead product every time Supabase blinks. Failing open would
    // mean writing to somebody who unsubscribed. So: fail LOUD and stop — a compliance list we
    // could not read is not a compliance list.
    throw new Error(`Could not read your existing leads (${error.message}) — refusing to run rather than risk writing to someone who asked us not to.`);
  }

  for (const row of data ?? []) {
    const company = String((row as any).company ?? "").trim();
    const email = String((row as any).email ?? "").trim();
    const phone = String((row as any).phone ?? "").trim();
    const stage = String((row as any).stage ?? "").toLowerCase();
    const domain = email.includes("@") ? stripWww(email.split("@")[1]) : null;

    if (company) knownNames.add(company.toLowerCase());
    if (domain) knownDomains.add(domain);

    if (["unsubscribed", "do_not_contact", "bounced", "skipped"].includes(stage)) {
      suppression.push({ domain, email: email || null, phone: phone || null });
    }
  }

  return { suppression, knownDomains, knownNames };
}

// ── writing them down ───────────────────────────────────────────────────────────────────────

/** Has this database's `leads` table got the outreach columns? Probed once per process.
 *
 *  `leads` exists since migration 001 with the columns a CRM row needs (name, company, email,
 *  phone, source, icp_score, reason, stage) but not the ones an outreach draft needs. Rather
 *  than fail, or invent a migration nobody asked for, the insert tries the full row once and
 *  remembers the answer. The moment these columns are added the drafts persist with no code
 *  change:
 *
 *      alter table leads add column if not exists website     text;
 *      alter table leads add column if not exists domain      text;
 *      alter table leads add column if not exists draft       text;
 *      alter table leads add column if not exists channel     text;
 *      alter table leads add column if not exists observation text;
 *      alter table leads add column if not exists evidence    jsonb not null default '{}'::jsonb;
 *
 *  null = not probed yet, true/false = the answer. */
let leadsHasOutreachColumns: boolean | null = null;

/** Postgres "column does not exist" (42703) and PostgREST's schema-cache version of the same. */
function isUnknownColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist/i.test(String(error.message ?? ""));
}

async function saveLeads(tenantId: string, leads: LeadRecord[]): Promise<{ count: number; warning: string | null }> {
  if (!leads.length) return { count: 0, warning: null };

  // Belt and braces: the pipeline already asserts this, and it is asserted again here because
  // this is the last line of code before the data stops being ours.
  for (const lead of leads) assertDraftOnly(lead);

  const core = leads.map((lead) => ({
    tenant_id: tenantId,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    icp_score: lead.score,
    reason: lead.why,
    // NOT "new": a row here has a message written and nothing sent. `draft` says exactly that,
    // and the Leads page's Approve button is what moves it on.
    stage: "draft",
  }));

  const rich = leads.map((lead, i) => ({
    ...core[i],
    website: lead.website,
    domain: lead.domain,
    draft: lead.draft,
    channel: lead.channel,
    observation: lead.observation,
    evidence: {
      quote: lead.observation_quote,
      url: lead.observation_url,
      band: lead.band,
      reasons: lead.reasons,
      attribution: lead.attribution,
      region_note: lead.region_note,
      legal_basis: lead.legal_basis,
      sent: false,
    },
  }));

  if (leadsHasOutreachColumns !== false) {
    const { error } = await supabase.from("leads").insert(rich);
    if (!error) {
      leadsHasOutreachColumns = true;
      return { count: leads.length, warning: null };
    }
    if (!isUnknownColumn(error)) throw new Error(`Could not save the leads: ${error.message}`);
    leadsHasOutreachColumns = false;
  }

  const { error } = await supabase.from("leads").insert(core);
  if (error) throw new Error(`Could not save the leads: ${error.message}`);

  return {
    count: leads.length,
    warning:
      "Your `leads` table has no column for the message, so the drafts are in this job's result rather than on the lead rows. " +
      "Adding website/domain/draft/channel/observation/evidence columns to `leads` stores them properly (see agents/leads.ts).",
  };
}

/** Re-exported for the tests, which check the domain helper is the one compliance uses. */
export { domainOf };
