import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** THE HUMAN PRESSED SEND. This route is reached only from the chat UI's Send button, carries
 *  the member's cookie session, and forwards to agent-server which does the single actual send.
 *  No batching, no loop — one message per click, by design (see agent-server session.ts). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { leadId, phone, text, answeredBy } = body ?? {};
  if (!leadId || !phone || !String(text ?? "").trim()) {
    return NextResponse.json({ ok: false, error: "leadId, phone and a message are required." }, { status: 400 });
  }
  const r = await callWhatsapp(tenantId, "send", {
    method: "POST",
    body: { leadId, phone, body: text, answeredBy },
  });
  return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 500 });
}
