import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The chat sidebar's list — every conversation this workspace has had with Mr Lxwa,
 *  newest activity first, with a preview so the list is scannable without opening each one. */
export async function GET() {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, title, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(40);

  if (error) {
    // Migration 011 not applied — the chat still works, it just won't remember. Say which,
    // rather than showing an empty list that looks like the history was lost.
    return NextResponse.json({ ok: false, error: error.message, needsMigration: /chat_conversations|relation/i.test(error.message) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, conversations: data ?? [] });
}

/** Start a fresh one. No message rows yet — /api/chat fills those in as they're sent. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_conversations")
    .insert({ tenant_id: tenantId, user_id: user?.id ?? null })
    .select("id, title, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, conversation: data });
}
