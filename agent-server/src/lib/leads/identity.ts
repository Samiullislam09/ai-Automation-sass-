import type { SenderIdentity } from "./compliance.js";
import { brandName } from "../whatsapp/brand.js";

/** The identification line every draft carries (compliance.buildSignature).
 *
 *  Who the message is from, in this order: the name the owner typed under "Your name" in Site Brain, then the older
 *  onboarding answers (contact_name / owner_name / sender_name), then nobody. Nothing is invented here: with no name on
 *  file the signature is the business alone, which is still a real identification. The business is the WEBSITE
 *  ("wca-global.com"), not the account username the workspace happens to be named. */
export function senderIdentity(tenant: { name?: string | null; website_url?: string | null; icp_profile?: any } | null, ownerName?: string | null): SenderIdentity {
  const profile = (tenant?.icp_profile ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s || null;
  };
  return {
    // "Your name" in Site Brain wins; the older onboarding answers are the fallback; with neither there is no person name.
    personName: str(ownerName) ?? str(profile.contact_name ?? profile.owner_name ?? profile.sender_name),
    // The business is its website ("wca-global.com"), not the account username the workspace happens to be named.
    businessName: brandName(tenant),
    website: str(tenant?.website_url),
    replyTo: str(profile.reply_to ?? profile.contact_email ?? profile.email),
  };
}
