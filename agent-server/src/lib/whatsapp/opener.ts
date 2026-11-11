/** The FIRST message to a lead.
 *
 *  The old dispatcher asked the reply engine (decideReply) for the opener, but that engine reads a
 *  conversation and throws "No conversation yet" on an empty thread, so EVERY first message was skipped
 *  as "no opener drafted" and nothing was ever sent. The opener is not a reply. It is the lead's own
 *  drafted first message (written and screened by the leads pipeline: who is writing, the business, a
 *  working opt-out, no unproven claims) or, when that draft is missing or not WhatsApp-shaped, a short
 *  one written here from the lead and Site Brain, and finished in CODE with the sender line and the
 *  opt-out, so the model can neither forget nor reword them. */
import { supabase } from "../../supabase.js";
import { completeJson } from "../llm.js";
import { loadActiveProfile } from "../siteProfile.js";
import { OPT_OUT_PHRASE } from "../leads/compliance.js";

export const OPENER_MAX_CHARS = 700;

type LeadForOpener = { company?: string | null; name?: string | null; city?: string | null; reason?: string | null; draft?: string | null; channel?: string | null };

/** A draft is usable as a WhatsApp opener when it exists, is short enough to read on a phone, is not an
 *  email (no subject / "Dear"), and carries the opt-out. Pure, so it is unit-tested. */
export function usableDraft(draft: string | null | undefined): string | null {
  const d = String(draft ?? "").trim();
  if (!d || d.length > OPENER_MAX_CHARS) return null;
  if (/^subject\s*:/i.test(d) || /^dear\b/i.test(d)) return null;
  if (!d.toLowerCase().includes(OPT_OUT_PHRASE.toLowerCase())) return null; // never send one without a working opt-out
  return d;
}

/** The closing every cold message ends with, built in code. */
export function closing(business: string, website: string | null): string {
  const lines = [`— ${business}`];
  if (website) lines.push(website);
  lines.push(`If you would rather not hear from me, ${OPT_OUT_PHRASE} and I will not write again.`);
  return lines.join("\n");
}

export async function composeOpener(tenantId: string, lead: LeadForOpener): Promise<string | null> {
  const ready = usableDraft(lead.draft);
  if (ready) return ready;

  const profile = (await loadActiveProfile(tenantId).catch(() => null))?.profile as any;
  const { data: tenant } = await supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle();
  const business = String((tenant as any)?.name ?? "").trim();
  const what = String(profile?.what_they_do ?? "").trim();
  if (!business || !what) return null; // nothing real to say, and we do not invent a business
  const who = lead.company || lead.name || "";
  const offerings = Array.isArray(profile?.offerings) ? profile.offerings.slice(0, 4).map((o: any) => o?.name ?? o).filter(Boolean).join(", ") : "";

  const prompt = [
    `Write the first WhatsApp message from ${business} to ${who || "a business that may need us"}${lead.city ? ` in ${lead.city}` : ""}.`,
    `About us: ${what}${offerings ? `. We offer: ${offerings}` : ""}.`,
    lead.reason ? `Why we are writing to them: ${lead.reason}.` : "",
    "",
    "Rules:",
    "- 2 or 3 short sentences, plain and polite, like a real person at a professional company. No emojis, no hype, no exclamation marks.",
    "- Say who we are in the first sentence, then one concrete reason it may matter to them, then ONE easy question.",
    "- Do not claim any result, number, certificate or client that is not in the text above. Do not mention a price.",
    "- Do not add a signature or an opt-out line: they are added for you.",
    'Reply with ONLY JSON: {"message":"..."}',
  ].filter(Boolean).join("\n");

  const out = await completeJson<{ message?: string }>(prompt).catch(() => null);
  const text = String(out?.message ?? "").replace(/\s+\n/g, "\n").trim();
  if (!text || text.length < 20 || text.length > 450) return null;
  const site = String((tenant as any)?.website_url ?? "").trim() || null;
  return `${text}\n\n${closing(business, site)}`;
}
