import type { Job } from "pg-boss";
import { Agent, type AgentContext, type AgentJobData } from "./base.js";
import { supabase } from "../supabase.js";
import { completeJson } from "../lib/llm.js";
import { loadActiveProfile, buyerProfileReady } from "../lib/siteProfile.js";
import { buildIcp, buildIcpFromBuyerSegment, describeIcp } from "../lib/leads/icp.js";
import { getLeadSettings, patchLeadSettings, leadsDailyStatus } from "../lib/outreach/settings.js";
import { discover, describeSources, fetchPageForResearch } from "../lib/leads/sources.js";
import { buildFindLeadsOutput, runPipeline, type LeadRecord, type PipelineDeps } from "../lib/leads/pipeline.js";
import { POLICY, RunLedger, assertDraftOnly, domainOf, nameKey, phoneKey, stripWww, type SenderIdentity, type SuppressionEntry } from "../lib/leads/compliance.js";

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
    const city = typeof job.data.city === "string" && job.data.city.trim() ? job.data.city.trim() : null;

    ctx.onProgress({ phase: "icp", label: "Working out who to look for..." });
    ctx.progress(0.05, "Working out who to look for");

    const [{ data: tenant }, profileRow] = await Promise.all([
      supabase.from("tenants").select("name, website_url, icp_profile").eq("id", tenantId).single(),
      loadActiveProfile(tenantId),
    ]);

    // ── 0 · the buyer-profile gate (high-quality-leads plan, Phase 1) ───────────────────────
    // An AUTO run (no explicit query) must not search until the client has confirmed WHO buys
    // from them — otherwise the ICP is built from "what the client is" and we return competitors.
    // An explicit query is the user telling us exactly who to look for, so it still runs: the gate
    // is for the guess case only, consistent with icp.ts ("no guessing"). Phase 2 then builds the
    // ICP from the confirmed buyer segments.
    if (!query && !buyerProfileReady(profileRow?.profile ?? null)) {
      const hasDraft = !!profileRow?.profile?.buyer_profile;
      return {
        leads: [],
        found: 0,
        needs: ["buyer_profile"],
        question: hasDraft
          ? "Your buyer profile isn't confirmed yet. Open Leads → Buyer profile, check the segments I drafted, and press Confirm — then I'll go find buyers, not competitors."
          : "I don't have a buyer profile for you yet. Open Leads → Buyer profile, press “Draft from my site”, review the buyer vs competitor segments, and Confirm — then I'll find real buyers.",
        sent: false as const,
        note: "No search was run — the buyer profile needs confirming first.",
      };
    }

    // ── 1 · the ICP. No guessing: a missing one is a question, not a search ────────────────
    // Two sources, and explicit always wins: a user query is the user telling us exactly who to
    // look for (deterministic parser, unchanged). Otherwise an Auto run builds the ICP from ONE
    // confirmed BUYER segment — the Phase-2 fix that makes discovery hunt buyers, not peers —
    // picking the next segment round-robin so scheduled runs cover them all over time.
    const settings = await getLeadSettings(tenantId);
    let sourceSegment: string | null = null;
    let icpResult: ReturnType<typeof buildIcp>;
    if (query) {
      icpResult = buildIcp({ profile: profileRow?.profile ?? null, query, count });
    } else {
      const bp = profileRow!.profile.buyer_profile!; // the gate above guarantees this is confirmed
      const segs = bp.buyer_segments;
      const idx = segs.length ? settings.segment_cursor % segs.length : 0;
      const seg = segs[idx];
      sourceSegment = seg?.name ?? null;
      // Advance the cursor whether or not this run finds anything, so the next run moves on.
      await patchLeadSettings(tenantId, { segment_cursor: settings.segment_cursor + 1 });
      icpResult = buildIcpFromBuyerSegment({ segment: seg, geoScope: bp.geo_scope, profile: profileRow!.profile, count, geoOverride: city });
      ctx.log(`buyer segment ${idx + 1}/${segs.length}: ${sourceSegment}`);
    }
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

    // The buyer-vs-competitor gate (Phase 3) runs whenever the tenant has a CONFIRMED buyer
    // profile — on Auto runs always, and on explicit-query runs too, so a peer is screened out even
    // when the user typed the search. With no confirmed profile there are no competitor cues to
    // judge against, so the gate stays off and discovery behaves exactly as before.
    const fitProfile = profileRow?.profile ?? null;
    const fitGate = buyerProfileReady(fitProfile)
      ? {
          offer: fitProfile!.buyer_profile!.offer,
          buyerSegments: fitProfile!.buyer_profile!.buyer_segments.map((s) => s.name),
          competitorSegments: fitProfile!.buyer_profile!.competitor_segments.map((s) => ({ name: s.name, cues: s.cues })),
          negativeDomains: settings.negative_domains,
          buyingSignals: fitProfile!.buyer_profile!.buying_signals.map((s) => ({ name: s.name, look_for: s.look_for, weight: s.weight })),
        }
      : undefined;

    // ── the daily LEAD cap (Phase 7) ───────────────────────────────────────────────────────
    // Caps how many leads LAND today, not how often the agent runs — that is what spends the
    // Serper free quota and what a plan actually sells. Trim this run to what's left; refuse
    // honestly when the day is used up. null = no cap (top plan / override).
    const dc = await leadsDailyStatus(tenantId);
    if (dc.remaining !== null && dc.remaining <= 0) {
      ctx.progress(1, "Daily lead limit reached");
      return {
        leads: [],
        found: 0,
        capped: true,
        daily_cap: dc.cap,
        sent: false as const,
        note: `Aaj ka leads limit (${dc.cap}) pura ho gaya — kal naye leads aa sakte hain, ya plan upgrade karo. Aaj ${dc.used} leads ban chuke hain.`,
      };
    }
    if (dc.remaining !== null && icp.count > dc.remaining) {
      ctx.log(`daily cap: ${dc.used}/${dc.cap} used today — trimming this run to ${dc.remaining}`);
      icp.count = dc.remaining;
    }

    // ── 2 · who we are, for the identification line every draft carries ────────────────────
    const identity = senderIdentity(tenant);

    // ── 3 · what we already know, so nobody is contacted twice or after saying no ──────────
    const { suppression, knownDomains, knownPhones, knownNames } = await loadHistory(tenantId);

    // ── 4 · discovery ─────────────────────────────────────────────────────────────────────
    ctx.onProgress({ phase: "discover", label: `Looking for ${icp.industry}${icp.geo ? ` in ${icp.geo}` : ""}...` });
    ctx.progress(0.15, `Looking for ${icp.industry}${icp.geo ? ` in ${icp.geo}` : ""}`);

    const { candidates, reports } = await discover(icp, icp.count);
    const sources = describeSources(reports);
    ctx.log(`discovery: ${sources.join(" | ")}`);

    // A business already on the list is not a new lead, even when the map gives it a different
    // (or no) website this time. Match on normalised name OR known phone — the cheap pass before
    // the pipeline spends a request; the pipeline repeats these checks per-candidate as well.
    const fresh = candidates.filter((c) => {
      const n = nameKey(c.name);
      const p = phoneKey(c.phone);
      if (n && knownNames.has(n)) return false;
      if (p && knownPhones.has(p)) return false;
      return true;
    });

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
      knownPhones,
      knownNames,
      fitGate,
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
    const saved = await saveLeads(tenantId, result.leads, city, {
      source_segment: sourceSegment,
      source_query: icp.searchTerms[0] ?? null,
    });

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
async function loadHistory(
  tenantId: string,
): Promise<{ suppression: SuppressionEntry[]; knownDomains: Set<string>; knownPhones: Set<string>; knownNames: Set<string> }> {
  const suppression: SuppressionEntry[] = [];
  const knownDomains = new Set<string>();
  const knownPhones = new Set<string>();
  const knownNames = new Set<string>();

  // Read the identity columns proper: a lead's domain is on the `domain`/`website` columns, not
  // only hidden inside an email. Try those first; on a database old enough to lack them (pre-028)
  // fall back to the columns that have always existed. Email domain stays as a third signal.
  let data: any[] | null = null;
  const rich = await supabase
    .from("leads")
    .select("company, email, phone, website, domain, stage")
    .eq("tenant_id", tenantId)
    .limit(5000);

  if (rich.error && isUnknownColumn(rich.error)) {
    const core = await supabase.from("leads").select("company, email, phone, stage").eq("tenant_id", tenantId).limit(5000);
    if (core.error) {
      throw new Error(`Could not read your existing leads (${core.error.message}) — refusing to run rather than risk a duplicate or writing to someone who asked us not to.`);
    }
    data = core.data ?? [];
  } else if (rich.error) {
    // Failing closed here would mean "cannot read the list, so contact nobody", which is the
    // safe direction but also a dead product every time Supabase blinks. Failing open would
    // mean a duplicate, or writing to somebody who unsubscribed. So: fail LOUD and stop — a
    // dedup/compliance list we could not read is not a list.
    throw new Error(`Could not read your existing leads (${rich.error.message}) — refusing to run rather than risk a duplicate or writing to someone who asked us not to.`);
  } else {
    data = rich.data ?? [];
  }

  for (const row of data ?? []) {
    const company = String((row as any).company ?? "").trim();
    const email = String((row as any).email ?? "").trim();
    const phone = String((row as any).phone ?? "").trim();
    const website = String((row as any).website ?? "").trim();
    const domainCol = String((row as any).domain ?? "").trim();
    const stage = String((row as any).stage ?? "").toLowerCase();

    // Prefer the stored domain, then the website host, then the email's domain — all three
    // normalised the same way so they land in one set the pipeline can test with stripWww.
    const emailDomain = email.includes("@") ? stripWww(email.split("@")[1]) : null;
    const domain = (domainCol ? stripWww(domainCol) : null) || (website ? domainOf(website) : null) || emailDomain;
    const pKey = phoneKey(phone);
    const nKey = nameKey(company);

    if (domain) knownDomains.add(domain);
    if (pKey) knownPhones.add(pKey);
    if (nKey) knownNames.add(nKey);

    // Old names kept alongside the 028 vocabulary on purpose: suppression is the one list where
    // recognising too much is free and recognising too little messages someone who said stop.
    if (["unsubscribed", "do_not_contact", "bounced", "skipped", "opted_out", "rejected", "invalid", "lost"].includes(stage)) {
      suppression.push({ domain, email: email || null, phone: phone || null });
    }
  }

  return { suppression, knownDomains, knownPhones, knownNames };
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

/** A unique-constraint violation — the duplicate guard in migration 029 firing. Postgres 23505,
 *  which PostgREST passes through on its REST errors too. Not an error we want to raise: it means
 *  the row is already there, which for us is success, not failure. */
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key value violates unique/i.test(String(error.message ?? ""));
}

