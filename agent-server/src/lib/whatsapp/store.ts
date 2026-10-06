/** Writing WhatsApp traffic into the CRM: incoming messages linked to their lead, and delivery
 *  receipts moved forward. The session (session.ts) calls these; they own the outreach_messages
 *  and leads writes so the socket code stays about the socket.
 *
 *  Everything here is phone-number matching, which is fuzzier than an id join and is handled as
 *  such: WhatsApp gives a bare national-or-international number with no punctuation, while a lead
 *  row's `whatsapp`/`phone` may have been stored with +, spaces or brackets. We compare on
 *  digits-only, longest-suffix, so "+971 50 123 4567" and "971501234567" are the same person and
 *  a wrong short match cannot happen. */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Digits only, for comparing two phone numbers that were written by different systems. */
function digits(s: string | null | undefined): string {
  return String(s ?? "").replace(/[^0-9]/g, "");
}

/** A phone's SIGNIFICANT digits for matching: digits with the leading trunk/country zeros removed.
 *  A UAE landline stored as "02 619 9100" is "026199100", but WhatsApp delivers it as
 *  "97126199100" (country code, no trunk 0) — a raw endsWith never matches because of that 0.
 *  Stripping leading zeros makes "26199100" a clean suffix of "97126199100", so the two line up. */
function sigDigits(s: string | null | undefined): string {
  return digits(s).replace(/^0+/, "");
}

/** Do two phone numbers refer to the same line, allowing for country-code / trunk-0 differences?
 *  Compares significant digits with a both-ways suffix test, requiring ≥7 shared trailing digits so
 *  a short number can't false-match a long one. */
function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = sigDigits(a);
  const y = sigDigits(b);
  if (x.length < 7 || y.length < 7) return false;
  return x.endsWith(y) || y.endsWith(x);
}

/** An incoming WhatsApp message: store it, attach it to the lead it came from, and move that
 *  lead's stage to `replied` (unless it is already further along). Nothing is auto-answered. */
export async function linkIncoming(
  supabase: SupabaseClient,
  tenantId: string,
  msg: { phone: string; text: string; waMessageId: string | null }
): Promise<void> {
  const inDigits = digits(msg.phone);

  // Find the lead this number belongs to. Pull this tenant's leads that have any number stored
  // and match on significant-digits suffix in code — PostgREST cannot do the normalisation in a
  // filter, and a raw suffix fails on the leading trunk 0 most local numbers carry.
  const { data: leads } = await supabase
    .from("leads")
    .select("id, stage, whatsapp, phone")
    .eq("tenant_id", tenantId);

  const lead = (leads ?? []).find((l) => samePhone(l.whatsapp, msg.phone) || samePhone(l.phone, msg.phone));

  // Store the message. An incoming from a number we have no lead for is still recorded (lead_id
  // null) so nothing a person sent is silently dropped — but with the schema requiring lead_id,
  // we only store when matched; an unmatched inbound is logged for the operator instead of lost
  // to a constraint error.
  if (!lead) {
    console.warn(`[whatsapp] inbound from ${inDigits} matched no lead for tenant ${tenantId} — not stored`);
    return;
  }

  await supabase.from("outreach_messages").insert({
    tenant_id: tenantId,
    lead_id: lead.id,
    direction: "in",
    channel: "whatsapp",
    body: msg.text,
    status: "received",
    wa_message_id: msg.waMessageId,
  });

  // Move the lead forward — but never backward. A lead already in_conversation/won/etc stays
  // there; a fresh reply from a contacted/delivered/read lead becomes `replied`.
  const advanceable = ["queued", "contacted", "delivered", "read", "approved"];
  const patch: Record<string, unknown> = { replied_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (advanceable.includes(String(lead.stage))) patch.stage = "replied";
  await supabase.from("leads").update(patch).eq("id", lead.id).eq("tenant_id", tenantId);
}

/** A delivery or read receipt for a message we sent: advance its status, never regress it.
 *  read > delivered > sent, so a late "delivered" after a "read" is ignored. */
export async function recordSentStatus(
  supabase: SupabaseClient,
  tenantId: string,
  waMessageId: string,
  status: "delivered" | "read"
): Promise<void> {
  const { data: row } = await supabase
    .from("outreach_messages")
    .select("id, status, lead_id")
    .eq("tenant_id", tenantId)
    .eq("wa_message_id", waMessageId)
    .maybeSingle();
  if (!row) return;

  const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
  if ((rank[status] ?? 0) <= (rank[row.status] ?? 0)) return; // never go backward

  const stamp = status === "read" ? "read_at" : "delivered_at";
  await supabase
    .from("outreach_messages")
    .update({ status, [stamp]: new Date().toISOString() })
    .eq("id", row.id);

  // Reflect the furthest receipt on the lead too, so the board can sort by it without scanning
  // every message — but only while the lead is still in the sent/delivered band (a replied lead
  // has already moved past receipts).
  const leadStage = status === "read" ? "read" : "delivered";
  await supabase
    .from("leads")
    .update({ stage: leadStage, updated_at: new Date().toISOString() })
    .eq("id", row.lead_id)
    .eq("tenant_id", tenantId)
    .in("stage", ["contacted", "delivered"]);
}

/** Record an outgoing message a human just sent (from POST /whatsapp/send), and move the lead to
 *  `contacted` on its first outbound. Returns nothing; the send route already has the wa id. */
export async function recordOutgoing(
  supabase: SupabaseClient,
  tenantId: string,
  leadId: string,
  body: string,
  waMessageId: string,
  answeredBy: "human" | "brain" | null
): Promise<void> {
  await supabase.from("outreach_messages").insert({
    tenant_id: tenantId,
    lead_id: leadId,
    direction: "out",
    channel: "whatsapp",
    body,
    status: "sent",
    wa_message_id: waMessageId,
    answered_by: answeredBy,
    sent_at: new Date().toISOString(),
  });

  // First outbound moves an approved/queued lead to contacted and stamps contacted_at; a later
  // message (they were already contacted/replied) leaves the stage alone but bumps follow_up.
  const { data: lead } = await supabase
    .from("leads")
    .select("stage, contacted_at, follow_up_count")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (lead && !lead.contacted_at) {
    patch.stage = "contacted";
    patch.contacted_at = new Date().toISOString();
  } else {
    patch.follow_up_count = (lead?.follow_up_count ?? 0) + 1;
  }
  await supabase.from("leads").update(patch).eq("id", leadId).eq("tenant_id", tenantId);
}
