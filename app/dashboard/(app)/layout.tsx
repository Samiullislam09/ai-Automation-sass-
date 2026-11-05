import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import { getRequestContext } from "@/lib/supabase/request";
import { loadChatHistory } from "@/lib/chat-history";

/** The dashboard shell (sidebar, top bar, Assistant chat) lives HERE, in a layout, so it is
 *  mounted once and stays mounted while you move between pages. Before, every page wrapped
 *  itself in <MrLxwaDashboard>, so each click re-built the whole shell, re-fetched the chat
 *  history ("Connecting to Mr. Lxwa...") and flashed a loading screen. Now only the page's own
 *  content changes.
 *
 *  The chat history is read here on the server, so the very first paint already has it. */
export default async function DashboardShellLayout({ children }: { children: React.ReactNode }) {
  const { supabase, tenantId } = await getRequestContext();
  const history = tenantId ? await loadChatHistory(supabase, tenantId) : null;
  const initialChat = history && !history.error ? { conversations: history.conversations, latestMessages: history.latestMessages } : null;
  return (
    <MrLxwaDashboard tenantId={tenantId} initialChat={initialChat}>
      {children}
    </MrLxwaDashboard>
  );
}