/** Insert rows, surviving duplicates. A plain batch insert is atomic: one row that races a
 *  concurrent run and trips the unique index would roll back the whole batch and lose every good
 *  lead with it. So on a unique violation we drop to one-at-a-time and skip only the rows that are
 *  already there — the race-loser, not the whole run. Returns how many actually landed. */
async function insertSurvivingDuplicates(rows: Record<string, unknown>[]): Promise<{ saved: number; error: { code?: string; message?: string } | null }> {
  if (!rows.length) return { saved: 0, error: null };
  const { error } = await supabase.from("leads").insert(rows);
  if (!error) return { saved: rows.length, error: null };
  if (!isUniqueViolation(error)) return { saved: 0, error };

  // The batch hit a duplicate somewhere. Re-insert one row at a time; a 23505 means "already
  // saved" and is counted as a (silent) success, anything else is a real failure.
  let saved = 0;
  for (const row of rows) {
    const res = await supabase.from("leads").insert(row);
    if (!res.error) saved += 1;
    else if (!isUniqueViolation(res.error)) return { saved, error: res.error };
  }
  return { saved, error: null };
}

async function saveLeads(
  tenantId: string,
  leads: LeadRecord[],
  city: string | null = null,
  meta: { source_segment?: string | null; source_query?: string | null } = {},
): Promise<{ count: number; warning: string | null }> {
  if (!leads.length) return { count: 0, warning: null };

  // Belt and braces: the pipeline already asserts this, and it is asserted again here because
  // this is the last line of code before the data stops being ours.
  for (const lead of leads) assertDraftOnly(lead);

  // In-batch dedupe. The pipeline already drops repeats within a run, but this is the final gate
  // before the write, so it earns a second pass: keep the first time we see a domain, a phone, or
  // a normalised name, drop the rest. Cheap, and it means a bug upstream can never write a dup.
  const seenDomains = new Set<string>();
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  leads = leads.filter((lead) => {
    const d = lead.domain ? stripWww(lead.domain) : domainOf(lead.website) ?? null;
    const p = phoneKey(lead.phone);
    const n = nameKey(lead.company || lead.name);
    if ((d && seenDomains.has(d)) || (p && seenPhones.has(p)) || (n && seenNames.has(n))) return false;
    if (d) seenDomains.add(d);
    if (p) seenPhones.add(p);
    if (n) seenNames.add(n);
    return true;
  });

  const core = leads.map((lead) => ({
    tenant_id: tenantId,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    icp_score: lead.score,
    reason: lead.why,
    // "approved", not "pending_approval" (owner decision 2026-10-01): the gate is inverted —
    // every discovered lead lands ready to message, and the human REJECTS the ones they don't
    // want instead of approving the ones they do. Still compliant: nothing anywhere auto-sends
    // on "approved" — sending remains a human action from the WhatsApp page, and the draft
    // stays a draft (assertDraftOnly above).
    stage: "approved",
  }));

  const rich = leads.map((lead, i) => ({
    ...core[i],
    // Only on the rich shape: the column exists from migration 028 onward, same as the rest.
    approved_at: new Date().toISOString(),
    // The city the user asked for in the Generate modal, stamped on every lead from this run so
    // the CRM's City column and city filter have a value even though Serper returns only a full
    // address. Null for runs with no city (Auto mode / chat).
    city,
    website: lead.website,
    domain: lead.domain,
    draft: lead.draft,
    channel: lead.channel,
    observation: lead.observation,
    // Which confirmed buyer segment + query produced this lead (Phase 2), and the score detail so
    // "68/100" is explainable in the drawer (Phase 4). All nullable — migration 030 adds them, and
    // the core-insert fallback below covers a database where 030 has not run yet.
    source_segment: meta.source_segment ?? null,
    source_query: meta.source_query ?? null,
    classification: lead.classification ?? null,
    score_breakdown: { score: lead.score, band: lead.band, components: lead.reasons },
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
    const { saved, error } = await insertSurvivingDuplicates(rich);
    if (!error) {
      leadsHasOutreachColumns = true;
      return { count: saved, warning: null };
    }
    if (!isUnknownColumn(error)) throw new Error(`Could not save the leads: ${error.message}`);
    leadsHasOutreachColumns = false;
  }

  const { saved, error } = await insertSurvivingDuplicates(core);
  if (error) throw new Error(`Could not save the leads: ${error.message}`);

  return {
    count: saved,
    warning:
      "Your `leads` table has no column for the message, so the drafts are in this job's result rather than on the lead rows. " +
      "Adding website/domain/draft/channel/observation/evidence columns to `leads` stores them properly (see agents/leads.ts).",
  };
}

/** Re-exported for the tests, which check the domain helper is the one compliance uses. */
export { domainOf };
