import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatConversation = { id: string; title: string | null; created_at: string; updated_at: string };
export type ChatHistory = {
  conversations: ChatConversation[];
  latestMessages: { id: string; messages: unknown[] } | null;
};

/** The chat sidebar's list (newest activity first) plus the most recent conversation's own
 *  messages, in one call. The dashboard layout reads it on the server so the chat panel arrives
 *  with the conversation already in it, and /api/chat/conversations serves the same data for
 *  refreshes. Returns an `error` (not a throw) when migration 011 is missing, so the chat still
 *  works, it just will not remember. */
export async function loadChatHistory(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ChatHistory & { error?: string }> {
  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, title, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) return { conversations: [], latestMessages: null, error: error.message };

  const conversations = (data ?? []) as ChatConversation[];
  let latestMessages: ChatHistory["latestMessages"] = null;
  if (conversations[0]) {
    const { data: messages } = await supabase
      .from("chat_messages")
      .select("role, content, created_at, kind, tone")
      .eq("conversation_id", conversations[0].id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(200);
    // Not fatal: the client falls back to its own per-conversation fetch.
    if (messages) latestMessages = { id: conversations[0].id, messages };
  }
  return { conversations, latestMessages };
}
