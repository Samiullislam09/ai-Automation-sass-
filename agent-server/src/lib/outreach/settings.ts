/** Per-tenant lead-generation knobs — the one place their defaults and meaning live.
 *
 *  Backed by the `agent_settings` table (migration 028): primary key (tenant_id, agent), a
 *  `settings` jsonb bag, and an `enabled` flag. Everything lead gen needs to remember between runs
 *  that is NOT a lead row lives here, so a new knob is a code change, not a migration:
 *
 *    segment_cursor   round-robin pointer so scheduled Auto runs cover all buyer segments over
 *                     time instead of hammering the first one (Phase 2).
 *    negative_domains domains a human rejected as competitor/irrelevant — never surfaced again
 *                     (Phase 6 feedback loop). Suppression by stage still applies on top.
 *    negative_cues    name/website cue words learned from rejects, shown to the client as
 *                     candidate competitor cues (we never silently edit the confirmed profile).
 *    daily_cap        max NEW leads per day for this tenant; null = fall back to the plan/default
 *                     (Phase 7). Enforced server-side, not just in the UI.
 *
 *  Reads fall back to defaults when the row (or the table) is missing, so lead gen never dies
 *  because a tenant has no settings row yet. Writes upsert. All on the service client. */

import { supabase } from "../../supabase.js";
import { leadsPerDayCap } from "../../config/caps.js";

export type LeadSettings = {
  segment_cursor: number;
  negative_domains: string[];
  negative_cues: string[];
  daily_cap: number | null;
};

export const DEFAULT_LEAD_SETTINGS: LeadSettings = {
  segment_cursor: 0,
  negative_domains: [],
  negative_cues: [],
  daily_cap: null,
};

/** Read a tenant's lead settings, merged onto the defaults. Never throws — a missing table or row
 *  yields the defaults (lead gen must survive an un-migrated database). */
export async function getLeadSettings(tenantId: string): Promise<LeadSettings> {
  try {
    const { data, error } = await supabase
      .from("agent_settings")
      .select("settings")
      .eq("tenant_id", tenantId)
      .eq("agent", "leads")
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_LEAD_SETTINGS };
    return mergeSettings(data.settings);
  } catch {
    return { ...DEFAULT_LEAD_SETTINGS };
  }
}

/** Merge a patch into a tenant's lead settings and persist (upsert). Returns the new settings.
 *  Read-modify-write: fine for the single-worker cadence lead gen runs at; the round-robin cursor
 *  being off by one under a true race is harmless (a segment covered twice, never skipped). */
export async function patchLeadSettings(tenantId: string, patch: Partial<LeadSettings>): Promise<LeadSettings> {
  const current = await getLeadSettings(tenantId);
  const next: LeadSettings = { ...current, ...patch };
  try {
    await supabase
      .from("agent_settings")
      .upsert(
        { tenant_id: tenantId, agent: "leads", settings: next, updated_at: new Date().toISOString() },
        { onConflict: "tenant_id,agent" },
      );
  } catch (e) {
    console.error("[lead-settings] write failed:", (e as Error).message);
  }
  return next;
}

/** Add a domain to the tenant's negative list (idempotent, lower-cased). */
export async function addNegativeDomain(tenantId: string, domain: string): Promise<void> {
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!d) return;
  const s = await getLeadSettings(tenantId);
  if (s.negative_domains.includes(d)) return;
  await patchLeadSettings(tenantId, { negative_domains: [...s.negative_domains, d].slice(-2000) });
}

/** How many NEW leads this tenant may still generate today (Phase 7). Counts rows created in the
 *  `leads` table since local midnight against the lead/day cap. `cap: null` ⇒ no limit; `remaining`
 *  is then null too. Never throws — on any error it reports "no cap", because a count hiccup must
 *  not block a paying run. */
export async function leadsDailyStatus(tenantId: string): Promise<{ cap: number | null; used: number; remaining: number | null }> {
  const settings = await getLeadSettings(tenantId);
  let plan = "free";
  let overrides: Record<string, unknown> = {};
  try {
    const { data } = await supabase.from("tenants").select("plan, daily_cap_overrides").eq("id", tenantId).single();
    plan = (data as any)?.plan ?? "free";
    overrides = ((data as any)?.daily_cap_overrides as Record<string, unknown>) ?? {};
  } catch {
    // no plan row (pre-009) → fall through to the plan default via leadsPerDayCap
  }

  const cap = leadsPerDayCap(plan, overrides, settings.daily_cap);
  if (cap === null) return { cap: null, used: 0, remaining: null };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let used = 0;
  try {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", startOfDay.toISOString());
    used = count ?? 0;
  } catch {
    return { cap, used: 0, remaining: cap }; // count failed → do not block
  }
  return { cap, used, remaining: Math.max(0, cap - used) };
}

/** Is WhatsApp auto-reply ON for this tenant? Stored in agent_settings(agent='whatsapp').
 *  When ON, Mr Lxwa drafts AND sends a reply the moment a message comes in (session.ts). */
export async function getWhatsappAutoReply(tenantId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from("agent_settings").select("settings").eq("tenant_id", tenantId).eq("agent", "whatsapp").maybeSingle();
    const s = (data?.settings && typeof data.settings === "object" ? data.settings : {}) as Record<string, unknown>;
    return s.auto_reply === true;
  } catch {
    return false;
  }
}

export async function setWhatsappAutoReply(tenantId: string, on: boolean): Promise<void> {
  try {
    const { data } = await supabase.from("agent_settings").select("settings").eq("tenant_id", tenantId).eq("agent", "whatsapp").maybeSingle();
    const s = (data?.settings && typeof data.settings === "object" ? data.settings : {}) as Record<string, unknown>;
    await supabase.from("agent_settings").upsert(
      { tenant_id: tenantId, agent: "whatsapp", settings: { ...s, auto_reply: !!on }, enabled: !!on, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,agent" },
    );
  } catch (e) {
    console.error("[whatsapp] auto_reply write failed:", (e as Error).message);
  }
}

function mergeSettings(raw: unknown): LeadSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    segment_cursor: Number.isFinite(Number(o.segment_cursor)) ? Math.max(0, Math.floor(Number(o.segment_cursor))) : 0,
    negative_domains: Array.isArray(o.negative_domains) ? o.negative_domains.map((x) => String(x)).filter(Boolean) : [],
    negative_cues: Array.isArray(o.negative_cues) ? o.negative_cues.map((x) => String(x)).filter(Boolean) : [],
    daily_cap: Number.isFinite(Number(o.daily_cap)) && Number(o.daily_cap) > 0 ? Math.floor(Number(o.daily_cap)) : null,
  };
}
