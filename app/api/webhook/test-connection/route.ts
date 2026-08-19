import { NextResponse } from "next/server";
import { generateWebhookSecret, signPayload } from "@/lib/webhook";

/** Sends a signed ping to the client's own endpoint (their Next.js/custom site) and
 *  checks for a 2xx back. No credentials collected — just their URL. */
export async function POST(request: Request) {
  const { url } = await request.json();
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ ok: false, error: "Ek valid URL do (https:// se shuru)." }, { status: 400 });
  }

  const secret = generateWebhookSecret();
  const body = JSON.stringify({ type: "ping", sentAt: new Date().toISOString() });
  const signature = signPayload(secret, body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MrLxwa-Signature": signature },
      body,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Tumhare endpoint ne ${res.status} return kiya — 200 expected hai.` });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Endpoint tak pahunch nahi paye (${e.message ?? "network error"}). URL check karo, aur ye public/live hona chahiye (localhost nahi chalega).` });
  }
}
