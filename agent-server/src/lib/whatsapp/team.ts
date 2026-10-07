/** §29.5/29.10 — the WhatsApp TEAM (admins who get alerted) and the NOTIFICATION CENTRE.
 *
 *  Two jobs, one small module because they are always used together:
 *   · admins — the owner + managers whose WhatsApp numbers hear about a meeting request or a hot
 *     lead (P6/P8). CRUD lives here; the Settings panel edits them.
 *   · notifications — the dashboard bell's feed. `createNotification` files one row; `notifyAdmins`
 *     does both at once: it files the dashboard notification AND (for high-value events) sends a
 *     short WhatsApp line to each admin who has notify on.
 *
 *  A WhatsApp alert to the team is an internal, low-volume message between the owner and their own
 *  managers — it is NOT outreach, so it is exempt from the lead caps; but it still goes through the
 *  one sendText, so it inherits the onWhatsApp check and timeouts. */
import { supabase } from "../../supabase.js";
import { sendText } from "./session.js";

export type Admin = { id: string; name: string | null; phone: string; role: string; notify: boolean };

const digits = (s: string) => String(s ?? "").replace(/[^0-9]/g, "");

export async function listAdmins(tenantId: string): Promise<Admin[]> {
  try {
    const { data } = await supabase.from("whatsapp_admins").select("id, name, phone, role, notify").eq("tenant_id", tenantId).order("created_at", { ascending: true });
    return (data ?? []) as Admin[];
  } catch {
    return [];
  }
}

/** Add or update an admin. A new number defaults to a notifying 'manager'; the first admin a tenant
 *  adds is their 'owner'. Idempotent on the number (unique index), so re-adding just updates. */
export async function upsertAdmin(tenantId: string, input: { id?: string; name?: string | null; phone: string; role?: string; notify?: boolean }): Promise<Admin | null> {
  const phone = `+${digits(input.phone)}`;
  if (digits(phone).length < 8) throw new Error("Enter a full WhatsApp number with country code.");
  const existingCount = (await listAdmins(tenantId)).length;
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    phone,
    name: input.name?.trim() || null,
    role: input.role === "owner" || input.role === "manager" ? input.role : existingCount === 0 ? "owner" : "manager",
    notify: input.notify !== false,
  };
  if (input.id) row.id = input.id;
  const { data, error } = await supabase.from("whatsapp_admins").upsert(row, { onConflict: "tenant_id,phone" }).select("id, name, phone, role, notify").maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Admin | null;
}

export async function deleteAdmin(tenantId: string, id: string): Promise<void> {
  await supabase.from("whatsapp_admins").delete().eq("tenant_id", tenantId).eq("id", id);
}

/** File a dashboard notification. Best effort — a bell entry failing must never break the thing it
 *  was announcing. */
export async function createNotification(
  tenantId: string,
  n: { type: "reply" | "meeting" | "hot_lead" | "system"; title: string; body?: string | null; leadId?: string | null },
): Promise<void> {
  try {
    await supabase.from("wa_notifications").insert({
      tenant_id: tenantId, type: n.type, title: n.title, body: n.body ?? null, lead_id: n.leadId ?? null,
    });
  } catch (e: any) {
    console.warn("[team] notification insert failed:", e?.message);
  }
}

export async function listNotifications(tenantId: string, limit = 50): Promise<{ items: any[]; unread: number }> {
  try {
    const { data } = await supabase.from("wa_notifications").select("id, type, title, body, lead_id, read, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
    const items = data ?? [];
    const unread = items.filter((x: any) => !x.read).length;
    return { items, unread };
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function markNotificationsRead(tenantId: string, id?: string): Promise<void> {
  try {
    const q = supabase.from("wa_notifications").update({ read: true }).eq("tenant_id", tenantId).eq("read", false);
    if (id) await q.eq("id", id);
    else await q;
  } catch (e: any) {
    console.warn("[team] mark-read failed:", e?.message);
  }
}

/** The high-value path: file the dashboard notification AND ping every notifying admin on WhatsApp.
 *  Used for meeting requests and hot leads (P6/P8). Each WhatsApp send is best-effort and isolated
 *  so one bad number can't stop the others or the dashboard entry. */
export async function notifyAdmins(
  tenantId: string,
  n: { type: "meeting" | "hot_lead" | "system"; title: string; body?: string | null; leadId?: string | null; whatsappText?: string },
): Promise<void> {
  await createNotification(tenantId, n);
  const text = n.whatsappText ?? `${n.title}${n.body ? `\n${n.body}` : ""}`;
  const admins = (await listAdmins(tenantId)).filter((a) => a.notify && digits(a.phone).length >= 8);
  for (const a of admins) {
    try {
      await sendText(tenantId, a.phone, `🔔 ${text}`);
    } catch (e: any) {
      console.warn(`[team] admin alert to ${a.phone} failed:`, e?.message);
    }
  }
}
