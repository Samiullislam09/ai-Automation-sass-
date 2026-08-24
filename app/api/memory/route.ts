import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The team's memory, in the database instead of in one browser's localStorage.
 *
 *  GET seeds the list from the tenant's own profile the first time it is asked for — the
 *  facts were always there (niche, tone, audience, pace, topics, site), they just had no
 *  durable home as a list, so signing out appeared to erase everything the team knew.
 *  After that the stored list is authoritative, because it also holds whatever the user has
 *  edited or added by hand, and re-deriving would silently throw those away. */

type Fact = { k: string; v: string };

const MAX_FACTS = 60;
const MAX_LEN = 600;

export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("website_url, niche, tone_profile, icp_profile, memory_facts")
    .eq("id", tenantId)
    .single();

  if (error) {
    // Migration 010 not applied — say so rather than returning an empty list that looks
    // exactly like "your memory was wiped", which is the bug this replaces.
    return NextResponse.json({ ok: false, error: error.message, needsMigration: /memory_facts|column/i.test(error.message) }, { status: 500 });
  }

  const stored = Array.isArray(tenant?.memory_facts) ? (tenant!.memory_facts as Fact[]) : [];
  if (stored.length) return NextResponse.json({ ok: true, facts: clean(stored) });

  const seeded = seedFrom(tenant);
  // Persist the seed so the list is stable from here on and edits are a plain overwrite.
  // Best-effort: failing to save it must not stop the page rendering the facts.
  if (seeded.length) {
    const { error: saveErr } = await supabase.from("tenants").update({ memory_facts: seeded }).eq("id", tenantId);
    if (saveErr) console.error("[memory] could not persist seeded facts:", saveErr.message);
  }
  return NextResponse.json({ ok: true, facts: seeded, seeded: true });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  if (!Array.isArray(body?.facts)) return NextResponse.json({ ok: false, error: "facts must be an array." }, { status: 400 });

  const facts = clean(body.facts);
  const { error } = await supabase.from("tenants").update({ memory_facts: facts }).eq("id", tenantId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, facts });
}

/** Bounded and trimmed on the way in — this ends up in agent prompts, so it can't be an
 *  unbounded blob of whatever the client posted. */
function clean(raw: any[]): Fact[] {
  return raw
    .filter((f) => f && typeof f.k === "string" && typeof f.v === "string" && f.k.trim() && f.v.trim())
    .slice(0, MAX_FACTS)
    .map((f) => ({ k: String(f.k).trim().slice(0, 120), v: String(f.v).trim().slice(0, MAX_LEN) }));
}

/** Everything already known about the business, as a readable list. Nothing invented: a fact
 *  the tenant row doesn't have simply isn't in the list. */
function seedFrom(tenant: any): Fact[] {
  const tone = (tenant?.tone_profile as any) ?? {};
  const icp = (tenant?.icp_profile as any) ?? {};

  const facts: Fact[] = [];
  const add = (k: string, v: unknown) => {
    const s = typeof v === "string" ? v.trim() : Array.isArray(v) ? v.join(", ") : "";
    if (s) facts.push({ k, v: s });
  };

  add("Website", tenant?.website_url);
  add("Business type", icp.businessType);
  add("Audience", tone.audience);
  add("Brand tone", tone.tone);
  add("Publishing pace", tone.pace);
  add("Niche summary", tenant?.niche);
  add("Content topics", tone.topics);

  return clean(facts);
}
