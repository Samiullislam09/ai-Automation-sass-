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
import { applyBrand, brandName } from "./brand.js";

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

/** A draft that is too long for a phone but is otherwise a good message (identification and opt-out intact): keep
 *  its opening and its closing question, cut the middle, and keep the signature block exactly as written. Before this
 *  a lead whose draft ran a few lines over was skipped as "no opener drafted" and never contacted. */
export function shortenDraft(draft: string | null | undefined): string | null {
  const d = String(draft ?? "").trim();
  if (!d || /^subject\s*:/i.test(d) || /^dear\b/i.test(d)) return null;
  const at = d.search(/\n\s*—\s/);
  if (at < 0) return null;
  const sig = d.slice(at).trim();
  if (!sig.toLowerCase().includes(OPT_OUT_PHRASE.toLowerCase())) return null;
  const sentences = d.slice(0, at).trim().replace(/\s+/g, " ").split(/(?<=[.?!])\s+/).filter(Boolean);
  if (!sentences.length) return null;
  const budget = OPENER_MAX_CHARS - sig.length - 4;
  const question = sentences.length > 1 && /\?$/.test(sentences[sentences.length - 1]) ? sentences[sentences.length - 1] : null;
  const picked: string[] = [];
  for (const s of sentences.slice(0, question ? -1 : undefined)) {
    const next = [...picked, s, ...(question ? [question] : [])].join(" ");
    if (next.length > budget) break;
    picked.push(s);
  }
  if (!picked.length) return null;
  const body = [...picked, ...(question ? [question] : [])].join(" ");
  return body.length <= budget ? `${body}\n\n${sig}` : null;
}

/** A stored draft made ready to send or to preview: signed with the website, shortened if needed. null = not usable. */
export function prepareDraft(draft: string | null | undefined, tenant: { name?: string | null; website_url?: string | null } | null): string | null {
  const ready = usableDraft(draft) ?? shortenDraft(draft);
  return ready ? applyBrand(ready, tenant) : null;
}

/** The closing every cold message ends with, built in code. */
export function closing(business: string, website: string | null): string {
  const lines = [`— ${business}`];
  const host = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
  if (website && host(website) !== host(business)) lines.push(website);
  lines.push(`If you would rather not hear from me, ${OPT_OUT_PHRASE} and I will not write again.`);
  return lines.join("\n");
}

export async function composeOpener(tenantId: string, lead: LeadForOpener): Promise<string | null> {
  const { data: tenant } = await supabase.from("tenants").select("name, website_url").eq("id", tenantId).maybeSingle();
  const ready = prepareDraft(lead.draft, tenant as any);
  if (ready) return ready;

  const profile = (await loadActiveProfile(tenantId).catch(() => null))?.profile as any;
  const business = brandName(tenant as any);
  const owner = String(profile?.owner_name ?? "").trim();
  const what = String(profile?.what_they_do ?? "").trim();
  if (!business || !what) return null; // nothing real to say, and we do not invent a business
  const who = lead.company || lead.name || "";
  const offerings = Array.isArray(profile?.offerings) ? profile.offerings.slice(0, 4).map((o: any) => o?.name ?? o).filter(Boolean).join(", ") : "";

  const prompt = [
    `Write the first WhatsApp message from ${owner ? `${owner} at ${business}` : business} to ${who || "a business that may need us"}${lead.city ? ` in ${lead.city}` : ""}.`,
    `About us: ${what}${offerings ? `. We offer: ${offerings}` : ""}.`,
    lead.reason ? `Why we are writing to them: ${lead.reason}.` : "",
    "",
    "Rules:",
    "- 2 or 3 short sentences, plain and polite, like a real person at a professional company. No emojis, no hype, no exclamation marks.",
    ...(owner ? [`- Introduce yourself as ${owner} from ${business}, in exactly those words.`] : []),
    "- Say who we are in the first sentence, then one concrete reason it may matter to them, then ONE easy question.",
    "- Do not claim any result, number, certificate or client that is not in the text above. Do not mention a price.",
    "- Do not add a signature or an opt-out line: they are added for you.",
    'Reply with ONLY JSON: {"message":"..."}',
  ].filter(Boolean).join("\n");

  const out = await completeJson<{ message?: string }>(prompt).catch(() => null);
  const text = String(out?.message ?? "").replace(/\s+\n/g, "\n").trim();
  if (!text || text.length < 20) return null;
  // A model answer that runs long is cut to its sentences rather than thrown away.
  const trimmed = text.length <= 450 ? text : text.replace(/\s+/g, " ").split(/(?<=[.?!])\s+/).reduce((acc, s) => (`${acc} ${s}`.trim().length <= 450 ? `${acc} ${s}`.trim() : acc), "");
  if (trimmed.length < 20) return null;
  const site = String((tenant as any)?.website_url ?? "").trim() || null;
  return `${trimmed}\n\n${closing(business, site)}`;
}
