/** Helpers for Google One Tap sign-in (components/GoogleOneTap.tsx).
 *
 *  One Tap hands the page a signed Google ID token. Supabase checks it against the SAME nonce the page
 *  gave Google, which stops a stolen token from being replayed into another session. Google wants the
 *  SHA-256 hex of the nonce; Supabase wants the raw value. So the page makes one random value, sends
 *  its hash to Google and keeps the raw one for Supabase.
 *
 *  Pure and browser-only (Web Crypto), so it is easy to check on its own. */

export type Nonce = { raw: string; hashed: string };

/** SHA-256 of `text`, as lowercase hex — the form Google's `nonce` option expects. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh random nonce and its hash. 32 random bytes, base64url-free hex so it survives any transport. */
export async function makeNonce(): Promise<Nonce> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const raw = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed: await sha256Hex(raw) };
}

/** The Google OAuth Web client id, public by design (it is in every Google sign-in page's source).
 *  Unset means One Tap is simply off: nothing renders, nothing loads, nothing breaks. */
export function oneTapClientId(): string | null {
  const id = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
  return id || null;
}
