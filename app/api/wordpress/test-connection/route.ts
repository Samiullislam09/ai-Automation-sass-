import { NextResponse } from "next/server";

/** Calls the WordPress REST API's /users/me with the given Application Password.
 *  Runs server-side to avoid the browser CORS wall most WP sites have. */
export async function POST(request: Request) {
  const { siteUrl, username, appPassword } = await request.json();

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ ok: false, error: "Site URL, username aur application password teeno chahiye." }, { status: 400 });
  }

  const base = siteUrl.trim().replace(/\/+$/, "");
  const auth = Buffer.from(`${username}:${appPassword}`).toString("base64");

  try {
    const res = await fetch(`${base}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `WordPress ne reject kiya (${res.status}). Username/application password check karo.`, detail }, { status: 200 });
    }

    const user = await res.json();
    return NextResponse.json({ ok: true, name: user.name ?? username });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Site tak pahunch nahi paye — URL check karo (${e.message ?? "network error"}).` }, { status: 200 });
  }
}
