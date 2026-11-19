import { redirect } from "next/navigation";
import MrLxwaDashboard from "@/components/MrLxwaDashboard";
import { getRequestContext } from "@/lib/supabase/request";
import { loadChatHistory } from "@/lib/chat-history";

/** The dashboard shell (sidebar, top bar, Assistant chat) lives HERE, in a layout, so it is
 *  mounted once and stays mounted while you move between pages. Before, every page wrapped
 *  itself in <MrLxwaDashboard>, so each click re-built the whole shell, re-fetched the chat
 *  history ("Connecting to MenCra...") and flashed a loading screen. Now only the page's own
 *  content changes.
 *
 *  The chat history is read here on the server, so the very first paint already has it.
 *
 *  SPEED (2026-11-20): nothing here waits for anything it does not need. The onboarding check and the chat history are independent, so they run TOGETHER (they used to
 *  run one after the other: the layout's wait was the SUM of three round trips, it is now the longest one). And "this workspace is onboarded" never goes back to false,
 *  so once a server instance has seen it, that check costs nothing on every later page. */
const onboardedTenants = new Set<string>();

export default async function DashboardShellLayout({ children }: { children: React.ReactNode }) {
  const { supabase, tenantId } = await getRequestContext();

  const gate = async (): Promise<boolean> => {
    if (!tenantId || onboardedTenants.has(tenantId)) return false;
    const { data, error } = await supabase.from("tenants").select("onboarded").eq("id", tenantId).single();
    if (!error && data?.onboarded === true) onboardedTenants.add(tenantId);
    // Redirects ONLY on a definite `onboarded === false`; a failed read must never look like a brand-new account.
    return !error && data?.onboarded === false;
  };

  const [needsOnboarding, history] = await Promise.all([gate(), tenantId ? loadChatHistory(supabase, tenantId) : Promise.resolve(null)]);
  if (needsOnboarding) redirect("/onboarding");

  const initialChat = history && !history.error ? { conversations: history.conversations, latestMessages: history.latestMessages } : null;
  return (
    <MrLxwaDashboard tenantId={tenantId} initialChat={initialChat}>
      {children}
    </MrLxwaDashboard>
  );
}
