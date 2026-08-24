import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** One conversation, reopened. Every query is scoped by tenant_id as well as by id — RLS
 *  already enforces that, but a route that reads by id alone is one policy mistake away from
 *  serving somebody else's chat. */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: conversation, error: convErr } = await supabase
    .from("chat_conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", params.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (convErr) return NextResponse.json({ ok: false, error: convErr.message }, { status: 500 });
  if (!conversation) return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("conversation_id", params.id)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    // A very long thread would otherwise be a huge payload for a 300px-wide panel.
    .limit(200);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, conversation, messages: messages ?? [] });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Messages go with it — the foreign key is ON DELETE CASCADE.
  const { error } = await supabase.from("chat_conversations").delete().eq("id", params.id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
