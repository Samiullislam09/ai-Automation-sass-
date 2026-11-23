import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** "Connect your site" on the home page: a visitor gets a workspace with NO login or register screen.
 *  This makes a guest account (a throwaway address nobody can mail, a random password the browser signs in with once) and hands the credentials back; the browser signs in with them and
 *  lands on the onboarding. It does not depend on the Supabase "Anonymous sign-ins" switch. The workspace lives in that browser until the owner attaches a real email or Google account.
 *  Rate limited per address and per minute so it cannot be used to fill the user table. */
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) return NextResponse.json({ ok: false, error: "Too many tries. Please wait a few minutes." }, { status: 429 });
  hits.set(ip, [...recent, now]);
  if (hits.size > 2000) hits.clear();

  const email = `guest-${randomUUID()}@guest.mencra.com`;
  const password = randomBytes(24).toString("base64url");
  const { error } = await createAdminClient().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { guest: true } });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, email, password });
}
