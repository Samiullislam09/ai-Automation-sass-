import type { Metadata } from "next";
import WhatsAppSection from "@/components/dashboard/WhatsAppSection";
import { getRequestContext } from "@/lib/supabase/request";
import { loadChats } from "@/lib/whatsapp-chats";

export const metadata: Metadata = { title: "WhatsApp — MenCra" };

/** The chat list and the link status are read HERE, on the server, in parallel, so the page opens on the real inbox instead of "checking…" and a skeleton.
 *
 *  The link status comes from the database row the agent server keeps up to date (whatsapp_sessions), NOT from asking the agent server: that is a second hop to Railway, which can be
 *  slow, and a page must not wait on it. The browser still asks the agent server for the live answer right after load and corrects the screen if it differs. */
export default async function DashboardWhatsAppPage({ searchParams }: { searchParams?: { lead?: string } }) {
  const { supabase, tenantId } = await getRequestContext();
  let initial: { chats: { items: any[]; inbox: any[] } | null; session: { status: string; phone: string | null } | null } | null = null;
  if (tenantId) {
    try {
      const wanted = typeof searchParams?.lead === "string" ? searchParams.lead : null;
      const [chats, sessionRes] = await Promise.all([
        loadChats(supabase, tenantId, wanted),
        supabase.from("whatsapp_sessions").select("status, phone_number").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      const ok = !("error" in chats);
      // No session row at all means "never linked": that IS a known answer (the connect screen), unlike a failed read.
      const session = sessionRes.error ? null : { status: String(sessionRes.data?.status ?? "disconnected"), phone: (sessionRes.data?.phone_number as string | null) ?? null };
      if (ok || session) initial = { chats: ok ? { items: (chats as any).items, inbox: (chats as any).inbox } : null, session };
    } catch {
      /* the component loads its own */
    }
  }
  return (
    <>
      <WhatsAppSection initial={initial} />
    </>
  );
}
