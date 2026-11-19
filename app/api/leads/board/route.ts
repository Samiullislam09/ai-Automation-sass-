import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { genState, loadLeadsBoard } from "@/lib/leads-board";

/** /api/leads/board — what the Leads page needs in ONE round trip: the leads, each enriched with
 *  its outreach status, plus the KPI totals and the lead-discovery job's state.
 *
 *  THE NUMBERS ARE REAL. Everything is computed from the tenant's actual rows, never a placeholder.
 *  Where the product has no concept a screen assumes, it is derived honestly rather than invented:
 *
 *   · "AI Agent messaged" = a lead with an outgoing message whose answered_by is 'brain'.
 *   · "Employee messaged" = an outgoing message the human sent (answered_by 'human' or null).
 *     There is one human (the owner) today, not a roster — so "employee" means "you".
 *   · "Converted / Client" = stage 'won'.
 *   · "Not messaged" = no outgoing message of either kind.
 *
 *  SPEED (Phase 2). The list used to ship every column of every lead (drafts, evidence, score
 *  breakdowns, notes — kilobytes a row that no table cell shows). Now:
 *   · the list selects only the columns the table and cards use; the heavy ones are fetched for
 *     ONE lead when its drawer opens (GET /api/leads/[id]);
 *   · message bodies are cut to a snippet before they leave the server;
 *   · the "pending_approval" clean-up only runs when such a row actually exists (it used to be a
 *     write on every single request);
 *   · the response carries an ETag, so an unchanged board comes back as an empty 304;
 *   · ?mode=gen returns only the discovery job's state (one small query) — the page polls that
 *     while a search is running instead of re-downloading every lead every few seconds. */

/** JSON with an ETag: if the browser already has this exact body, send 304 and no body. */
function jsonWithEtag(req: NextRequest, payload: unknown) {
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Cheap mode for polling while a search runs: just the job state.
  if (req.nextUrl.searchParams.get("mode") === "gen") {
    return jsonWithEtag(req, { ok: true, gen: await genState(supabase, tenantId) });
  }

  const board = await loadLeadsBoard(supabase, tenantId);
  if ("error" in board) return NextResponse.json({ ok: false, error: board.error }, { status: board.status });
  return jsonWithEtag(req, board);
}
