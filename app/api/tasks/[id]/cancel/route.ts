import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { cancelTask } from "@/lib/brain";

/** The dashboard's "Stop Task" button (MrLxwaDashboard.tsx's BottomBar) — the only client-side
 *  way to cancel a running order. `lib/brain.ts`'s cancelTask() needs AGENT_SERVER_URL/the
 *  shared agent token, neither of which can ship to the browser, so this route is the thin
 *  server-side door: resolve the caller's tenant, then hand off to the brain. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const result = await cancelTask(id, tenantId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? "Could not cancel." }, { status: result.status ?? 500 });
  return NextResponse.json({ ok: true });
}
