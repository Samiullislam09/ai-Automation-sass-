import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { getDailyUsage } from "@/lib/agent-caps";

/** Today's per-agent usage — split out from /api/account/route.ts on purpose (2026-09-09).
 *
 *  getDailyUsage's cap side calls agent-server's own /version (lib/agent-caps.ts's
 *  loadCapTable) to know each plan's daily limit — a real network hop to Railway that measured
 *  ~1.1-1.2s round-trip even warm, not just on a cold start. Bundled into the main account
 *  call, that made the whole panel (name, plan, business info — all otherwise local-DB-only
 *  data) wait on it, and a hard deadline there just made this section randomly vanish instead
 *  (owner report: "kabhi dikhta hai kabhi nahi"). This route can take its own time; the client
 *  renders everything else first and lets usage arrive a beat later instead of gating on it. */

const SHOWN = [
  { agent: "writer", label: "Articles written" },
  { agent: "boss", label: "Planning runs" },
  { agent: "keyword", label: "Keyword research" },
];

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

    const tenantId = await getCurrentTenantId(supabase);
    if (!tenantId) return NextResponse.json({ ok: false, error: "No workspace yet." }, { status: 401 });

    const usage = await Promise.all(
      SHOWN.map(async (s) => ({ ...s, ...(await getDailyUsage(supabase, tenantId, s.agent).catch(() => null)) }))
    );

    return NextResponse.json({ ok: true, usage: usage.filter((u) => u && "used" in u) });
  } catch (e: any) {
    // Same reasoning as app/api/account/route.ts's catch: always real JSON back, even on an
    // unexpected failure, so the caller's own quiet-skip handling (this route's failures were
    // always meant to just hide the usage section, never surface an error) actually gets a
    // clean response to quietly skip, instead of a thrown parse error.
    console.error("[api/account/usage] unexpected error:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: "Usage unavailable." }, { status: 500 });
  }
}
