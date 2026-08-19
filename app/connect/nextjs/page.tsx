import Link from "next/link";

export const metadata = { title: "Connect your Next.js site — MrLxwa" };

const routeCode = `// app/api/mrlxwa-content/route.ts
import crypto from "crypto";

export async function POST(req: Request) {
  const body = await req.text();

  // 1. Verify this really came from MrLxwa
  const sig = req.headers.get("x-mrlxwa-signature");
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.MRLXWA_WEBHOOK_SECRET!)
    .update(body).digest("hex");
  if (sig !== expected) {
    return new Response("bad signature", { status: 401 });
  }

  // 2. Parse the article
  const article = JSON.parse(body);
  // { title, slug, excerpt, body /* HTML */, publishedAt, tags }

  // 3. Save it however your site works — a few common options:
  //    - Write it to your database (Postgres, Supabase, etc.)
  //    - Commit it as an MDX/JSON file via the GitHub API
  //    - Push it into your CMS (Sanity, Contentful, ...)
  //
  // Example — just log it for now:
  console.log("New article from MrLxwa:", article.title);

  return new Response("ok");
}`;

const envCode = `# .env / .env.local
MRLXWA_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx`;

const payloadCode = `{
  "title": "10 Mistakes Small Businesses Make Online",
  "slug": "10-mistakes-small-businesses-make-online",
  "excerpt": "A short 1-2 line summary...",
  "body": "<p>Full article HTML...</p>",
  "publishedAt": "2026-08-20T10:00:00.000Z",
  "tags": ["marketing", "seo"]
}`;

function Code({ children }: { children: string }) {
  return (
    <pre style={{ background: "#0c1120", border: "1px solid var(--line2)", borderRadius: 10, padding: "14px 16px", fontSize: 12.5, lineHeight: 1.65, overflowX: "auto", color: "var(--mut)" }}>
      {children}
    </pre>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 30 }}>
      <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", background: "var(--panel2)", border: "1px solid var(--line2)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "var(--ac)" }}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: 16, margin: "3px 0 8px" }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function ConnectNextjs() {
  return (
    <div style={{ minHeight: "100vh", padding: "60px 20px", position: "relative", zIndex: 1 }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, color: "var(--ink)", marginBottom: 28 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,var(--ac),#2bb99a)", display: "grid", placeItems: "center", color: "#04120d", fontSize: 13 }}>⚡</span>MrLxwa
        </Link>

        <h1 style={{ fontSize: 28, marginBottom: 10 }}>Apni Next.js site connect karo</h1>
        <p className="sm mut" style={{ marginBottom: 36, lineHeight: 1.6 }}>
          Koi username/password nahi. Ek chhota API route banao apni site mein — MrLxwa har approved article wahan seedha bhej dega,
          signed aur verified. Ye guide apne developer ko bhej sakte ho, ya khud follow kar sakte ho agar Next.js jaante ho.
        </p>

        <Step n={1} title="Apna webhook secret le lo">
          <p className="sm mut" style={{ lineHeight: 1.6 }}>
            Onboarding pura karte waqt ek secret milta hai (sirf ek baar dikhta hai) — <code style={{ color: "var(--ink)" }}>whsec_...</code> se shuru hota hai.
            Kho gaya toh dashboard ke Settings → Integrations se naya bana sakte ho.
          </p>
        </Step>

        <Step n={2} title="Ek naya file banao">
          <p className="sm mut" style={{ lineHeight: 1.6, marginBottom: 10 }}>
            Apni Next.js project mein: <code style={{ color: "var(--ink)" }}>app/api/mrlxwa-content/route.ts</code>
          </p>
          <Code>{routeCode}</Code>
        </Step>

        <Step n={3} title="Secret ko environment variable banao">
          <p className="sm mut" style={{ lineHeight: 1.6, marginBottom: 10 }}>
            Local mein <code style={{ color: "var(--ink)" }}>.env.local</code>, aur jahan bhi deploy karte ho (Vercel etc.) wahan bhi add karo:
          </p>
          <Code>{envCode}</Code>
        </Step>

        <Step n={4} title="Deploy karo, phir MrLxwa mein URL do">
          <p className="sm mut" style={{ lineHeight: 1.6 }}>
            Apni live URL (jaise <code style={{ color: "var(--ink)" }}>https://yoursite.com/api/mrlxwa-content</code>) MrLxwa onboarding
            ya Settings mein paste karo aur "Send test ping" try karo. 200 aaye toh connected ho.
          </p>
        </Step>

        <div style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid var(--line2)" }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Article ka shape kaisa hoga</h3>
          <p className="sm mut" style={{ lineHeight: 1.6, marginBottom: 10 }}>Har approved article isi JSON shape mein POST hota hai:</p>
          <Code>{payloadCode}</Code>
        </div>

        <p className="xs mut" style={{ marginTop: 30, textAlign: "center" }}>
          Article kabhi MrLxwa ke database mein permanently store nahi hota — direct tumhare endpoint pe jaata hai.
        </p>
      </div>
    </div>
  );
}
