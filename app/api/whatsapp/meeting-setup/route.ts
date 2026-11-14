import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";
import { googleConfigured, loadGoogle, SCOPE_CALENDAR } from "@/lib/google";
import { callWhatsapp } from "@/lib/whatsapp-proxy";

/** GET /api/whatsapp/meeting-setup — can the assistant turn "let's talk" into a booked call? Cheap (no Google round trip):
 *  google = connected | needs_reconnect (connected before Calendar was requested) | not_connected | not_configured (server has no
 *  Google OAuth keys), and whether a booking link is saved. The dashboard uses it to tell the owner what to connect. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let google: "connected" | "needs_reconnect" | "not_connected" | "not_configured" = "not_connected";
  let email: string | null = null;
  if (!googleConfigured()) google = "not_configured";
  else {
    const creds = await loadGoogle(supabase, tenantId).catch(() => null);
    if (creds) {
      email = creds.email ?? null;
      google = (creds.scopes ?? []).includes(SCOPE_CALENDAR) ? "connected" : "needs_reconnect";
    }
  }
  const s: any = await callWhatsapp(tenantId, "settings", { method: "GET" }).catch(() => null);
  const bookingLink = !!String(s?.settings?.booking_link ?? "").trim();
  return NextResponse.json({ ok: true, google, email, booking_link: bookingLink }, { headers: { "Cache-Control": "private, no-store" } });
}
