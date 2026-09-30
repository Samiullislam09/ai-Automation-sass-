/** Slice G — Mr. Brain drafts a reply to what a lead just said.
 *
 *  Called on demand, when the human presses "Suggest" in a conversation that already has
 *  messages. It reads the whole thread and the tenant's Site Brain (what they sell, their tone),
 *  and returns ONE short WhatsApp reply as plain text for the compose box.
 *
 *  IT DRAFTS, IT DOES NOT SEND. Nothing here calls sendText. The route that exposes it returns
 *  the text to the UI, where it lands in the compose box and waits for the human to send it.
 *  This is the whole reason a "suggest" is a read and a "send" is a separate human action.
 *
 *  Why not auto-draft on every inbound instead of on demand: an unread suggestion sitting on a
 *  row is a draft nobody asked for, regenerated and stale by the time it is looked at, and it
 *  spends a model call per incoming message whether or not the human ever wants one. On demand
 *  spends exactly when it is useful. */
import { completeJson } from "../llm.js";
import { loadActiveProfile } from "../siteProfile.js";
import type { SupabaseClient } from "@supabase/supabase-js";

type ThreadMsg = { direction: "in" | "out"; body: string };

/** Draft a reply for one lead's conversation. Returns the suggested text, or throws with a
 *  sentence the route can relay. */
export async function suggestReply(
  supabase: SupabaseClient,
  tenantId: string,
  leadId: string
): Promise<{ reply: string }> {
  const [{ data: lead }, { data: msgs }, profile] = await Promise.all([
    supabase.from("leads").select("company, name, reason, city").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("direction, body, created_at")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(30),
    loadActiveProfile(tenantId),
  ]);

  const thread = (msgs ?? []) as ThreadMsg[];
  if (thread.length === 0) {
    // No conversation to reply into — the first-message draft (lead.draft) is the right thing
    // there, and the UI already loads that. Say so rather than inventing an opener here.
    throw new Error("This conversation has no messages yet — use the drafted first message instead.");
  }

  // The business, in the model's words, so the reply is grounded in what they actually sell and
  // how they talk — not a generic sales bot. Kept short; the whole Site Brain would drown the
  // one thing that matters (the lead's last message).
  const p = profile?.profile;
  const business = [
    p?.what_they_do ? `What we do: ${p.what_they_do}` : "",
    Array.isArray(p?.offerings) && p.offerings.length ? `We offer: ${p.offerings.slice(0, 5).map((o: any) => o?.name ?? o).filter(Boolean).join(", ")}` : "",
    p?.voice?.tone ? `Our tone: ${p.voice.tone}` : "",
  ].filter(Boolean).join("\n");

  const transcript = thread
    .map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  const prompt = [
    "You are writing the next WhatsApp reply on behalf of a business, to a lead they are talking to.",
    "Write it as a real person on the business's team would — warm, brief, specific, no corporate fluff.",
    "",
    business ? `ABOUT THE BUSINESS YOU REPRESENT:\n${business}` : "",
    lead?.company ? `THE LEAD: ${lead.company}${lead.city ? `, ${lead.city}` : ""}${lead.reason ? ` — noted because: ${lead.reason}` : ""}` : "",
    "",
    "THE CONVERSATION SO FAR (oldest first):",
    transcript,
    "",
    "Write ONLY the next message from US, replying to their most recent message. Rules:",
    "- One short WhatsApp message — 1 to 3 sentences, not an email.",
    "- Answer what they actually asked or said; do not restate your pitch if they moved past it.",
    "- No greeting like 'Dear' and no signature — this is an ongoing chat.",
    "- Match the language they wrote in (English, Hindi/Hinglish, etc.).",
    "- Never promise a price, discount or delivery date you were not given; offer to confirm instead.",
    "- If they asked to stop or sounded annoyed, write a polite one-line acknowledgement that backs off.",
    "",
    'Reply with ONLY JSON: {"reply":"...your message..."}',
  ].filter(Boolean).join("\n");

  const answer = await completeJson<{ reply?: string }>(prompt);
  const reply = String(answer?.reply ?? "").trim();
  if (!reply) throw new Error("Mr. Brain could not draft a reply this time — write one yourself, or try Suggest again.");
  // A model that ignored the length rule still must not paste an essay into a WhatsApp box.
  return { reply: reply.slice(0, 900) };
}
