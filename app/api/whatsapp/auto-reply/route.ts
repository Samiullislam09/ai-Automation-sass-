import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** Turn WhatsApp auto-reply on/off. When ON, Mr Lxwa drafts and SENDS a reply to each incoming
 *  message by itself (reactive only — it never cold-messages). POST { on: boolean }. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const r = await callWhatsapp(tenantId, "auto-reply", { method: "POST", body: { on: body?.on === true } });
  return NextResponse.json(r.ok ? { ok: true, autoReply: r.autoReply } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 500 });
}
