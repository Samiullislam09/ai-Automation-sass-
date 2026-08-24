import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** Writes a team report into the transcript ("Mr. Keyword found these five keywords…").
 *
 *  These used to live only in React state, so the keyword table — the one thing worth
 *  scrolling back to — disappeared on refresh. They are stored as `kind: 'event'` rather than
 *  as assistant messages: nobody said them in conversation, and disguising them as something
 *  Mr Lxwa said would put them in the model's history as words it had supposedly written.
 *
 *  Idempotent by (conversation, text): the dashboard polls every few seconds and a duplicate
 *  green line for the same finished job is worse than none.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const text = String(body?.text ?? "").trim().slice(0, 4000);
  const tone = body?.tone === "error" ? "error" : "done";
  if (!text) return NextResponse.json({ ok: false, error: "text is required." }, { status: 400 });

  try {
    // The team reporting its work IS a conversation, so one is opened if the user has never
    // typed anything — otherwise a run started from the dashboard would have nowhere to land.
    let conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    if (conversationId) {
      const { data } = await supabase
        .from("chat_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data: latest } = await supabase
        .from("chat_conversations")
        .select("id")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conversationId = latest?.id ?? null;
    }
    if (!conversationId) {
      const { data: created, error } = await supabase
        .from("chat_conversations")
        .insert({ tenant_id: tenantId, user_id: user?.id ?? null, title: "Team activity" })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "could not open a conversation");
      conversationId = created.id;
    }

    const { data: existing } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("tenant_id", tenantId)
      .eq("kind", "event")
      .eq("content", text)
      .limit(1)
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true, conversationId, duplicate: true });

    const { error } = await supabase.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id: tenantId,
      role: "assistant",
      kind: "event",
      tone,
      content: text,
    });
    if (error) throw new Error(error.message);

    await supabase
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId);

    return NextResponse.json({ ok: true, conversationId });
  } catch (e: any) {
    // Migration 013 not applied, or a write failed. The line still shows in this session —
    // losing the transcript is bad, losing the notification is worse.
    console.error("[chat/events] could not store:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message ?? "Could not store the event." }, { status: 500 });
  }
}
