import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The chat sidebar's list — every conversation this workspace has had with Mr Lxwa,
 *  newest activity first, with a preview so the list is scannable without opening each one.
 *
 *  Also carries the most recent conversation's own `messages` (owner, 2026-09-10: "har baar
 *  connecting kyun ata hai, isko fast karo" — the dashboard's own mount used to fetch this list,
 *  then fetch that one conversation's messages as a SECOND round trip, each paying its own
 *  Supabase auth check on top of the network hop. Every dashboard load did that in serial before
 *  the chat panel could show anything but "Connecting…". Folding the messages in here cuts that
 *  to one request; the per-conversation GET below still exists for switching to an OLDER one. */
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

  const conversations = data ?? [];
  let latestMessages: { id: string; messages: unknown[] } | null = null;
  if (conversations[0]) {
    const { data: messages } = await supabase
      .from("chat_messages")
      .select("role, content, created_at, kind, tone")
      .eq("conversation_id", conversations[0].id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(200);
    // A failure here is not fatal — the client already knows to fall back to its own
    // per-conversation fetch when `latestMessages` is missing.
    if (messages) latestMessages = { id: conversations[0].id, messages };
  }

  return NextResponse.json({ ok: true, conversations, latestMessages });
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
