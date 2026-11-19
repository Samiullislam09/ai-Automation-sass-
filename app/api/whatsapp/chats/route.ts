import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { loadChats } from "@/lib/whatsapp-chats";

/** GET /api/whatsapp/chats — everything the WhatsApp page's chat list needs, in ONE round trip.
 *
 *  The page used to call /api/leads (select("*") of 200 leads, drafts, evidence and score breakdowns
 *  included: kilobytes a row that a chat list never shows) and then /api/whatsapp/messages, one after
 *  the other. Now: the chat-list columns only, the last message per lead and the unread counts, both read
 *  at the same time, with an ETag so an unchanged inbox comes back as an empty 304. The heavy fields load
 *  for ONE lead when its details panel opens (GET /api/leads/[id]).
 *
 *  ?lead=<id> also returns that lead even if it is not in a chat stage yet (the WhatsApp button on the
 *  Leads page deep-links to a lead that is only approved). */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const r = await loadChats(supabase, tenantId, req.nextUrl.searchParams.get("lead"));
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });

  const body = JSON.stringify({ ok: true, items: r.items, inbox: r.inbox });
  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
