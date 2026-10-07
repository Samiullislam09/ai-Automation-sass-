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

/** How long Mr Lxwa stays quiet on a lead after a human replies in that chat (§28 P3 handoff). Six
 *  hours: long enough that the human owns the live exchange, short enough that a forgotten chat
 *  returns to auto. The auto-reply gate re-checks this each time, so a human reply during the window
 *  simply extends it. */
const HUMAN_HANDOFF_PAUSE_MS = 6 * 60 * 60 * 1000;

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
): Promise<{ leadId: string } | null> {
  // De-dupe: the same inbound can arrive as both a real-time "notify" and a reconnect "append",
  // so skip it if we already stored this WhatsApp message id. (Cheap: id is unique per message.)
  if (msg.waMessageId) {
    const { data: existing } = await supabase
      .from("outreach_messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("wa_message_id", msg.waMessageId)
      .maybeSingle();
    if (existing) return null;
  }

  const inDigits = digits(msg.phone);

  // Find the lead this number belongs to. Pull this tenant's leads that have any number stored
  // and match on significant-digits suffix in code — PostgREST cannot do the normalisation in a
  // filter, and a raw suffix fails on the leading trunk 0 most local numbers carry.
  const { data: leads } = await supabase
    .from("leads")
    .select("id, stage, whatsapp, phone")
    .eq("tenant_id", tenantId);

  // Among all leads whose number matches, pick the MOST SPECIFIC one — the longest significant
  // number — so the same person saved twice (e.g. "7602468881" and "917602468881") always routes
  // to the one with the country code, deterministically, instead of landing on whichever row the
  // query happened to return first. (The operator can delete the duplicate; this stops the scatter
  // in the meantime.)
  const matches = (leads ?? []).filter((l) => samePhone(l.whatsapp, msg.phone) || samePhone(l.phone, msg.phone));
  matches.sort((a, b) => {
    const la = Math.max(sigDigits(a.whatsapp).length, sigDigits(a.phone).length);
    const lb = Math.max(sigDigits(b.whatsapp).length, sigDigits(b.phone).length);
    return lb - la;
  });
  let lead = matches[0];

  // No matching lead? Don't drop the reply — CREATE a lead for this number so the conversation
  // always appears in the inbox. This also saves anyone who messages the business first (a number
  // we never discovered). Stage "replied" because they wrote to us; the operator can rename/qualify
  // it later. This is why "the reply didn't show" can never be silent again.
  if (!lead) {
    const { data: created, error: createErr } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        name: `+${inDigits}`,
        phone: `+${inDigits}`,
        whatsapp: `+${inDigits}`,
        source: "whatsapp-inbound",
        stage: "replied",
        reason: "They messaged us first on WhatsApp.",
      })
      .select("id, stage")
      .single();
    if (createErr || !created) {
      console.warn(`[whatsapp] inbound from ${inDigits}: no lead and could not create one (${createErr?.message}) — not stored`);
      return null;
    }
    lead = created as any;
  }

  await supabase.from("outreach_messages").insert({
    tenant_id: tenantId,
    lead_id: lead!.id,
    direction: "in",
    channel: "whatsapp",
    body: msg.text,
    status: "received",
    wa_message_id: msg.waMessageId,
  });

  // Move the lead forward — but never backward. A lead already in_conversation/won/etc stays
  // there; a fresh reply from a contacted/delivered/read lead becomes `replied`.
  const advanceable = ["queued", "contacted", "delivered", "read", "approved"];
  // A reply restarts the follow-up clock: this silence cycle is over, so the counter resets and the
  // next silence (if any) earns a fresh set of 24h/90h/160h nudges (§28.5).
  const patch: Record<string, unknown> = { replied_at: new Date().toISOString(), updated_at: new Date().toISOString(), auto_followups_done: 0 };
  if (advanceable.includes(String(lead!.stage))) patch.stage = "replied";
  await supabase.from("leads").update(patch).eq("id", lead!.id).eq("tenant_id", tenantId);
  return { leadId: lead!.id };
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
  // HUMAN HANDOFF (§28 P3): when a PERSON sends in this chat, Mr Lxwa steps back — auto-reply is
  // paused for this one lead for a window, and its "needs you" flag is cleared (the human is now on
  // it). A brain reply never does this; it is the human taking over that hands the chat to the human.
  if (answeredBy === "human") {
    patch.auto_reply_paused_until = new Date(Date.now() + HUMAN_HANDOFF_PAUSE_MS).toISOString();
    patch.needs_attention = false;
    patch.needs_attention_reason = null;
  }
  await supabase.from("leads").update(patch).eq("id", leadId).eq("tenant_id", tenantId);
}
